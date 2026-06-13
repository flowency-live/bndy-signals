# Architectural Decision Records

## ADR-001: Use progressive enhancement, not big-bang rebuild

### Status

Accepted.

### Context

The existing bndy product is live and already contains venue, artist and event data. Rebuilding would introduce unnecessary risk.

### Decision

Add sources, signals, claims and trust projections alongside existing records.

### Consequences

- Existing product remains stable.
- Migration can happen gradually.
- Some duplication exists during transition.
- Projection/synchronisation logic is required.

---

## ADR-002: Sources are first-class records

### Status

Accepted.

### Context

Venue, artist and event records need multiple sources: Facebook, Instagram, websites, Google Places, event pages, posters and user submissions.

### Decision

Create first-class `Source` records linked to entities rather than storing all source data as arrays on entity records.

### Consequences

- Better provenance and auditability.
- Easier source freshness tracking.
- Easier conflict detection.
- Requires source projection for frontstage convenience.

---

## ADR-003: Signals are immutable raw evidence

### Status

Accepted.

### Context

AI/interpreted data must be traceable to what was actually observed.

### Decision

Store signals as immutable records with raw evidence references.

### Consequences

- Interpretations can be rerun with new prompts/models.
- Audit trail improves.
- Storage costs increase slightly.

---

## ADR-004: LLMs produce claims, not direct writes

### Status

Accepted.

### Context

AI extraction can be wrong. Directly writing inferred data into production records risks trust and data quality.

### Decision

LLM and deterministic interpretation generate claims. Claims require review or safe auto-apply rules before canonical records change.

### Consequences

- Safer enrichment.
- Review queue required.
- More operational complexity.
- Better auditability.

---

## ADR-005: MCP is a client, not the runtime

### Status

Accepted.

### Context

Claude Cowork plus local MCP is useful but expensive and not scalable as a production enrichment engine.

### Decision

MCP should call bndy APIs/workflows and submit signals/claims. It should not own the only business logic or be required for bulk processing.

### Consequences

- Bulk enrichment can run independently.
- Claude remains useful for exception handling.
- MCP tools need to be refactored around service contracts.

---

## ADR-006: Reuse Google where useful, do not rebuild it

### Status

Accepted.

### Context

Google already discovers and ranks public web data and has strong venue identity/location data.

### Decision

Use Google Places and Google-visible public signals as inputs, but do not attempt to recreate generic search or mapping.

### Consequences

- Lower build cost.
- bndy focuses on UK grassroots music depth.
- Need source-agnostic design so bndy is not dependent on one provider.

---

## ADR-007: Do not build around Facebook scraping

### Status

Accepted.

### Context

Facebook contains valuable grassroots gig data but scraping is brittle and can create technical/legal risk.

### Decision

Use user-submitted links, public metadata, Google-visible references and source-backed claims. Do not make high-volume Facebook scraping a core dependency.

### Consequences

- Lower platform risk.
- May miss some data.
- Community submission and Google/public web signals become important.

---

## ADR-008: bndy-signals is the canonical intelligence runtime

### Status

Accepted.

### Context

bndy-signals already aligns with the desired loop: signal intake, deterministic extraction, interpretation, claims, human review and memory update.

### Decision

Use bndy-signals as the strategic runtime for enrichment, event discovery, evidence and claims.

### Consequences

- Existing tactical Lambdas should migrate logic into this model over time.
- Repo responsibilities become clearer.
- Requires integration with existing entity APIs.

---

## ADR-009: Trust projection is separate from raw claims

### Status

Accepted.

### Context

Frontstage should not query or interpret raw claims for every event or profile.

### Decision

Create a simple trust projection per entity.

### Consequences

- Frontstage remains fast and simple.
- Public UX can use simple labels.
- Projection updater must stay consistent with claims/sources.

---

## ADR-010: Auto-apply only low-risk high-confidence claims

### Status

Accepted.

### Context

Manual review for everything does not scale, but automatic mutation can damage trust.

### Decision

Allow auto-apply only for low-risk, high-confidence claims, especially additive source claims.

### Consequences

- Operational load is reduced.
- Risky changes still require review.
- Confidence/risk scoring must be conservative.

---

## ADR-011: Preserve legacy convenience fields during transition

### Status

Accepted.

### Context

Existing frontstage/backstage code may expect fields such as website, Facebook URL or Google Place ID on entity records.

### Decision

Do not remove existing fields immediately. Use sources as the richer provenance model and maintain projections into legacy fields where needed.

### Consequences

- Compatibility maintained.
- Temporary duplication exists.
- Later cleanup can remove/reduce legacy fields after migration.

---

## ADR-012: Treat free/local grassroots music as the product moat

### Status

Accepted.

### Context

Google is broad. bndy needs a narrower reason to exist.

### Decision

Focus on UK grassroots live music, especially local/free events, venue/artist relationships, community correction and source-backed trust.

### Consequences

- Product scope becomes clearer.
- Discovery prioritisation can focus on towns, venues, artists and community demand.
- bndy avoids competing as a generic event search engine.