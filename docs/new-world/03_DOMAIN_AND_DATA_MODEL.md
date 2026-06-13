# Domain and Data Model

## 1. Intent

The new domain model adds source, signal, claim and evidence concepts around the existing bndy entities. It must be additive and backwards-compatible.

Existing venue, artist and event records remain usable by the current live product. New records link to them and gradually improve trust, enrichment and verification.

## 2. Core entities

### Existing canonical entities

- `Venue`
- `Artist`
- `Event`

These remain the public read model.

### New intelligence entities

- `Source`
- `Signal`
- `Extraction`
- `Interpretation`
- `Claim`
- `EvidencePack`
- `ReviewAction`
- `EntityTrustProjection`

## 3. Source

A source is a durable reference to an external or internal origin of evidence.

```ts
export type Source = {
  id: string;
  entityType: "venue" | "artist" | "event";
  entityId: string;

  sourceType:
    | "google_place"
    | "google_search_result"
    | "facebook_profile"
    | "facebook_event"
    | "instagram_profile"
    | "website"
    | "ticketing_page"
    | "poster_image"
    | "user_submission"
    | "bndy_claim"
    | "venue_feed"
    | "artist_feed"
    | "other";

  url?: string;
  canonicalUrl?: string;
  externalId?: string;
  platform?: string;
  handle?: string;
  displayName?: string;

  status: "active" | "stale" | "broken" | "duplicate" | "rejected" | "needs_review";
  confidence: number;
  evidenceStrength: "primary" | "secondary" | "tertiary" | "user_submitted";

  discoveredAt: string;
  lastFetchedAt?: string;
  lastVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;

  extractedFields?: Record<string, unknown>;
  rawEvidenceRef?: string;
  notes?: string;
};
```

## 4. Signal

A signal is immutable raw evidence before interpretation.

```ts
export type Signal = {
  id: string;
  signalType:
    | "url"
    | "html"
    | "image"
    | "text"
    | "google_result"
    | "user_submission"
    | "mcp_action"
    | "scheduled_discovery";

  submittedBy?: string;
  submittedVia: "frontstage" | "backstage" | "mcp" | "scheduler" | "api";

  rawInputRef?: string;
  rawText?: string;
  sourceUrl?: string;
  contentHash?: string;

  relatedEntityHints?: Array<{
    entityType: "venue" | "artist" | "event";
    entityId?: string;
    name?: string;
  }>;

  status: "received" | "extracted" | "interpreted" | "claims_generated" | "failed";
  createdAt: string;
  updatedAt: string;
};
```

## 5. Extraction

Extraction captures low-cost deterministic parsing before LLM interpretation.

```ts
export type Extraction = {
  id: string;
  signalId: string;
  extractorVersion: string;
  method: "metadata" | "json_ld" | "regex" | "ocr" | "html_text" | "combined";
  extractedTextRef?: string;
  extractedFields: Record<string, unknown>;
  confidence: number;
  warnings: string[];
  errors: string[];
  createdAt: string;
};
```

## 6. Interpretation

Interpretation is model-assisted understanding of a signal/extraction.

```ts
export type Interpretation = {
  id: string;
  signalId: string;
  extractionId?: string;
  modelProvider?: "bedrock" | "openai" | "anthropic" | "google" | "none";
  modelName?: string;
  promptVersion: string;
  interpretationVersion: string;
  inputTokenCount?: number;
  outputTokenCount?: number;
  estimatedCost?: number;
  status: "succeeded" | "failed" | "parse_failed" | "schema_failed";
  output: Record<string, unknown>;
  uncertainties: string[];
  createdAt: string;
};
```

## 7. Claim

Claims propose changes to the bndy world. They do not directly mutate canonical state.

```ts
export type Claim = {
  id: string;
  signalId: string;
  interpretationId?: string;

  claimType:
    | "VENUE_HAS_SOURCE"
    | "ARTIST_HAS_SOURCE"
    | "EVENT_HAS_SOURCE"
    | "EVENT_EXISTS"
    | "EVENT_TIME_CHANGED"
    | "EVENT_CANCELLED"
    | "VENUE_HAS_LOCATION"
    | "VENUE_HAS_WEBSITE"
    | "ARTIST_HAS_WEBSITE"
    | "POSSIBLE_DUPLICATE_ENTITY"
    | "ENTITY_FIELD_UPDATE";

  targetEntityType: "venue" | "artist" | "event" | "unknown";
  targetEntityId?: string;
  proposedEntity?: Record<string, unknown>;
  proposedChange: Record<string, unknown>;

  confidence: number;
  risk: "low" | "medium" | "high";
  status: "proposed" | "accepted" | "rejected" | "challenged" | "deferred" | "applied" | "failed";

  reasons: string[];
  evidenceRefs: string[];
  sourceIds?: string[];

  createdAt: string;
  updatedAt: string;
};
```

## 8. EvidencePack

Evidence packs combine multiple signals/sources for the same proposed fact.

```ts
export type EvidencePack = {
  id: string;
  entityType: "venue" | "artist" | "event";
  entityId?: string;
  claimIds: string[];
  sourceIds: string[];
  signalIds: string[];
  corroborationScore: number;
  contradictions: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
};
```

## 9. ReviewAction

```ts
export type ReviewAction = {
  id: string;
  claimId: string;
  action: "accept" | "reject" | "challenge" | "defer" | "apply";
  reviewerType: "human" | "automated_rule" | "mcp_operator";
  reviewerId?: string;
  reason?: string;
  createdAt: string;
};
```

## 10. Entity trust projection

Public UX should consume a simple projection, not raw claim complexity.

```ts
export type EntityTrustProjection = {
  entityType: "venue" | "artist" | "event";
  entityId: string;
  verificationStatus: "unverified" | "source_backed" | "claimed" | "verified" | "disputed";
  publicLabel: "Verified" | "Source-backed" | "Recently found" | "Needs confirmation" | "Reported inaccurate";
  sourceCount: number;
  primarySourceCount: number;
  lastVerifiedAt?: string;
  confidence: number;
  warnings: string[];
  updatedAt: string;
};
```

## 11. Migration from existing records

Existing fields should be backfilled into source records.

| Existing field | New source |
|---|---|
| `venue.googlePlaceId` or `google_place_id` | `google_place` |
| `venue.website` | `website` |
| `venue.facebookUrl` or social media URL | `facebook_profile` |
| `venue.instagramUrl` or social media URL | `instagram_profile` |
| `artist.websiteUrl` | `website` |
| `artist.facebookUrl` | `facebook_profile` |
| `artist.instagramUrl` | `instagram_profile` |
| `event.facebookUrl` | `facebook_event` |

## 12. Natural keys

Suggested natural keys:

```text
Venue source: entityType + entityId + sourceType + canonicalUrl/externalId
Artist source: entityType + entityId + sourceType + canonicalUrl/handle
Event source: entityType + entityId + sourceType + canonicalUrl
Event duplicate key: venueId + artistId + date + startTime bucket
```

## 13. Compatibility notes

Do not remove existing social/profile fields yet. During transition, maintain a projection:

- canonical entity record remains frontstage-compatible;
- source records become the richer provenance layer;
- approved claims can update both source records and legacy convenience fields where appropriate.