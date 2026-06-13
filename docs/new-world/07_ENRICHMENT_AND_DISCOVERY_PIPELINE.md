# Enrichment and Discovery Pipeline

## 1. Intent

The enrichment and discovery pipeline should improve bndy venue, artist and event data without creating a search/LLM cost machine.

The system should reuse existing public signals and external identity systems where useful, especially Google Places, public websites, OpenGraph metadata, JSON-LD, submitted URLs and posters.

## 2. Core pipeline

```text
Candidate entity or discovery target
  -> source discovery
  -> deterministic extraction
  -> entity matching
  -> cheap interpretation if needed
  -> claim generation
  -> review or auto-apply
  -> source/trust projection update
```

## 3. Cost hierarchy

Always try cheaper steps before expensive ones.

```text
Tier 0: Existing bndy data
Tier 1: URL canonicalisation, metadata, JSON-LD, OpenGraph
Tier 2: Google Place ID / existing external IDs
Tier 3: deterministic matching and regex extraction
Tier 4: cheap LLM structured extraction
Tier 5: stronger model / Claude review
Tier 6: human review
```

## 4. Venue enrichment

### Inputs

- existing venue record;
- venue name;
- town/location;
- existing Google Place ID;
- existing website/social fields;
- known event sources.

### Outputs

Claims such as:

- `VENUE_HAS_SOURCE`;
- `VENUE_HAS_LOCATION`;
- `VENUE_HAS_WEBSITE`;
- `POSSIBLE_DUPLICATE_ENTITY`;
- `ENTITY_FIELD_UPDATE`.

### Rules

- Prefer Google Place ID for venue identity.
- Do not create duplicate venues when a likely Google Place/entity match exists.
- Do not overwrite verified venue fields with inferred ones without review.
- Social/profile URLs should create sources first; legacy fields can be projected later.

## 5. Artist enrichment

### Inputs

- existing artist record;
- artist name;
- locality/region if known;
- existing website/social fields;
- event associations;
- user-submitted or discovered profiles.

### Outputs

Claims such as:

- `ARTIST_HAS_SOURCE`;
- `ARTIST_HAS_WEBSITE`;
- `POSSIBLE_DUPLICATE_ENTITY`;
- `ENTITY_FIELD_UPDATE`.

### Rules

- Artist matching must be conservative because names are less unique than venues.
- Same artist name in different regions may not be the same entity.
- Official website/social profile is stronger evidence than a third-party mention.
- Event co-occurrence can support but not prove identity.

## 6. Event discovery

### Inputs

- known venue with no upcoming events;
- known artist with no upcoming events;
- user-submitted link;
- public webpage;
- poster image;
- Google-visible search result;
- venue/artist source page.

### Outputs

Claims such as:

- `EVENT_EXISTS`;
- `EVENT_TIME_CHANGED`;
- `EVENT_CANCELLED`;
- `VENUE_HAS_SOURCE`;
- `ARTIST_HAS_SOURCE`.

### Rules

- Do not publish low-confidence events as fully verified.
- Date ambiguity routes to review.
- Time can be defaulted only if product rules clearly mark it as inferred/defaulted.
- Duplicate key should include venue, artist, date and approximate start time.
- Event status should include source-backed confidence.

## 7. Discovery prioritisation

Do not crawl everything.

Prioritise:

1. claimed venues/artists;
2. known venues with no future events;
3. known artists with no future events;
4. towns with active users;
5. venues already receiving traffic;
6. recently searched artists;
7. stale high-value sources;
8. user submitted links/posters.

Avoid:

- broad web crawling;
- repeated daily checks for low-activity entities;
- high-volume Facebook scraping;
- expensive model calls for simple metadata.

## 8. Model routing

Suggested router:

```ts
export type ModelRoute =
  | "none_deterministic"
  | "cheap_structured_extraction"
  | "cheap_classification"
  | "strong_ambiguity_resolution"
  | "manual_review";
```

Routing rules:

- deterministic confidence >= 0.9: no model;
- clear source extraction but schema needs normalising: cheap model;
- ambiguous venue/artist identity: review or stronger model;
- destructive overwrite: human review;
- duplicate resolution: human review unless exact external ID match.

## 9. Job budget

Each enrichment job should include a budget.

```ts
export type EnrichmentBudget = {
  maxSearches: number;
  maxFetches: number;
  maxModelCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  allowExpensiveModel: boolean;
};
```

Default venue job:

```json
{
  "maxSearches": 2,
  "maxFetches": 3,
  "maxModelCalls": 1,
  "maxInputTokens": 3000,
  "maxOutputTokens": 500,
  "allowExpensiveModel": false
}
```

## 10. Caching

Cache by:

- URL;
- canonical URL;
- Google Place ID;
- page content hash;
- model input hash;
- prompt version;
- entity ID and source type.

Never call a model for the same prompt/input pair if a valid cached interpretation exists.

## 11. Source freshness

Recommended checks:

| Source type | Suggested freshness |
|---|---|
| Google Place | 30-90 days |
| Official website | 30 days for event pages, 90 days for profile pages |
| Facebook/Instagram profile URL | 90 days for existence, more often only for high-value entities |
| Event page | Until event date + 7 days |
| Poster image | immutable evidence, no refetch needed |

## 12. Human review triggers

Route to review when:

- confidence < threshold;
- date/time is ambiguous;
- source conflicts with existing verified data;
- claim would overwrite human-verified fields;
- duplicate candidate exists;
- artist identity is uncertain;
- source URL already belongs to another entity;
- model output fails schema validation.

## 13. Success metrics

- cost per enriched venue;
- cost per enriched artist;
- cost per event candidate;
- % handled deterministically;
- % needing model interpretation;
- % needing review;
- accepted/rejected claim ratio;
- duplicate suppression rate;
- stale source reduction.