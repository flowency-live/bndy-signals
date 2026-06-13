# bndy New World Documentation Pack

This documentation pack defines the progressive enhancement plan for moving bndy from a manually enriched live-music directory into a source-backed UK grassroots live music graph.

The plan assumes the existing production product remains live and functionally untouched for as long as possible. New capabilities are introduced behind additive data models, new services, review workflows, feature flags, and back-office/admin tooling before they are exposed publicly.

## Core principle

Do not rebuild bndy. Add a signal, source, claim and review layer around the existing product, then progressively route enrichment, discovery and verification through that layer.

## Documents

1. `01_PRD.md` - Product requirements for the new source-backed bndy world.
2. `02_TARGET_ARCHITECTURE.md` - Target architecture and repo responsibilities.
3. `03_DOMAIN_AND_DATA_MODEL.md` - Entities, sources, claims, evidence, verification states and migration model.
4. `04_MIGRATION_AND_RELEASE_PLAN.md` - Progressive migration plan with safe release sequencing.
5. `05_API_AND_SERVICE_CONTRACTS.md` - API and service contracts for signals, sources, claims and application of approved changes.
6. `06_MCP_OPERATING_MODEL.md` - How MCP should work as an operator interface, not the production runtime.
7. `07_ENRICHMENT_AND_DISCOVERY_PIPELINE.md` - Cost-controlled enrichment and discovery pipeline.
8. `08_DATA_QUALITY_AND_TRUST.md` - Data quality, confidence, source strength, provenance and trust model.
9. `09_FRONTSTAGE_UX_REQUIREMENTS.md` - Public UX requirements for source-backed and confidence-aware event discovery.
10. `10_AWS_IMPLEMENTATION_PLAN.md` - AWS implementation plan using the existing bndy-signals direction.
11. `11_IMPLEMENTATION_BACKLOG.md` - Prioritised implementation backlog.
12. `12_ADRS.md` - Architectural decision records.

## Strategic position

Google is useful for broad discovery, search snippets, place identity and public web signals. bndy should not try to rebuild Google. bndy should specialise in the UK grassroots live music scene, especially free/local gigs, source-backed event confidence, artist/venue relationships, claim/correction loops and community-level completeness.

## Existing live product constraint

The current bndy product must remain live. Existing venue, artist and event records must not be destructively migrated. New models should be additive:

- existing records remain readable by current clients;
- new source records link to existing entity IDs;
- new claims propose changes rather than directly mutating production state;
- review/apply workflows update canonical records only after approval;
- frontstage changes are introduced behind feature flags.

## New operating model

```text
Public web signal / user submission / MCP action / scheduled discovery
  -> signal intake
  -> deterministic extraction
  -> interpretation
  -> source-backed claims
  -> human or automated review
  -> approved graph update
  -> frontstage/backstage/API consumption
```

## Definition of done for the transition

The transition is successful when:

- every venue, artist and event can have first-class source records;
- enrichment work is no longer dependent on Claude Cowork;
- MCP is an operator interface into the signal/claim system;
- bndy-signals is the canonical ingestion and interpretation runtime;
- claims can be reviewed, accepted, rejected or challenged;
- source-backed verification status can be shown publicly;
- legacy records remain compatible with existing frontstage/backstage behaviour.