# Frontstage UX Requirements

## 1. Intent

Frontstage should remain simple for music goers. The new source/trust model should improve confidence without making the product feel technical.

Most users want to know:

- what is on;
- where it is;
- when it starts;
- whether it is likely to be accurate;
- whether it is free/local/grassroots.

## 2. UX principles

1. Do not expose raw claim complexity to normal users.
2. Use simple status labels.
3. Keep the map and event browsing fast.
4. Show source/provenance only where helpful.
5. Make correction/claim flows easy.
6. Do not shame venues/artists for unverified data.
7. Avoid overconfidence in inferred events.

## 3. Event trust labels

Events may show one of:

- Verified;
- Source-backed;
- Recently found;
- Needs confirmation;
- Reported inaccurate.

Suggested meanings:

| Label | Meaning |
|---|---|
| Verified | Confirmed by venue, artist or trusted admin |
| Source-backed | Supported by a credible public source |
| Recently found | Discovered from public signals but not fully verified |
| Needs confirmation | Some details may be incomplete or uncertain |
| Reported inaccurate | A correction/dispute has been raised |

## 4. Venue and artist profile indicators

Venue and artist pages should show a subtle source/trust section:

```text
Source-backed profile
Sources: website, Google Place, Facebook
Last checked: 3 days ago
```

Avoid making the profile look broken if it is not verified.

## 5. Event detail page

Event detail should include:

- event title;
- artist;
- venue;
- date;
- start time;
- free/ticketed status where known;
- status/trust label;
- source link where safe/useful;
- “Report an issue” action;
- “Claim this event/profile” action where applicable.

## 6. Map markers

Map markers should not become visually noisy. If trust is shown on the map, keep it simple:

- normal marker for active/source-backed events;
- subtle warning/outline for needs confirmation;
- do not overcrowd with many badges.

Trust detail belongs in the event card/modal, not necessarily the map marker.

## 7. Corrections

Add a correction flow:

```text
This event is wrong
  -> wrong date/time
  -> wrong venue
  -> wrong artist
  -> cancelled
  -> duplicate
  -> other
```

Correction submissions create signals and claims. They do not directly mutate records.

## 8. Claim flows

Venue/artist claim flows can be introduced later.

Initial CTAs:

- “Own this venue?”
- “Is this your band/artist profile?”
- “Help keep this listing accurate”

Claim submissions create signals and review claims.

## 9. Source attribution

Source attribution should be useful but not overwhelming.

Possible display:

```text
Found from: Venue website
```

or:

```text
Source: Facebook event
```

Avoid exposing internal confidence scores publicly unless in admin/debug views.

## 10. Feature flags

Public trust UX should be controlled by flags:

- `showEventTrustLabels`
- `showVenueSourceSummary`
- `showArtistSourceSummary`
- `enableReportIssue`
- `enableClaimProfile`

## 11. Frontstage API needs

Frontstage needs lightweight projections:

```ts
type EventCardTrust = {
  label: "Verified" | "Source-backed" | "Recently found" | "Needs confirmation" | "Reported inaccurate";
  status: "verified" | "source_backed" | "claimed" | "unverified" | "disputed";
  sourceSummary?: string;
};
```

Do not force frontstage to query raw claims for every card.

## 12. Performance

Trust projections should be precomputed or cheaply queryable. Map loads should not require multiple round trips per event.

Preferred:

- event list returns trust projection summary inline;
- detail page can fetch richer source summary;
- admin-only views can fetch full claim/evidence history.

## 13. Acceptance criteria

- Existing event map works with trust flags off.
- Event cards can show a simple trust label when enabled.
- Venue and artist pages can show source summaries when enabled.
- Users can submit corrections as signals.
- Public UX remains understandable to non-technical users.