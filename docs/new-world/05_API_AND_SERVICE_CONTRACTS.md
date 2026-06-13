# API and Service Contracts

## 1. Intent

This document defines the target service contracts for signals, sources, claims, review actions and approved graph updates.

Contracts should be implemented progressively. Existing production APIs should remain stable until replacement paths are proven.

## 2. Service boundaries

### Signal service

Owns raw evidence intake and lifecycle.

### Source service

Owns first-class source records linked to venues, artists and events.

### Claim service

Owns proposed changes and review state.

### Claim applier service

Applies approved claims to canonical bndy records and source records.

### Trust projection service

Produces simple public trust labels from sources and claims.

## 3. Signal API

### POST `/signals`

Create a signal.

```json
{
  "signalType": "url",
  "submittedVia": "mcp",
  "sourceUrl": "https://example.com/gigs",
  "rawText": null,
  "relatedEntityHints": [
    { "entityType": "venue", "entityId": "venue_123", "name": "The Example Arms" }
  ]
}
```

Response:

```json
{
  "signalId": "sig_123",
  "status": "received"
}
```

### GET `/signals/{signalId}`

Returns signal, extraction, interpretation and claim summary.

## 4. Source API

### POST `/sources`

Create or upsert a source.

```json
{
  "entityType": "venue",
  "entityId": "venue_123",
  "sourceType": "facebook_profile",
  "url": "https://facebook.com/examplevenue",
  "confidence": 0.92,
  "evidenceStrength": "primary",
  "status": "active"
}
```

Rules:

- Must be idempotent by natural key.
- Must canonicalise URLs where possible.
- Must not overwrite stronger sources with weaker ones without review.

### GET `/entities/{entityType}/{entityId}/sources`

Returns all source records for an entity.

### PATCH `/sources/{sourceId}`

Updates status, confidence, last fetched date or notes.

## 5. Claim API

### POST `/claims`

Create a proposed claim.

```json
{
  "signalId": "sig_123",
  "claimType": "VENUE_HAS_SOURCE",
  "targetEntityType": "venue",
  "targetEntityId": "venue_123",
  "proposedChange": {
    "sourceType": "website",
    "url": "https://examplevenue.co.uk"
  },
  "confidence": 0.88,
  "risk": "low",
  "reasons": ["website title matches venue name and town"],
  "evidenceRefs": ["s3://.../raw.html"]
}
```

Response:

```json
{
  "claimId": "claim_123",
  "status": "proposed"
}
```

### GET `/claims`

Filters:

- `status`
- `claimType`
- `targetEntityType`
- `targetEntityId`
- `risk`
- `minConfidence`
- `createdAfter`

### POST `/claims/{claimId}/review`

```json
{
  "action": "accept",
  "reviewerType": "human",
  "reviewerId": "user_123",
  "reason": "Official venue website confirmed"
}
```

Allowed actions:

- `accept`
- `reject`
- `challenge`
- `defer`

### POST `/claims/{claimId}/apply`

Applies an accepted claim. This should be idempotent.

Response:

```json
{
  "claimId": "claim_123",
  "status": "applied",
  "updatedEntities": [
    { "entityType": "venue", "entityId": "venue_123" },
    { "entityType": "source", "entityId": "src_123" }
  ]
}
```

## 6. Enrichment API

### POST `/enrichment/jobs`

Create an enrichment job.

```json
{
  "entityType": "venue",
  "entityIds": ["venue_123", "venue_456"],
  "jobType": "source_discovery",
  "budget": {
    "maxSearches": 2,
    "maxModelCalls": 1,
    "allowExpensiveModel": false
  }
}
```

Response:

```json
{
  "jobId": "job_123",
  "status": "queued"
}
```

## 7. Trust projection API

### GET `/entities/{entityType}/{entityId}/trust`

Response:

```json
{
  "entityType": "venue",
  "entityId": "venue_123",
  "verificationStatus": "source_backed",
  "publicLabel": "Source-backed",
  "sourceCount": 3,
  "primarySourceCount": 1,
  "confidence": 0.87,
  "warnings": [],
  "updatedAt": "2026-06-13T10:00:00Z"
}
```

## 8. Claim application rules

### Source claims

Low-risk source claims may be auto-applied if:

- confidence >= 0.9;
- target entity already exists;
- source URL is valid;
- natural key does not conflict with another entity;
- source type is not high-risk or disputed.

### Event claims

Event claims may be auto-applied only when:

- venue and artist are confidently matched;
- date is unambiguous;
- duplicate key is clear;
- source evidence is not stale;
- confidence threshold is met.

Otherwise route to review.

### Field updates

Field update claims should be conservative. Do not overwrite human-verified fields with inferred fields unless reviewed.

## 9. MCP-facing contracts

MCP tools should use these service contracts, not implement separate logic.

Suggested tools:

- `submit_signal(input)`
- `get_signal(signalId)`
- `get_entity_sources(entityType, entityId)`
- `propose_source(entityType, entityId, source)`
- `list_claims(filters)`
- `review_claim(claimId, action, reason)`
- `request_enrichment(entityType, entityIds, options)`

## 10. Error handling

All APIs should return structured errors:

```json
{
  "error": {
    "code": "CLAIM_CONFLICT",
    "message": "Source URL already linked to another venue",
    "details": {
      "conflictingEntityId": "venue_456"
    }
  }
}
```

## 11. Idempotency

Required for:

- signal intake with same content hash;
- source upsert;
- claim creation from same signal and proposed change;
- claim application;
- enrichment jobs.

## 12. Audit requirements

Every state-changing action must capture:

- actor;
- timestamp;
- previous state where applicable;
- new state;
- reason;
- source/claim/signal relationship.