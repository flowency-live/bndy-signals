# Data Quality and Trust Model

## 1. Intent

bndy should not pretend inferred data is the same as verified data. The system needs to track where information came from, how strong the evidence is, how fresh it is, and whether it has been accepted, rejected, challenged or disputed.

This trust model supports internal review and simple public UX labels.

## 2. Quality dimensions

### Completeness

Does the entity have the minimum useful fields?

Venue examples:

- name;
- location;
- town;
- source;
- website/social;
- upcoming events.

Artist examples:

- name;
- source;
- location/region if known;
- website/social;
- events.

Event examples:

- venue;
- artist;
- date;
- time or explicit default/inferred time;
- source;
- status.

### Provenance

Can bndy explain where the fact came from?

Examples:

- Google Place;
- official venue website;
- artist Facebook profile;
- public event page;
- uploaded poster;
- user submission;
- AI interpretation of a page.

### Freshness

When was the source last checked or verified?

### Confidence

How likely is the extracted/interpreted fact to be correct?

### Consistency

Do multiple sources agree, or do they contradict each other?

### Verification

Has a human, venue, artist or trusted rule confirmed it?

## 3. Verification statuses

```ts
export type VerificationStatus =
  | "unverified"
  | "source_backed"
  | "claimed"
  | "verified"
  | "disputed";
```

### `unverified`

No strong source evidence or review.

### `source_backed`

At least one credible source supports the record.

### `claimed`

A venue or artist has claimed the profile but may not have verified all data.

### `verified`

A trusted party or admin has confirmed the record.

### `disputed`

A user, venue, artist or operator has flagged the record as incorrect or conflicting.

## 4. Public labels

Public UX should use simple labels:

| Internal status | Public label |
|---|---|
| `verified` | Verified |
| `claimed` | Claimed |
| `source_backed` | Source-backed |
| recent unverified event | Recently found |
| low confidence | Needs confirmation |
| disputed | Reported inaccurate |

## 5. Evidence strength

```ts
export type EvidenceStrength =
  | "primary"
  | "secondary"
  | "tertiary"
  | "user_submitted";
```

### Primary

Owned or official source:

- venue official website;
- artist official website;
- verified social profile;
- Google Place for venue identity;
- claimed profile data.

### Secondary

Strong but not necessarily owned:

- ticketing site;
- local event listing;
- promoter page;
- venue aggregator.

### Tertiary

Weak or indirect:

- Google search result snippet;
- scraped mention;
- third-party blog;
- ambiguous public page.

### User submitted

Useful but needs confidence/review unless submitter is trusted.

## 6. Confidence scoring

Confidence should combine:

- source strength;
- entity match quality;
- field extraction confidence;
- source freshness;
- corroboration;
- contradictions;
- prior trust in source;
- whether source is official/claimed.

Suggested rough scoring:

```text
0.95-1.00: exact external ID or verified/claimed source
0.85-0.94: strong source with high-quality match
0.70-0.84: likely but should remain source-backed/inferred
0.50-0.69: ambiguous, review preferred
<0.50: weak, do not apply automatically
```

## 7. Trust projection

Do not make frontstage calculate trust from raw claims. Create a projection.

```ts
export type TrustProjection = {
  entityType: "venue" | "artist" | "event";
  entityId: string;
  verificationStatus: VerificationStatus;
  publicLabel: string;
  confidence: number;
  sourceCount: number;
  primarySourceCount: number;
  warnings: string[];
  lastVerifiedAt?: string;
  updatedAt: string;
};
```

## 8. Data quality reports

Create regular reports for:

- venues without sources;
- artists without sources;
- events without sources;
- duplicate venue candidates;
- duplicate artist candidates;
- stale sources;
- broken URLs;
- conflicting source claims;
- low-confidence public events;
- claims awaiting review.

## 9. Auto-apply rules

Only auto-apply low-risk, high-confidence claims.

Examples that may be safe:

- adding a new website source to a venue when page title/address strongly match;
- adding Google Place source when place ID match is exact;
- adding a Facebook event source to an existing event when natural key matches.

Examples that should require review:

- merging venues;
- merging artists;
- changing event date/time;
- creating a new artist from weak evidence;
- overwriting verified fields;
- resolving disputed claims.

## 10. Data quality backlog priorities

1. Backfill source records from existing venue/artist/event fields.
2. Identify venues without Google Place sources.
3. Identify venues without website/social sources.
4. Identify artists without any source.
5. Find duplicate venues by name/location/source.
6. Find duplicate artists by name/source/event overlap.
7. Add source-backed badges to operator views.
8. Add simple public trust labels to frontstage.

## 11. Product tone

The product should be honest:

- “Source-backed” is better than pretending everything is verified.
- “Recently found” is useful for event discovery.
- “Needs confirmation” invites community correction.
- “Reported inaccurate” protects trust.

The aim is practical trust, not perfect certainty.