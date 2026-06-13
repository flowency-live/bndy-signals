# Migration and Release Plan

## 1. Migration principle

This is a progressive enhancement programme, not a rebuild.

The existing product remains live. Current venue, artist and event records remain readable by frontstage/backstage throughout. New source, signal, claim and trust features are added alongside the current system and only become user-visible once proven.

## 2. Release strategy

Use small, reversible releases:

- additive schema first;
- no destructive data migration;
- backfill in batches;
- feature flags for public UX;
- operator-only tools before public exposure;
- preserve existing APIs until replacement paths are verified.

## 3. Phase 0: Baseline and safety

### Objectives

- Confirm current active repos and runtime responsibilities.
- Freeze current production read contracts.
- Add observability around enrichment and data quality.

### Tasks

- Document existing venue, artist and event schemas.
- Export current counts and completeness metrics.
- Identify all existing enrichment fields.
- Identify duplicate and stale record patterns.
- Add basic data quality report.

### Exit criteria

- Current production schema and API contract documented.
- Baseline data quality metrics captured for 1,200 venues and 1,600 artists.
- No production behaviour changed.

## 4. Phase 1: Add source records

### Objectives

Create first-class `Source` records linked to existing venues, artists and events.

### Tasks

- Add `sources` table/collection.
- Add source type enum.
- Add source status enum.
- Add source evidence strength enum.
- Add source creation/update service.
- Add source summary projection service.
- Add tests for source natural keys.

### Backfill

Create source records from existing fields:

- Google Place IDs;
- websites;
- Facebook URLs;
- Instagram URLs;
- event Facebook URLs.

### Exit criteria

- Existing entity records unchanged.
- Source records exist for known links/external IDs.
- Re-running backfill is idempotent.
- Source summary can be queried by entity.

## 5. Phase 2: Introduce claims around enrichment

### Objectives

Move from direct enrichment writes to proposed claims.

### Tasks

- Add claim types for source and field updates.
- Add claim store.
- Add claim review endpoints.
- Add claim applier for low-risk source updates.
- Add audit trail.
- Add manual accept/reject/challenge actions.

### Exit criteria

- New enrichment can produce claims without mutating canonical records.
- Accepted source claims create/update source records.
- Rejected claims remain auditable.

## 6. Phase 3: MCP contract change

### Objectives

Make MCP an operator interface into signals/claims rather than the primary enrichment engine.

### Tasks

- Add MCP tool: `submit_signal`.
- Add MCP tool: `propose_source`.
- Add MCP tool: `list_claims_for_review`.
- Add MCP tool: `review_claim`.
- Add MCP tool: `get_entity_sources`.
- Deprecate any MCP tool that directly mutates canonical state without claims, or wrap it in claim generation.

### Exit criteria

- Claude Cowork can still be used, but only as a client.
- Bulk enrichment can run without Claude Cowork.
- MCP actions are auditable.

## 7. Phase 4: Move event discovery into bndy-signals

### Objectives

Unify event discovery with the signal/claim model.

### Tasks

- Convert HTML/event extraction into signal workflow tasks.
- Generate `EVENT_EXISTS`, `VENUE_HAS_SOURCE` and `ARTIST_HAS_SOURCE` claims.
- Add duplicate detection before event creation.
- Add auto-apply rule for very high-confidence low-risk event candidates.
- Add review workflow for ambiguous event candidates.

### Exit criteria

- Existing tactical event-agent Lambda remains available but is no longer the preferred path.
- New event discovery path produces claims.
- Approved claims create or update canonical events.

## 8. Phase 5: Admin/backstage review tools

### Objectives

Give operators a practical queue for cleaning data.

### Tasks

- Claims list with filters.
- Source list by entity.
- Entity data quality screen.
- Duplicate candidate screen.
- Low confidence event screen.
- Bulk accept/reject for safe claim groups.

### Exit criteria

- Operators can process enrichment without local Claude sessions.
- Claims can be prioritised by risk and confidence.
- Review decisions are logged.

## 9. Phase 6: Frontstage trust indicators

### Objectives

Expose simple public trust/status signals without overcomplicating UX.

### Tasks

- Add trust projection endpoint.
- Add event confidence/status badge.
- Add venue/artist source-backed labels.
- Add report correction link.
- Add source attribution section where useful.
- Release behind feature flag.

### Exit criteria

- Users can see whether an event is verified/source-backed/recently found/needs confirmation.
- Existing event browsing remains unchanged if feature flag off.

## 10. Phase 7: Scheduled discovery and prioritisation

### Objectives

Discover new data without building a crawler that burns money.

### Priorities

- known venues with no upcoming events;
- known artists with no upcoming events;
- towns with active users;
- claimed venues/artists;
- popular searches;
- stale sources;
- high-value gaps.

### Exit criteria

- Discovery jobs run on a budget.
- Search/model costs are tracked.
- Duplicate discoveries are suppressed.

## 11. Rollback strategy

Because the model is additive, rollback is mostly feature-flag and route based:

- disable frontstage trust indicators;
- disable auto-apply rules;
- pause scheduled discovery;
- route MCP back to manual/operator mode;
- keep source/claim records dormant without affecting canonical reads.

## 12. Done definition

The migration is complete when:

- sources are first-class;
- claims are the default change proposal mechanism;
- bndy-signals owns ingestion and interpretation;
- MCP is a client, not the runtime;
- production UX can show source-backed trust;
- existing product remains stable throughout.