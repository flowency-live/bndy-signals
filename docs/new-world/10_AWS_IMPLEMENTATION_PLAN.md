# AWS Implementation Plan

## 1. Intent

This plan uses the existing bndy-signals direction as the foundation for the new source-backed ingestion and enrichment runtime.

The implementation should be AWS-native, cost-aware and progressive. It should not require a rebuild of the existing product.

## 2. Target AWS components

| Component | Purpose |
|---|---|
| API Gateway | Signal, claim and review APIs |
| Lambda | Intake, extraction, interpretation, claim building, review/apply functions |
| Step Functions | Signal workflow orchestration |
| S3 | Raw evidence storage: HTML, text, images, snapshots |
| DynamoDB | Signals, sources, claims, evidence packs, trust projections |
| EventBridge | Scheduled enrichment/discovery jobs |
| SQS | Optional buffering for batch jobs and review queues |
| Bedrock | Cheap model interpretation and structured extraction |
| CloudWatch | Logs, metrics, alarms |
| IAM | Least-privilege service permissions |

## 3. Logical stacks

### Signals stack

- signal intake Lambda;
- raw evidence S3 bucket;
- signal metadata DynamoDB table;
- Step Functions workflow.

### Interpretation stack

- deterministic extractor Lambda;
- interpretation runner Lambda;
- Bedrock permissions;
- prompt/version configuration.

### Claims stack

- claims table;
- sources table;
- evidence packs table;
- review endpoint;
- claim applier endpoint.

### Discovery stack

- EventBridge schedules;
- enrichment job queue;
- discovery worker;
- budget and cost tracking.

### Projection stack

- trust projection table;
- projection updater Lambda;
- lightweight read endpoints for frontstage/backstage.

## 4. DynamoDB tables

### `bndy-signals-{env}`

Primary key: `signalId`

Stores signal metadata and processing status.

### `bndy-sources-{env}`

Suggested keys:

- PK: `entityType#entityId`
- SK: `sourceType#naturalKey`

GSI:

- `sourceType#canonicalUrl`
- `externalId`
- `status`

### `bndy-claims-{env}`

Suggested keys:

- PK: `claimId`

GSIs:

- `status#createdAt`
- `targetEntityType#targetEntityId`
- `claimType#status`
- `risk#confidence`

### `bndy-evidence-packs-{env}`

Primary key: `evidencePackId`.

### `bndy-trust-projections-{env}`

PK: `entityType#entityId`.

## 5. Step Functions workflow

```text
Receive signal
  -> Store raw evidence
  -> Deterministic extraction
  -> ShouldInterpret?
      -> no: Build claims from extraction
      -> yes: Run interpretation
  -> Validate structured output
  -> Build claims
  -> Score confidence/risk
  -> AutoApply?
      -> yes: Apply approved claim
      -> no: Put in review queue
  -> Update signal status
```

## 6. Lambda responsibilities

### `signal-intake`

- authenticate if required;
- validate input;
- store raw evidence;
- create signal metadata;
- start workflow.

### `deterministic-extractor`

- parse metadata;
- extract JSON-LD/OpenGraph;
- normalise URLs;
- detect dates, times, postcodes and names;
- produce extraction record.

### `interpretation-runner`

- call cheap model only when required;
- use strict JSON output;
- validate schema;
- track token use and cost;
- fail loudly on parse/schema failure.

### `claim-builder`

- map extraction/interpretation to claims;
- attach evidence refs;
- score confidence/risk.

### `claim-review`

- accept/reject/challenge/defer claims;
- write audit action.

### `claim-applier`

- idempotently apply accepted claims;
- create/update sources;
- update canonical records where allowed;
- update trust projections.

## 7. Cost controls

Implement:

- deterministic-first extraction;
- source/content hash caching;
- model input size limits;
- prompt versions;
- cheap model defaults;
- expensive model disabled by default;
- per-job budgets;
- per-signal cost fields;
- alarms for unusual model/search spend.

## 8. Environments

Use at least:

- `dev`;
- `prod`.

Optionally:

- `staging` for frontstage/backstage testing.

All tables, buckets and workflows should be environment-prefixed/suffixed.

## 9. Security

- Least-privilege IAM per Lambda.
- No public write endpoints without rate limiting/auth/captcha where applicable.
- Store API keys/secrets in AWS Secrets Manager or SSM Parameter Store.
- Validate URLs and content size before fetching.
- Restrict claim application to trusted roles or automated rules.

## 10. Observability

Metrics:

- signals received;
- extraction success/failure;
- interpretation success/failure;
- parse failures;
- claims generated;
- claims auto-applied;
- claims needing review;
- average cost per signal;
- token usage;
- review backlog size.

Alarms:

- high failure rate;
- high model cost;
- high review backlog;
- claim applier errors;
- DynamoDB throttling.

## 11. Implementation sequence

1. Add sources table and source service.
2. Add claims table and claim service.
3. Add claim review/apply endpoints.
4. Add trust projection table.
5. Add deterministic extraction improvements.
6. Route MCP `submit_signal` into signal-intake.
7. Add source backfill job.
8. Add admin review endpoints.
9. Add scheduled enrichment jobs.
10. Add frontstage read projection endpoints.

## 12. Avoid

- running everything through one fat Lambda;
- scanning large tables in hot paths;
- making LLM calls before deterministic extraction;
- mixing admin review logic with public read APIs;
- direct production writes from MCP without claims;
- hardcoding location context in general-purpose workflows.