# Orchestrate Backend Codex Operating Instructions

This repository is the Orchestrate backend. Codex must operate as a controlled engineering layer, not as an independent product designer and not as a runtime decision brain.

## Non-negotiable system model

DB = Authority of Reality  
AI = Authority of Decision  
Backend = Authority of Enforcement  
Workers = Authority of Execution  
Frontend = Authority of Representation

Codex is not any of those runtime authorities. Codex may inspect, edit, and validate source code only within the rules below.

## Actual backend scope detected from repository

The backend src contains these top-level zones:

access-context, adaptation, agreements, ai, analytics, auth, billing, campaigns, client-portal, clients, common, control, core, database, deliverability, emails, execution, financial-documents, health, intake, invoices, lead-sources, leads, meetings, modules, notifications, operator, organizations, providers, public, qualification, reachability, reminders, replies, signals, sources, statements, strategy, subscriptions, support, templates, users, workers, workflows

Codex may inspect the full backend. Codex must not assume the system is limited to lead sending, workers, or campaigns.

## Current build and validation commands

Use these commands when relevant:

```bash
npm run prisma:generate
npm run build
npx prisma validate --config ./prisma.config.ts
```

Do not run migrations unless the user explicitly asks for migration work.

## Editing rules

1. Provide whole replacement files only. Never provide stitched patches, fragments, or partial replacements.
2. Preserve existing structure unless the task explicitly asks for structural change.
3. Do not shorten files as a side effect of editing.
4. Do not remove existing behavior unless the request explicitly requires it.
5. Do not create parallel lifecycle systems.
6. Do not bypass billing, agreements, subscription, auth, policy, or campaign-state enforcement.
7. Do not invent new production flows when an existing service/worker already owns the flow.
8. Do not expose secrets. Env variable names are allowed. Secret values are not.
9. Do not hardcode customer-specific or environment-specific values.
10. Do not make frontend assumptions. Backend truth must remain independent of frontend design.

## Runtime authority boundaries

Codex may help implement backend AI wiring, but production decisions must be made by Orchestrate backend services and recorded in the database.

Codex must not become:

- a live lead selector
- a live sender
- a billing decider
- a campaign starter
- a reply classifier in production
- a substitute for persisted AI decision records

## AI wiring direction

When wiring AI into execution, use documented choke points only:

- campaign activation and restart
- lead import and source planning
- first-send enqueue and send execution
- message generation
- follow-up scheduling and follow-up send
- reply classification
- meeting handoff
- provider selection and provider fallback
- deliverability guardrails
- support/system doctor/operator diagnosis

Every AI-controlled or AI-assisted decision must be traceable through persisted data: entity type, entity id, decision, reason, confidence, allowed/blocked state, timestamp, and later outcome.

## Protected zones

Changes to these areas require extra care because they enforce money, identity, legal state, or execution truth:

- src/auth
- src/access-context
- src/organizations
- src/users
- src/clients
- src/billing
- src/subscriptions
- src/agreements
- src/invoices
- src/statements
- src/financial-documents
- src/emails
- src/deliverability
- src/campaigns
- src/execution
- src/workers
- src/providers
- src/sources
- src/leads
- src/replies
- src/meetings
- prisma/schema.prisma
- prisma/migrations

Protected does not mean untouchable. It means Codex must preserve enforcement behavior and explain the exact reason for any change.

## Repository-specific notes

- ExecutionService currently owns dispatch loop, campaign continuity, queueing, immediate send execution, reply classification, meeting handoff, and bootstrap/refill behavior.
- WorkersService owns worker registry and dispatches jobs to concrete worker services.
- Worker implementations live under src/workers/* and include lead import, message generation, first send, follow-up, reply classification, meeting handoff, inbox sync, enrichment, scoring, alert generation, and invoice generation.
- AiService already exists and contains campaign activation bootstrap, outbound draft generation, growth messages, sequence generation, reminders, agreements, and statement summaries.
- Provider control exists under src/providers and sourcing control exists under src/sources.
- Prisma schema already includes rich execution models including Job, JobRun, WorkflowRun, ProviderUsageLog, SourceRun, DiscoveredEntity, ReachabilityRecord, QualificationDecision, AdaptationDecision, OutreachMessage, Reply, Meeting, ActivityEvent, AuditLog, Alert, PolicySetting, and related billing/legal models.

## Required response style for code work

When completing a code task, report:

1. Files reviewed.
2. Files changed.
3. Validation commands run and results.
4. Any risk or follow-up needed.

Do not claim a build passed unless it actually ran and passed.
