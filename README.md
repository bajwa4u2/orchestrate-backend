# Orchestrate Backend — Execution Core Pass

This package continues the backend foundation pass and moves Orchestrate into real loop execution.

Included in this pass:

- execution job queue endpoints
- first-send and follow-up queueing
- due-job dispatch and runner endpoints
- deliverability domain, mailbox, policy, suppression, bounce, complaint flows
- mailbox health refresh logic
- reply intake and intent classification
- meeting handoff creation from interested replies
- expanded control overview

## Main endpoints

- `GET /v1/health`
- `GET /v1/control`
- `POST /v1/leads`
- `POST /v1/leads/:leadId/test-send`
- `POST /v1/leads/:leadId/queue-first-send`
- `POST /v1/leads/:leadId/queue-follow-up`
- `POST /v1/execution/dispatch-due`
- `POST /v1/execution/jobs/:jobId/run`
- `POST /v1/deliverability/domains`
- `POST /v1/deliverability/mailboxes`
- `POST /v1/deliverability/policies`
- `POST /v1/deliverability/suppressions`
- `POST /v1/deliverability/mailboxes/:mailboxId/bounces`
- `POST /v1/deliverability/mailboxes/:mailboxId/complaints`
- `POST /v1/replies/intake`
- `GET /v1/replies`
- `GET /v1/meetings`

## Notes

This pass still does not include real mailbox OAuth, inbox sync workers, or external booking integrations. It does make the core loop executable inside your own system boundaries.
