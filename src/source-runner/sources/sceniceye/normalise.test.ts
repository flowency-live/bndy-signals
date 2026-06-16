/**
 * Scenic Eye Normalise Tests
 *
 * TDD tests for converting ScenicEyeRawGig to NormalisedEvent.
 */

import { describe, it, expect } from 'vitest';
import { normaliseScenicEyeGig } from './normalise';
import { ScenicEyeRawGig } from './parse';
import { SourceConfig } from '../../types';

const mockConfig: SourceConfig = {
  id: 'sceniceye-daily-import',
  name: 'sceniceye',
  type: 'aggregator',
  region: 'Hampshire',
  defaultCity: 'Havant',
  defaultArtistLocation: 'Hampshire UK',
  timezone: 'Europe/London',
  schedule: { cadence: 'daily', localTime: '09:00' },
  input: { kind: 'js_rendered_page', url: 'https://scenicmind.co.uk/sceniceye' },
  eventPolicy: {
    createPublicEvents: true,
    deleteFutureMissingRows: true,
    neverDeletePastEvents: true,
    duplicateEventBehaviour: 'attach_external_id_no_clobber',
  },
  parkingLot: { specialistVenueSlugs: [], multiActVenueSlugs: [], reasons: [] },
  thresholds: {
    venueAutoMatch: 0.95,
    artistAutoMatch: 0.9,
    eventAutoCreate: 0.95,
    socialAutoAttach: 0.95,
  },
  snapshotSemantics: 'complete',
};

describe('normaliseScenicEyeGig', () => {
  it('generates correct external ID', () => {
    const gig: ScenicEyeRawGig = {
      date: '2026-06-13',
      artist: 'The Ashes',
      venue: 'West Town Inn',
      venueAddress: '22 West Town Lane, Hayling Island',
      time: '20:00',
    };

    const result = normaliseScenicEyeGig(gig, mockConfig);

    expect(result.externalId).toBe('2026-06-13_the-ashes_west-town-inn');
    expect(result.sourceId).toBe('sceniceye-daily-import');
  });

  it('generates venue ref with address as full location', () => {
    const gig: ScenicEyeRawGig = {
      date: '2026-06-13',
      artist: 'Soul Miners',
      venue: 'The Crown Inn',
      venueAddress: 'High Street, Emsworth',
      time: '21:00',
    };

    const result = normaliseScenicEyeGig(gig, mockConfig);

    expect(result.venue.sourceName).toBe('The Crown Inn');
    expect(result.venue.canonicalName).toBe('The Crown Inn');
    expect(result.venue.sourceVenueExternalId).toBe('venue_the-crown-inn');
    expect(result.venue.fullAddress).toBe('High Street, Emsworth');
    expect(result.venue.region).toBe('Hampshire');
  });

  it('generates artist ref with region from config', () => {
    const gig: ScenicEyeRawGig = {
      date: '2026-06-14',
      artist: 'Leanne Weston',
      venue: 'The Heroes',
      venueAddress: 'Stakes Hill Road, Waterlooville',
      time: '15:00',
    };

    const result = normaliseScenicEyeGig(gig, mockConfig);

    expect(result.artist.sourceName).toBe('Leanne Weston');
    expect(result.artist.canonicalName).toBe('Leanne Weston');
    expect(result.artist.sourceArtistExternalId).toBe('artist_leanne-weston');
    expect(result.artist.region).toBe('Hampshire UK');
  });

  it('sets time provenance to parsed (explicit times)', () => {
    const gig: ScenicEyeRawGig = {
      date: '2026-06-14',
      artist: 'Blue Notes',
      venue: 'The Fox & Hounds',
      venueAddress: 'London Road, Waterlooville',
      time: '14:30',
    };

    const result = normaliseScenicEyeGig(gig, mockConfig);

    expect(result.startTime).toBe('14:30');
    expect(result.timeProvenance).toBe('parsed');
    expect(result.parseWarnings).toHaveLength(0);
  });

  it('generates rawRowRef for traceability', () => {
    const gig: ScenicEyeRawGig = {
      date: '2026-06-13',
      artist: 'The Ashes',
      venue: 'West Town Inn',
      venueAddress: '22 West Town Lane, Hayling Island',
      time: '20:00',
    };

    const result = normaliseScenicEyeGig(gig, mockConfig);

    expect(result.rawRowRef).toBe('2026-06-13:The Ashes@West Town Inn');
  });

  it('strips act suffixes from artist ID but preserves display name', () => {
    const gig: ScenicEyeRawGig = {
      date: '2026-06-13',
      artist: 'Soul Miners Band',
      venue: 'The Crown Inn',
      venueAddress: 'High Street, Emsworth',
      time: '21:00',
    };

    const result = normaliseScenicEyeGig(gig, mockConfig);

    // ID strips "Band"
    expect(result.artist.sourceArtistExternalId).toBe('artist_soul-miners');
    // Display name preserved
    expect(result.artist.sourceName).toBe('Soul Miners Band');
    expect(result.artist.canonicalName).toBe('Soul Miners Band');
  });

  it('handles special characters in venue names', () => {
    const gig: ScenicEyeRawGig = {
      date: '2026-06-13',
      artist: 'Rock Revival',
      venue: "The Fox & Hounds",
      venueAddress: 'London Road, Waterlooville',
      time: '20:30',
    };

    const result = normaliseScenicEyeGig(gig, mockConfig);

    expect(result.venue.sourceVenueExternalId).toBe('venue_the-fox-hounds');
  });

  it('extracts city from venue address', () => {
    const gig: ScenicEyeRawGig = {
      date: '2026-06-13',
      artist: 'The Ashes',
      venue: 'West Town Inn',
      venueAddress: '22 West Town Lane, Hayling Island',
      time: '20:00',
    };

    const result = normaliseScenicEyeGig(gig, mockConfig);

    // City should be extracted from the last part of address
    expect(result.venue.city).toBe('Hayling Island');
  });
});
