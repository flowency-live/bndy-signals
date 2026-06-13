# PRD: bndy Source-Backed Grassroots Live Music Graph

## 1. Purpose

bndy will evolve from a manually maintained live music directory into a source-backed UK grassroots live music graph. The product will help local music goers find free and local gigs, while helping venues and artists become discoverable without requiring every record to be manually entered from scratch.

The change must be progressive. The existing live product remains stable while sources, signals, claims and review workflows are layered in.

## 2. Product thesis

Google is good at broad discovery. Facebook and Instagram are where much grassroots music activity is announced. Venue websites, ticketing pages and posters also contain useful signals. bndy should not rebuild these systems.

bndy should reuse public signals and external identity systems where useful, then own the structured UK grassroots context:

- who plays where;
- which venues actually host live music;
- which gigs are free/local/grassroots;
- what source evidence supports each record;
- whether an event is verified, source-backed, inferred, claimed or disputed;
- how local fans follow artists, venues and towns.

## 3. Users

### Local music goer

Wants to know what free or local live music is happening nearby tonight, this weekend, or on a chosen date.

Needs:

- map-based discovery;
- venue and artist pages;
- simple event confidence indicators;
- minimal friction;
- favourite artist and venue notifications later.

### Venue operator

Wants their gigs to be visible and correct without managing another heavy platform.

Needs:

- claim venue;
- confirm/edit events;
- link official website/social sources;
- mark events as free, ticketed, cancelled, recurring or changed.

### Artist/band

Wants gigs discoverable and profile information accurate.

Needs:

- claim artist profile;
- connect Facebook, Instagram, website and other sources;
- confirm gigs;
- correct incorrect venue/date associations.

### bndy operator/admin

Needs to process ambiguous data safely and cheaply.

Needs:

- source queue;
- claim queue;
- confidence scores;
- duplicate detection;
- bulk enrichment;
- review/apply tools;
- cost visibility.

## 4. Current baseline

The system already has roughly:

- 1,200 venues;
- 1,600 artists;
- event map and public discovery experience;
- venue and artist records with varying enrichment quality;
- serverless API and event ingestion proof-of-concept;
- bndy-signals runtime for signal intake, deterministic extraction, interpretation, claims and review;
- local MCP server currently used through Claude Cowork.

## 5. Problem statement

Existing enrichment is useful but inconsistent. Data quality varies across venue and artist records. Some records have social links, some have Google place metadata, some have partial details, and some are likely duplicated or stale.

Claude Cowork is currently useful because it can access the local MCP server, but it is too expensive and too manual to be the production enrichment runtime.

The product needs a scalable way to ingest signals, connect sources, propose record changes, and verify/repair data without a destructive rebuild.

## 6. Goals

1. Add first-class source records for venues, artists and events.
2. Introduce a signal-to-claim ingestion model across event discovery and entity enrichment.
3. Keep the existing live product stable during the transition.
4. Reduce dependency on Claude Cowork for bulk enrichment.
5. Make bndy-signals the canonical intelligence runtime.
6. Provide admin/operator workflows for claim review and data quality correction.
7. Make frontstage able to show simple source-backed trust indicators.
8. Reuse Google and public web signals without trying to rebuild generic search.

## 7. Non-goals

- Do not scrape Facebook at scale as a core dependency.
- Do not rebuild Google Search, Google Maps or Google Places.
- Do not big-bang migrate existing production entities.
- Do not require every artist or venue to sign up before bndy can show source-backed data.
- Do not expose complex confidence logic to normal users.
- Do not make Claude Cowork the production runtime.

## 8. Product capabilities

### 8.1 Source management

Every venue, artist and event can have multiple connected sources:

- Google Place;
- Facebook profile;
- Facebook event;
- Instagram profile;
- official website;
- ticketing page;
- poster/image;
- user submission;
- Google search result;
- venue feed;
- artist feed.

Sources have status, confidence, evidence strength and last checked dates.

### 8.2 Signal intake

A signal is raw evidence. Examples:

- pasted URL;
- uploaded poster;
- public webpage HTML;
- Google-visible search result;
- user-submitted event;
- MCP-submitted enrichment finding;
- scheduled discovery output.

Signals are immutable and stored before interpretation.

### 8.3 Claim generation

Interpretation produces claims, not direct writes.

Examples:

- `VENUE_HAS_SOURCE`;
- `ARTIST_HAS_SOURCE`;
- `EVENT_EXISTS`;
- `VENUE_HAS_LOCATION`;
- `ARTIST_PLAYS_GENRE`;
- `EVENT_TIME_CHANGED`;
- `EVENT_CANCELLED`;
- `POSSIBLE_DUPLICATE_ENTITY`.

### 8.4 Review and apply

Claims can be:

- accepted;
- rejected;
- challenged;
- deferred;
- auto-applied if high confidence and low risk.

Accepted claims update canonical venue, artist or event records and create/update source records.

### 8.5 Data quality and trust

Each entity should have a trust profile based on:

- source coverage;
- source strength;
- freshness;
- consistency across signals;
- claim status;
- user/operator verification;
- dispute/correction history.

### 8.6 Public UX

Frontstage should show simple, low-friction indicators:

- Verified;
- Source-backed;
- Recently found;
- Needs confirmation;
- Reported inaccurate.

Detailed provenance remains available but not intrusive.

## 9. Success metrics

### Data quality

- % venues with at least one source;
- % venues with Google Place source;
- % venues with website or social source;
- % artists with at least one source;
- duplicate rate reduced;
- stale source count reduced;
- rejected claim rate tracked.

### Product

- event pages viewed;
- map searches;
- venue profile views;
- artist profile views;
- claim/correction submissions;
- follows/favourites later.

### Operational

- enrichment cost per record;
- tokens per interpreted signal;
- % signals handled deterministically;
- % claims auto-applied;
- % claims needing manual review;
- average review time.

## 10. Release approach

1. Add source model without changing public UX.
2. Backfill sources from existing fields.
3. Route new enrichment into source records and claims.
4. Add admin review tools.
5. Add source-backed trust badges behind feature flags.
6. Gradually migrate event discovery and venue/artist enrichment into bndy-signals.
7. Retire tactical direct-write enrichment paths only after parity is proven.

## 11. Acceptance criteria

- Existing frontstage and backstage continue to work without schema-breaking changes.
- Sources can be linked to existing venues, artists and events.
- Signals can generate claims without mutating canonical records.
- Review actions are auditable.
- Approved claims can update canonical records.
- MCP can submit signals and review claims instead of directly performing all enrichment.
- The system can process venue and artist enrichment batches without Claude Cowork.
- Public users can see simple confidence/status indicators when enabled.