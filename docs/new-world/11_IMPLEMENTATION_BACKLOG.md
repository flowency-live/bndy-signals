# Implementation Backlog

## 1. Backlog structure

This backlog is sequenced to protect the live product while adding source, signal, claim and trust capabilities progressively.

Priority legend:

- P0: foundational / required before meaningful migration;
- P1: core workflow;
- P2: product enhancement;
- P3: later optimisation.

## 2. Epic: Source registry

### P0: Define source types and schemas

- Add shared TypeScript `Source` type.
- Add source type enum.
- Add source status enum.
- Add evidence strength enum.
- Add source natural key rules.

### P0: Add sources table/collection

- Create infrastructure.
- Add create/upsert source service.
- Add get sources by entity service.
- Add tests for idempotency.

### P1: Backfill existing sources

- Backfill venue Google Place IDs.
- Backfill venue websites.
- Backfill venue Facebook/Instagram links.
- Backfill artist websites/social links.
- Backfill event Facebook URLs.
- Produce backfill report.

## 3. Epic: Claims

### P0: Define claim model

- Add `Claim` type.
- Add claim status enum.
- Add claim type enum.
- Add claim risk enum.

### P1: Add claim service

- Create claim.
- List claims by filter.
- Get claims by entity.
- Accept/reject/challenge/defer.
- Audit review actions.

### P1: Add claim applier

- Apply source claims.
- Apply event existence claims.
- Apply safe field update claims.
- Guard destructive changes.
- Ensure idempotency.

## 4. Epic: Signal workflow

### P0: Align existing bndy-signals workflow

- Confirm current signal-intake contract.
- Confirm extraction output schema.
- Confirm interpretation output schema.
- Confirm claim creation path.

### P1: Add source-related signal handling

- URL signal to source claim.
- HTML signal to venue/artist/event source claim.
- Poster/image signal to event claim.
- MCP signal to claim workflow.

### P1: Improve deterministic extraction

- URL canonicalisation.
- OpenGraph extraction.
- JSON-LD extraction.
- Date/time parsing.
- postcode/address extraction.
- social URL detection.

## 5. Epic: MCP migration

### P0: Document current MCP tools

- List tools.
- Mark direct-write tools.
- Mark read-only tools.
- Mark tools to deprecate or wrap.

### P1: Add new MCP tools

- `submit_signal`.
- `get_signal`.
- `get_entity_sources`.
- `propose_source`.
- `request_enrichment`.
- `list_claims_for_review`.
- `review_claim`.
- `apply_claim`.

### P1: Guard direct writes

- Add warnings/logging to legacy direct-write tools.
- Require explicit confirmation for destructive actions.
- Prefer claim creation.

## 6. Epic: Data quality and trust

### P1: Add trust projection

- Compute source count.
- Compute primary source count.
- Compute verification status.
- Compute public label.
- Store projection by entity.

### P1: Data quality reports

- Venues without sources.
- Artists without sources.
- Events without sources.
- Duplicate venue candidates.
- Duplicate artist candidates.
- Broken/stale sources.
- Claims awaiting review.

### P2: Duplicate detection

- Venue duplicate detection by name/location/Google Place/source.
- Artist duplicate detection by name/source/event overlap.
- Duplicate claim generation.
- Manual merge review later.

## 7. Epic: Admin/backstage review

### P1: Claim review queue

- List claims.
- Filter by status/risk/confidence/entity.
- Show evidence summary.
- Accept/reject/challenge/defer.

### P1: Source inspection panel

- Show sources for venue/artist/event.
- Show source status and freshness.
- Mark stale/broken/rejected.

### P2: Bulk review actions

- Bulk accept safe source claims.
- Bulk reject duplicate weak claims.
- Bulk defer ambiguous cases.

## 8. Epic: Event discovery

### P1: Convert existing event extraction to claims

- HTML extraction creates `EVENT_EXISTS` claims.
- Venue and artist source claims generated from same evidence.
- Duplicate key checks before apply.

### P2: Scheduled discovery

- Known venues without upcoming events.
- Known artists without upcoming events.
- Active towns.
- Claimed profiles.
- Stale high-value sources.

### P2: Event correction flow

- User reports wrong event.
- Correction becomes signal.
- Claims generated for cancellation/date/time/duplicate.

## 9. Epic: Frontstage UX

### P2: Feature-flag trust labels

- Event card label.
- Event detail label.
- Venue source summary.
- Artist source summary.

### P2: Correction submission

- Report wrong event.
- Submit missing source.
- Claim profile CTA placeholder.

## 10. Epic: Cost and observability

### P1: Cost tracking

- Store model name.
- Store prompt version.
- Store token counts.
- Store estimated cost.
- Report cost per signal/job.

### P1: Caching

- Source URL cache.
- Content hash cache.
- Model input hash cache.
- Google Place lookup cache.

### P1: Metrics and alarms

- Signal volume.
- Extraction failures.
- Interpretation failures.
- Claim volume.
- Review backlog.
- Auto-apply count.
- Cost spikes.

## 11. Suggested first sprint

1. Add `Source` type and table.
2. Add source upsert/get services.
3. Backfill sources from existing fields in dry-run mode.
4. Add `VENUE_HAS_SOURCE` and `ARTIST_HAS_SOURCE` claim types.
5. Add claim review/apply skeleton.
6. Add MCP `get_entity_sources` and `submit_signal`.
7. Produce data quality baseline report.

## 12. Suggested second sprint

1. Complete source backfill.
2. Add claim queue endpoints.
3. Add admin/backstage claim review view.
4. Route MCP source proposals through claims.
5. Add trust projection table.
6. Add first frontstage trust feature flag, off by default.

## 13. Suggested third sprint

1. Migrate event extraction to produce `EVENT_EXISTS` claims.
2. Add duplicate event detection.
3. Add low-risk auto-apply rules.
4. Add event correction signal.
5. Add scheduled enrichment for venues without sources.