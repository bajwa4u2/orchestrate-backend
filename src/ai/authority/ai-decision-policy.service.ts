import { Injectable } from '@nestjs/common';
import { ContactEmailStatus, JobType, LeadStatus, ReplyIntent, SubscriptionStatus } from '@prisma/client';
import {
  AiAuthorityAction,
  AiAuthorityDecision,
  AiPolicyResult,
  AiRealitySnapshot,
} from '../contracts/ai-authority.contract';

@Injectable()
export class AiDecisionPolicyService {
  validate(decision: AiAuthorityDecision, snapshot: AiRealitySnapshot): AiPolicyResult {
    const blockers: string[] = [];
    let allowed = true;
    let hardBlocked = false;
    let normalizedAction: AiAuthorityAction | undefined;
    let normalizedJobType = decision.jobType ?? null;
    let requiresHumanReview = decision.requiresHumanReview;

    const action = decision.action;

    const block = (reason: string, hard = true) => {
      blockers.push(reason);
      allowed = false;
      hardBlocked = hardBlocked || hard;
    };

    if (this.requiresClient(action) && !snapshot.client) {
      block('Client reality is missing.');
    }

    if (this.requiresCampaign(action) && !snapshot.campaign) {
      block('Campaign reality is missing.');
    }

    if (this.requiresLead(action) && !snapshot.lead) {
      block('Lead reality is missing.');
    }

    if (action === 'ACTIVATE_CAMPAIGN' || action === 'SOURCE_LEADS' || action === 'SEND_FIRST_OUTREACH') {
      const clientHealth = this.obj(snapshot.client?.health);
      const billingHealth = this.obj(snapshot.billing?.health);
      const agreementHealth = this.obj(snapshot.agreements?.health);
      const clientStatus = String(snapshot.client?.status ?? '');

      if (!clientHealth.setupComplete) {
        block('Client setup is incomplete.');
        normalizedAction = 'REQUEST_CLIENT_SETUP_COMPLETION';
      }

      if (!['ACTIVE', 'LEAD'].includes(clientStatus)) {
        block(`Client status does not allow activation: ${clientStatus || 'unknown'}.`);
      }

      if (!billingHealth.hasRevenueAccess) {
        block('No active or trialing subscription is available for revenue execution.');
      }

      if (!agreementHealth.hasAcceptedAgreement && action === 'ACTIVATE_CAMPAIGN') {
        block('No accepted/active service agreement is available for campaign activation.', false);
        requiresHumanReview = true;
      }
    }

    if (action === 'SEND_FIRST_OUTREACH' || action === 'SEND_FOLLOW_UP') {
      const lead = this.obj(snapshot.lead);
      const contact = this.obj(lead.contact);
      const leadHealth = this.obj(lead.health);
      const campaign = this.obj(snapshot.campaign);
      const campaignHealth = this.obj(campaign.health);

      if (!contact.email) block('Lead has no contact email.');

      if (
        contact.emailStatus &&
        [ContactEmailStatus.INVALID, ContactEmailStatus.BOUNCED, ContactEmailStatus.RISKY].includes(contact.emailStatus)
      ) {
        block(`Contact email status is not sendable: ${contact.emailStatus}.`);
      }

      if ([LeadStatus.SUPPRESSED, LeadStatus.CLOSED_LOST, LeadStatus.BOOKED].includes(lead.status)) {
        block(`Lead status does not allow outreach: ${lead.status}.`);
      }

      if (!['READY', 'ACTIVE'].includes(String(campaign.status))) {
        block(`Campaign status does not allow outreach: ${campaign.status || 'unknown'}.`);
      }

      if (campaignHealth.activeWindow === false) {
        block('Campaign is outside its active window.');
      }

      if (campaignHealth.dailySendCap && campaignHealth.sentToday >= campaignHealth.dailySendCap) {
        block('Campaign daily send cap has been reached.');
      }

      if (leadHealth.hasPendingReply) {
        block('Lead has a pending or unhandled reply.');
        normalizedAction = 'PROCESS_REPLY';
        requiresHumanReview = true;
      }

      if (action === 'SEND_FOLLOW_UP' && !leadHealth.alreadyContacted) {
        block('Follow-up requested before first outreach exists.');
        normalizedAction = 'SEND_FIRST_OUTREACH';
      }

      if (action === 'SEND_FIRST_OUTREACH') normalizedJobType = JobType.FIRST_SEND;
      if (action === 'SEND_FOLLOW_UP') normalizedJobType = JobType.FOLLOWUP_SEND;
    }

    if (action === 'PROCESS_REPLY') {
      const reply = this.obj(snapshot.reply);
      if (!reply.id) block('Reply is missing.');
      if (reply.intent && reply.intent !== ReplyIntent.UNCLEAR && reply.handledAt && !reply.requiresHumanReview) {
        block('Reply appears already classified and handled.', false);
      }
      normalizedJobType = JobType.REPLY_CLASSIFICATION;
    }

    if (action === 'HANDOFF_MEETING') {
      const lead = this.obj(snapshot.lead);
      const reply = this.obj(snapshot.reply);
      const campaignHealth = this.obj(snapshot.campaign?.health);
      const clientHealth = this.obj(snapshot.client?.health);
      const latestReplyIntent = this.obj(lead.health).latestReplyIntent || reply.intent;

      if (![ReplyIntent.INTERESTED, ReplyIntent.REFERRAL].includes(latestReplyIntent)) {
        block(`Meeting handoff requires interested/referral reply, got ${latestReplyIntent || 'unknown'}.`);
      }

      if (!campaignHealth.hasBookingPath && !clientHealth.hasBookingUrl) {
        requiresHumanReview = true;
      }

      normalizedJobType = JobType.MEETING_HANDOFF;
    }

    if (action === 'CREATE_INVOICE' || action === 'SEND_RECEIPT') {
      const billingHealth = this.obj(snapshot.billing?.health);
      if (!snapshot.client) block('Financial action requires client reality.');
      if (action === 'SEND_RECEIPT' && billingHealth.openBalanceCents > 0) {
        requiresHumanReview = true;
      }
      if (action === 'CREATE_INVOICE') normalizedJobType = JobType.INVOICE_GENERATION;
    }

    if (action === 'BLOCK_CAMPAIGN' || action === 'PAUSE_CAMPAIGN' || action === 'ESCALATE_OPERATOR') {
      requiresHumanReview = true;
    }

    return {
      allowed,
      hardBlocked,
      reason: blockers[0] ?? null,
      blockers,
      normalizedAction,
      normalizedJobType,
      requiresHumanReview,
      metadata: {
        policyVersion: '2026-04-ai-authority-policy-v1',
        checkedAt: new Date().toISOString(),
      },
    };
  }

  private requiresClient(action: AiAuthorityAction) {
    return !['DIAGNOSE_SYSTEM', 'PROPOSE_CODE_UPGRADE', 'PROPOSE_DESIGN_UPGRADE'].includes(action);
  }

  private requiresCampaign(action: AiAuthorityAction) {
    return [
      'ACTIVATE_CAMPAIGN',
      'SOURCE_LEADS',
      'ADAPT_STRATEGY',
      'PAUSE_CAMPAIGN',
      'SEND_FIRST_OUTREACH',
      'SEND_FOLLOW_UP',
      'PROCESS_REPLY',
      'HANDOFF_MEETING',
    ].includes(action);
  }

  private requiresLead(action: AiAuthorityAction) {
    return ['QUALIFY_LEAD', 'SEND_FIRST_OUTREACH', 'SEND_FOLLOW_UP', 'PROCESS_REPLY', 'HANDOFF_MEETING', 'STOP_LEAD'].includes(action);
  }

  private obj(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
  }
}
