# Target Architecture: bndy Source, Signal and Claim Runtime

## 1. Architectural intent

The target architecture preserves the existing bndy product while adding a source-backed intelligence layer around it.

The live product should continue to read from existing venue, artist and event records. The new runtime introduces signals, sources, claims, evidence packs and review workflows as additive capabilities.

## 2. Target operating flow

```text
External signal / user submission / MCP action / scheduled discovery
  -> signal intake API
  -> raw evidence storage
  -> deterministic extraction
  -> interpretation
  -> claim generation
  -> confidence and ambiguity scoring
  -> review queue
  -> approved claim application
  -> canonical bndy graph update
  -> frontstage/backstage/API consumption
```

## 3. System principles

1. Existing production paths remain stable.
2. Signals are immutable evidence.
3. LLMs interpret evidence; they do not directly own state.
4. Claims propose changes; approved claim application mutates canonical state.
5. Sources are first-class records, not incidental fields on entities.
6. MCP is an operator interface, not the production workflow engine.
7. Google, public web metadata and external IDs are reused where useful.
8. Cost control is designed into the workflow from the start.
9. Everything important is auditable.

## 4. Repo responsibility split

### bndy-signals

Canonical runtime for:

- signal intake;
- raw evidence storage;
- deterministic extraction;
- interpretation;
- claim creation;
- confidence scoring;
- ambiguity handling;
- review workflow;
- source/evidence correlation;
- cost tracking.

### bndy-serverless-api

Operational API layer for:

- existing bndy entity APIs;
- approved claim application;
- public API compatibility;
- auth/session flows where already present;
- entity read/write endpoints used by frontstage/backstage.

Over time, direct enrichment logic should move out of fat Lambda handlers into shared services or bndy-signals tasks.

### bndy-MCP

Operator interface for:

- submit signal;
- inspect entity sources;
- propose venue/artist/event source;
- request enrichment;
- review claim;
- apply approved claim;
- debug data quality cases.

MCP should call the same APIs/workflows as other clients. It should not be the only place business logic exists.

### bndy-frontstage

Public product experience for:

- event discovery;
- map experience;
- venue profiles;
- artist profiles;
- event confidence/status display;
- claim/correction prompts later.

### bndy-backstage

Admin/operator experience for:

- source review;
- claim review;
- duplicate resolution;
- enrichment monitoring;
- low-confidence event review;
- data quality reporting.

### bndy-types

Shared canonical TypeScript types for:

- sources;
- signals;
- claims;
- verification states;
- evidence packs;
- public trust labels;
- entity source summaries.

## 5. Logical components

### Signal intake

Receives raw evidence from:

- public submit forms;
- MCP;
- admin tools;
- scheduled discovery;
- manual HTML/poster upload;
- future venue/artist feeds.

Stores raw input before processing.

### Deterministic extractor

Low-cost extraction stage using:

- URL parsing;
- OpenGraph metadata;
- JSON-LD;
- HTML title/meta/h1/h2;
- date regex;
- postcode/address detection;
- image OCR where required;
- known bndy entity matching.

### Interpretation runner

Uses a cheap model only when deterministic extraction is insufficient. Produces structured claims in strict schemas.

### Claim store

Stores proposed world-state changes with status and evidence.

### Review service

Allows humans or approved automated rules to accept, reject, challenge or defer claims.

### Claim applier

Applies approved claims to canonical entity records and source records. This must be idempotent.

### Source registry

First-class store of source records linked to venues, artists and events.

### Frontstage trust projection

Computes simple public labels from underlying source and claim state.

## 6. Data flow: venue enrichment

```text
Venue missing website/social/Google Place source
  -> enrichment job creates signal
  -> deterministic extraction checks existing fields and external IDs
  -> Google Place lookup if needed
  -> source claim generated
  -> confidence scored
  -> auto-apply if high confidence and low risk, otherwise review
  -> source linked to venue
  -> venue trust projection updated
```

## 7. Data flow: event discovery

```text
Known artist/venue/town has no upcoming events
  -> scheduled discovery creates signal from public web result / submitted source
  -> extraction identifies event-like facts
  -> claims proposed: EVENT_EXISTS, VENUE_HAS_SOURCE, ARTIST_HAS_SOURCE
  -> duplicate/natural-key check
  -> review or auto-apply
  -> event becomes public only when confidence/status rules allow
```

## 8. AWS target shape

```text
API Gateway
  -> Lambda: signal-intake
  -> S3: raw evidence
  -> DynamoDB: signal metadata
  -> Step Functions: workflow orchestration
       -> deterministic-extractor Lambda
       -> interpretation-runner Lambda / Bedrock
       -> claim-builder Lambda
       -> review-router Lambda
  -> DynamoDB: claims, sources, evidence packs
  -> Lambda: claim-review
  -> Lambda: claim-applier
  -> existing bndy API/entity stores
```

Use SQS or EventBridge where batch and retry isolation is needed.

## 9. Compatibility strategy

The existing venue, artist and event records remain the canonical read model for the current product.

New records link outward:

```text
source.entityType = venue | artist | event
source.entityId = existing entity id
claim.targetEntityId = existing entity id or null for proposed new entity
```

This avoids breaking current frontstage/backstage consumers.

## 10. Migration strategy

1. Add sources store and source summary projection.
2. Backfill source records from existing fields.
3. Add claim applier that updates existing records safely.
4. Route new enrichment through claims.
5. Add admin review UI.
6. Add frontstage trust labels under feature flag.
7. Decommission direct-write enrichment paths only after parity.

## 11. Key risks

| Risk | Mitigation |
|---|---|
| Data quality worsens due to AI claims | Claims do not directly mutate canonical state; review and confidence thresholds required |
| Token costs rise | Deterministic extraction first; cheap models; batch; caching; budgets |
| Existing product breaks | Additive model; compatibility read model; feature flags |
| Google/Facebook assumptions fail | Source-agnostic design; use public signals but do not depend on one source |
| Duplicate venues/artists increase | Natural keys, Google Place IDs, source correlation, duplicate claims |
| Operators overwhelmed | Auto-apply only low-risk high-confidence claims; prioritised review queue |

## 12. Target end state

bndy-signals becomes the engine for turning messy public/local music evidence into source-backed claims. Existing bndy APIs and products consume approved, canonical outputs. MCP, Claude, admin UI and scheduled jobs become clients of the same runtime rather than independent enrichment paths.