/**
 * On The Case Normalise Tests
 *
 * Tests conversion from OnTheCaseRawGig to NormalisedEvent.
 */

import { describe, it, expect } from 'vitest';
import { normaliseOnTheCaseGig } from './normalise';
import { OnTheCaseRawGig } from './parse';
import { onTheCaseConfig } from './config';

describe('normaliseOnTheCaseGig', () => {
  const baseGig: OnTheCaseRawGig = {
    date: '2026-06-11',
    artist: 'Babel Fish',
    venue: 'Blacksmiths Arms Gosforth',
    street: '200 High Street',
    locality: 'Gosforth',
    phone: '0191 213 5302',
    startTime: '21:00',
    price: 'FREE',
  };

  it('should generate external ID from date, artist, venue', () => {
    const result = normaliseOnTheCaseGig(baseGig, onTheCaseConfig);
    expect(result.externalId).toContain('2026-06-11');
    expect(result.externalId).toContain('babel-fish');
    expect(result.externalId).toContain('blacksmiths-arms-gosforth');
  });

  it('should set sourceId from config', () => {
    const result = normaliseOnTheCaseGig(baseGig, onTheCaseConfig);
    expect(result.sourceId).toBe('onthecase-daily-import');
  });

  it('should extract venue reference with locality as city', () => {
    const result = normaliseOnTheCaseGig(baseGig, onTheCaseConfig);
    expect(result.venue.sourceName).toBe('Blacksmiths Arms Gosforth');
    expect(result.venue.city).toBe('Gosforth');
    expect(result.venue.region).toBe('North East England');
  });

  it('should extract artist reference', () => {
    const result = normaliseOnTheCaseGig(baseGig, onTheCaseConfig);
    expect(result.artist.sourceName).toBe('Babel Fish');
    expect(result.artist.canonicalName).toBe('Babel Fish');
    expect(result.artist.region).toBe('North East England UK');
  });

  it('should set startTime from parsed time', () => {
    const result = normaliseOnTheCaseGig(baseGig, onTheCaseConfig);
    expect(result.startTime).toBe('21:00');
    expect(result.timeProvenance).toBe('parsed');
  });

  it('should include price in notes if present', () => {
    const result = normaliseOnTheCaseGig(baseGig, onTheCaseConfig);
    expect(result.notes).toContain('FREE');
  });

  it('should handle gig without price', () => {
    const gigWithoutPrice = { ...baseGig, price: null };
    const result = normaliseOnTheCaseGig(gigWithoutPrice, onTheCaseConfig);
    expect(result.notes).toBeUndefined();
  });

  it('should handle duplicate artist/venue in external ID consistently', () => {
    const result1 = normaliseOnTheCaseGig(baseGig, onTheCaseConfig);
    const result2 = normaliseOnTheCaseGig(baseGig, onTheCaseConfig);
    expect(result1.externalId).toBe(result2.externalId);
  });

  it('should strip suffix from artist name for external ID (Band, Duo, etc)', () => {
    const gigWithBand = { ...baseGig, artist: 'Andy Rayner Band' };
    const result = normaliseOnTheCaseGig(gigWithBand, onTheCaseConfig);
    // External ID should be based on stripped name
    expect(result.externalId).toContain('andy-rayner');
    // But artist ref keeps the full name
    expect(result.artist.sourceName).toBe('Andy Rayner Band');
  });

  it('should set confidence to 1.0 for fully parsed gigs', () => {
    const result = normaliseOnTheCaseGig(baseGig, onTheCaseConfig);
    expect(result.confidence).toBe(1.0);
  });
});
