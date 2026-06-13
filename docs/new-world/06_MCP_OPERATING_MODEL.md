# MCP Operating Model

## 1. Intent

The bndy MCP server should become an operator interface into the bndy signal, source and claim system. It should not be the production enrichment runtime.

Claude Cowork is useful because it can call local MCP tools, inspect context and perform agentic workflows. That is valuable for development and exception handling, but too expensive and too manual for bulk enrichment.

## 2. Current issue

The current model risks this shape:

```text
Claude Cowork
  -> local bndy MCP
  -> bndy data changes
```

That makes Claude Cowork both the reasoning engine and workflow runtime. Scaling that means scaling an expensive interactive agent, not a product capability.

## 3. Target model

```text
Claude Cowork / ChatGPT / admin UI / scheduled job / operator script
  -> bndy MCP or API
  -> bndy-signals
  -> signals, sources, claims, review, approved updates
```

MCP becomes one client of the same runtime as everything else.

## 4. MCP principles

1. MCP tools should submit signals and claims rather than directly mutating production records.
2. Direct writes should be restricted to explicit approved apply actions.
3. MCP actions must be auditable.
4. MCP should call shared service contracts.
5. MCP should be useful for investigation, exception review and debugging.
6. Bulk enrichment should run through jobs/workers, not chat-agent loops.

## 5. Suggested tool set

### `submit_signal`

Submit raw evidence into bndy-signals.

Input:

```json
{
  "signalType": "url",
  "sourceUrl": "https://example.com/gigs",
  "relatedEntityHints": [
    { "entityType": "venue", "entityId": "venue_123" }
  ]
}
```

Output:

```json
{
  "signalId": "sig_123",
  "status": "received"
}
```

### `get_signal`

Read signal, extraction, interpretation and claim summary.

### `get_entity_sources`

Return all sources linked to an artist, venue or event.

### `propose_source`

Create a source claim for an existing entity.

### `request_enrichment`

Create a batch or single-entity enrichment job.

### `list_claims_for_review`

Return claims filtered by status, confidence, risk and entity type.

### `review_claim`

Accept, reject, challenge or defer a claim.

### `apply_claim`

Apply an accepted claim. This should be guarded and idempotent.

### `find_possible_duplicates`

Return possible duplicate venues/artists based on name, source, location and external IDs.

## 6. Deprecated MCP behaviours

Avoid MCP tools that:

- write directly to venue/artist/event records without a claim;
- perform uncontrolled web discovery;
- call expensive models without budget limits;
- hide source evidence;
- overwrite existing verified fields;
- make non-idempotent changes.

If a direct write tool must remain for short-term compatibility, wrap it with logging and mark it as legacy.

## 7. Operator workflows

### Venue source enrichment

```text
Operator asks MCP to enrich venue
  -> MCP creates enrichment job or signal
  -> bndy-signals extracts/interprets
  -> claims created
  -> operator reviews claim queue
  -> approved claims update sources/entity projection
```

### Ambiguous artist resolution

```text
Operator asks MCP for ambiguous claims
  -> MCP lists low-confidence artist claims
  -> operator inspects source/evidence pack
  -> accept/reject/challenge
```

### Event discovery review

```text
MCP lists new EVENT_EXISTS claims
  -> operator sees source, venue match, artist match, confidence
  -> approved event claim creates canonical event
```

## 8. Security and permissions

MCP should have scoped operations:

| Tool type | Permission |
|---|---|
| Read entity/source/claim | operator read |
| Submit signal | operator write |
| Propose claim | operator write |
| Review claim | reviewer |
| Apply claim | privileged reviewer/admin |
| Direct canonical update | deprecated/admin only |

## 9. Cost controls

MCP should not decide model spend ad hoc. Requests should include budgets:

```json
{
  "maxSearches": 2,
  "maxModelCalls": 1,
  "maxInputTokens": 3000,
  "allowExpensiveModel": false
}
```

The enrichment runtime enforces the budget.

## 10. Local vs hosted MCP

Short term:

- local MCP remains useful for development;
- it calls deployed APIs/workflows rather than local-only code.

Medium term:

- host MCP-compatible service where needed;
- keep auth and audit consistent;
- ensure admin UI can perform the same actions without MCP.

## 11. Success criteria

- Bulk enrichment no longer requires Claude Cowork.
- MCP remains useful for operator/developer workflows.
- Every MCP mutation creates an auditable signal, claim or review action.
- The same source/claim workflow is used by MCP, admin tools and scheduled jobs.