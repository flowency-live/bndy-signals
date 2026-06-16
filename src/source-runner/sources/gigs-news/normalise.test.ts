/**
 * gigs-news Normalise Tests
 *
 * Tests normalisation of gigs-news gigs to NormalisedEvent format.
 */

import { describe, it, expect } from 'vitest';
import { normaliseGigsNewsGig } from './normalise';
import { gigsNewsConfig } from './config';
import { GigsNewsRawGig } from './parse';

describe('normaliseGigsNewsGig', () => {
  const createGig = (overrides: Partial<GigsNewsRawGig> = {}): GigsNewsRawGig => ({
    date: '2026-06-13',
    artist: 'The Ashes',
    venue: 'The Royal Oak',
    venueCanonical: 'The Royal Oak',
    time: '20:00',
    timeDefaulted: false,
    ...overrides,
  });

  it('should create a NormalisedEvent with correct structure', () => {
    const gig = createGig();
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.sourceId).toBe('gigs-news-daily-import');
    expect(result.date).toBe('2026-06-13');
    expect(result.startTime).toBe('20:00');
    expect(result.confidence).toBe(1.0);
  });

  it('should generate correct external ID', () => {
    const gig = createGig({
      artist: 'The Ashes',
      venue: 'The Royal Oak',
      venueCanonical: 'The Royal Oak',
    });
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.externalId).toBe('2026-06-13_the-ashes_the-royal-oak');
  });

  it('should strip act suffixes from artist for external ID', () => {
    const gig = createGig({
      artist: 'Andy Rayner Band',
    });
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.externalId).toContain('andy-rayner');
    expect(result.externalId).not.toContain('band');
  });

  it('should use venueCanonical for venue ID generation', () => {
    const gig = createGig({
      venue: 'Mash Guru',
      venueCanonical: 'Mash',
    });
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.venue.sourceVenueExternalId).toBe('venue_mash');
    expect(result.venue.sourceName).toBe('Mash Guru');
    expect(result.venue.canonicalName).toBe('Mash');
  });

  it('should include original venue name in nameVariants when different from canonical', () => {
    const gig = createGig({
      venue: 'Mash Guru',
      venueCanonical: 'Mash',
    });
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.venue.nameVariants).toContain('Mash Guru');
  });

  it('should not include nameVariants when venue equals canonical', () => {
    const gig = createGig({
      venue: 'The Royal Oak',
      venueCanonical: 'The Royal Oak',
    });
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.venue.nameVariants).toHaveLength(0);
  });

  it('should set timeProvenance to defaulted when time was defaulted', () => {
    const gig = createGig({
      time: '20:00',
      timeDefaulted: true,
    });
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.timeProvenance).toBe('defaulted_from_missing');
    expect(result.parseWarnings).toContain('Time defaulted to 20:00');
  });

  it('should set timeProvenance to parsed when time was explicit', () => {
    const gig = createGig({
      time: '21:00',
      timeDefaulted: false,
    });
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.timeProvenance).toBe('parsed');
    expect(result.parseWarnings).toHaveLength(0);
  });

  it('should set correct region from config', () => {
    const gig = createGig();
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.venue.region).toBe('Greater Manchester / East Cheshire');
    expect(result.artist.region).toBe('Greater Manchester UK');
  });

  it('should set rawRowRef correctly', () => {
    const gig = createGig({
      date: '2026-06-14',
      artist: 'Sofa Club',
      venue: 'Marple Con Club',
    });
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.rawRowRef).toBe('2026-06-14:Sofa Club@Marple Con Club');
  });

  it('should handle special characters in artist names', () => {
    const gig = createGig({
      artist: "60% Angels",
    });
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.artist.sourceName).toBe('60% Angels');
    expect(result.artist.sourceArtistExternalId).toBe('artist_60-angels');
  });

  it('should handle apostrophes in venue names', () => {
    const gig = createGig({
      venue: "The Bull's Head",
      venueCanonical: "The Bull's Head",
    });
    const result = normaliseGigsNewsGig(gig, gigsNewsConfig);

    expect(result.venue.sourceVenueExternalId).toBe('venue_the-bulls-head');
  });
});
