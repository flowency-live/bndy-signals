/**
 * gigs-news Parse Tests
 *
 * Tests parsing for gigs-news.uk weekly gig listings.
 * Based on handoff doc: gigs-news-source-handoff.md
 *
 * Page structure:
 * - "What's on This Week — <date range>" header
 * - Day groupings (Fri/Sat/Sun are the busy ones)
 * - Gig rows: {Artist} at {Venue}, {Time}
 *
 * Skip rules:
 * - Open Mic, karaoke, jam nights
 * - Reserved / placeholder rows
 * - DJ rows (generic)
 * - Venue-only rows (no named act)
 */

import { describe, it, expect } from 'vitest';
import {
  parseGigsNewsPage,
  parseDayHeader,
  parseGigRow,
  GigsNewsParseResult,
} from './parse';

describe('parseDayHeader', () => {
  it('should parse "Friday 13th June"', () => {
    const result = parseDayHeader('Friday 13th June');
    expect(result).not.toBeNull();
    expect(result?.dayOfWeek).toBe('Friday');
    expect(result?.dayOfMonth).toBe(13);
    expect(result?.month).toBe('June');
  });

  it('should parse "Saturday 14th June"', () => {
    const result = parseDayHeader('Saturday 14th June');
    expect(result).not.toBeNull();
    expect(result?.dayOfWeek).toBe('Saturday');
    expect(result?.dayOfMonth).toBe(14);
    expect(result?.month).toBe('June');
  });

  it('should parse "Sunday 15th June"', () => {
    const result = parseDayHeader('Sunday 15th June');
    expect(result).not.toBeNull();
    expect(result?.dayOfWeek).toBe('Sunday');
    expect(result?.dayOfMonth).toBe(15);
  });

  it('should handle different ordinal suffixes (st, nd, rd, th)', () => {
    expect(parseDayHeader('Friday 1st June')).not.toBeNull();
    expect(parseDayHeader('Saturday 2nd June')).not.toBeNull();
    expect(parseDayHeader('Sunday 3rd June')).not.toBeNull();
    expect(parseDayHeader('Monday 4th June')).not.toBeNull();
  });

  it('should return null for non-date lines', () => {
    expect(parseDayHeader('The Ashes at The Royal Oak')).toBeNull();
    expect(parseDayHeader('What\'s on This Week')).toBeNull();
    expect(parseDayHeader('Reserved')).toBeNull();
  });
});

describe('parseGigRow', () => {
  it('should extract artist and venue from "Artist at Venue"', () => {
    const result = parseGigRow('The Ashes at The Royal Oak');
    expect(result.artist).toBe('The Ashes');
    expect(result.venue).toBe('The Royal Oak');
  });

  it('should handle multi-word artist names', () => {
    const result = parseGigRow('60% Angels at Mash Guru');
    expect(result.artist).toBe('60% Angels');
    expect(result.venue).toBe('Mash Guru');
  });

  it('should extract time if present', () => {
    const result = parseGigRow('Callum Carter at The Bull\'s Head, 8pm');
    expect(result.artist).toBe('Callum Carter');
    expect(result.venue).toBe('The Bull\'s Head');
    expect(result.time).toBe('20:00');
  });

  it('should handle 24h time formats', () => {
    const result = parseGigRow('Sofa Club at Marple Con Club, 21:00');
    expect(result.time).toBe('21:00');
  });

  it('should handle afternoon times', () => {
    const result = parseGigRow('Breakout at The Railway, 4pm');
    expect(result.time).toBe('16:00');
  });

  // Skip rules from handoff doc
  describe('skip rules', () => {
    it('should flag Open Mic as generic_recurring', () => {
      const result = parseGigRow('Open Mic at The Local');
      expect(result.skipReason).toBe('generic_recurring');
    });

    it('should flag karaoke as generic_recurring', () => {
      const result = parseGigRow('Karaoke at The Pub');
      expect(result.skipReason).toBe('generic_recurring');
    });

    it('should flag disco as generic_recurring', () => {
      const result = parseGigRow('Disco at The Club');
      expect(result.skipReason).toBe('generic_recurring');
    });

    it('should flag jam nights', () => {
      const result = parseGigRow('Blues Jam at The Local');
      expect(result.skipReason).toBe('jam_night');

      const result2 = parseGigRow('Backwater Blues Jam at Venue');
      expect(result2.skipReason).toBe('jam_night');
    });

    it('should flag music quiz', () => {
      const result = parseGigRow('Nick Steed\'s music quiz at The Pub');
      expect(result.skipReason).toBe('generic_recurring');
    });

    it('should flag "live bands" as placeholder', () => {
      const result = parseGigRow('live bands at The Venue');
      expect(result.skipReason).toBe('placeholder_performer');
    });

    it('should flag Reserved as placeholder', () => {
      const result = parseGigRow('Reserved at The Venue');
      expect(result.skipReason).toBe('placeholder_performer');

      const result2 = parseGigRow('Reserved - 4pm at The Venue');
      expect(result2.skipReason).toBe('placeholder_performer');
    });

    it('should flag "closed" as placeholder', () => {
      const result = parseGigRow('closed at The Venue');
      expect(result.skipReason).toBe('placeholder_performer');
    });

    it('should flag "looking for a venue" as placeholder', () => {
      const result = parseGigRow('Band Name at looking for a venue');
      expect(result.skipReason).toBe('placeholder_venue');
    });

    it('should flag generic DJ rows for review', () => {
      const result = parseGigRow('DJ Mark at The Club');
      expect(result.skipReason).toBe('generic_dj');
    });
  });

  it('should return venue-only flag for lines with venue but no artist', () => {
    // Handoff: venue-only rows exist and get filled in later
    const result = parseGigRow('The Royal Oak, 8pm');
    expect(result.venueOnly).toBe(true);
  });
});

describe('parseGigsNewsPage', () => {
  it('should parse multiple gigs under day headers', () => {
    const html = `
      <div>What's on This Week — 13th-15th June 2026</div>
      <div>Friday 13th June</div>
      <div>The Ashes at The Royal Oak, 8pm</div>
      <div>Sofa Club at Mash Guru, 9pm</div>
      <div>Saturday 14th June</div>
      <div>60% Angels at The Bull's Head, 8pm</div>
    `;

    const result = parseGigsNewsPage(html, 2026);
    expect(result.gigs).toHaveLength(3);

    expect(result.gigs[0].date).toBe('2026-06-13');
    expect(result.gigs[0].artist).toBe('The Ashes');
    expect(result.gigs[0].venue).toBe('The Royal Oak');

    expect(result.gigs[1].date).toBe('2026-06-13');
    expect(result.gigs[1].artist).toBe('Sofa Club');
    expect(result.gigs[1].venue).toBe('Mash Guru');

    expect(result.gigs[2].date).toBe('2026-06-14');
    expect(result.gigs[2].artist).toBe('60% Angels');
    expect(result.gigs[2].venue).toBe("The Bull's Head");
  });

  it('should park skipped rows (Open Mic, jam, etc)', () => {
    const html = `
      <div>Friday 13th June</div>
      <div>Open Mic at The Local, 7pm</div>
      <div>Blues Jam at The Pub, 8pm</div>
      <div>The Ashes at The Royal Oak, 9pm</div>
    `;

    const result = parseGigsNewsPage(html, 2026);
    expect(result.gigs).toHaveLength(1);
    expect(result.gigs[0].artist).toBe('The Ashes');

    expect(result.parked).toHaveLength(2);
    expect(result.parked[0].reason).toBe('generic_recurring');
    expect(result.parked[1].reason).toBe('jam_night');
  });

  it('should skip venue-only rows (no named artist)', () => {
    const html = `
      <div>Friday 13th June</div>
      <div>The Royal Oak, 8pm</div>
      <div>The Ashes at Mash Guru, 9pm</div>
    `;

    const result = parseGigsNewsPage(html, 2026);
    expect(result.gigs).toHaveLength(1);
    expect(result.gigs[0].artist).toBe('The Ashes');

    expect(result.parked).toHaveLength(1);
    expect(result.parked[0].reason).toBe('venue_only');
  });

  it('should ignore contact/footer block', () => {
    const html = `
      <div>Friday 13th June</div>
      <div>The Ashes at The Royal Oak, 8pm</div>
      <div>Recording my songs</div>
      <div>My Bands</div>
      <div>Contact Chris Statham</div>
    `;

    const result = parseGigsNewsPage(html, 2026);
    expect(result.gigs).toHaveLength(1);
    // Footer block should not create parked items
    expect(result.parked).toHaveLength(0);
  });

  it('should handle Sunday afternoon times correctly', () => {
    const html = `
      <div>Sunday 15th June</div>
      <div>Breakout at The Railway, 4pm</div>
    `;

    const result = parseGigsNewsPage(html, 2026);
    expect(result.gigs).toHaveLength(1);
    expect(result.gigs[0].time).toBe('16:00');
  });

  it('should default to 20:00 when no time given', () => {
    const html = `
      <div>Friday 13th June</div>
      <div>The Ashes at The Royal Oak</div>
    `;

    const result = parseGigsNewsPage(html, 2026);
    expect(result.gigs).toHaveLength(1);
    expect(result.gigs[0].time).toBe('20:00');
    expect(result.gigs[0].timeDefaulted).toBe(true);
  });
});

describe('venue aliases', () => {
  it('should normalise Mash Guru to Mash', () => {
    const html = `
      <div>Friday 13th June</div>
      <div>The Ashes at Mash Guru, 8pm</div>
    `;

    const result = parseGigsNewsPage(html, 2026);
    expect(result.gigs[0].venueCanonical).toBe('Mash');
  });

  it('should normalise Bulls Head / Bull\'s Head to The Bull\'s Head', () => {
    const html = `
      <div>Friday 13th June</div>
      <div>Band A at Bulls Head, 8pm</div>
      <div>Band B at Bull's Head, 9pm</div>
    `;

    const result = parseGigsNewsPage(html, 2026);
    expect(result.gigs[0].venueCanonical).toBe("The Bull's Head");
    expect(result.gigs[1].venueCanonical).toBe("The Bull's Head");
  });

  it('should normalise Marple Con & Social Club to Marple Con Club', () => {
    const html = `
      <div>Friday 13th June</div>
      <div>Band at Marple Con & Social Club, 8pm</div>
    `;

    const result = parseGigsNewsPage(html, 2026);
    expect(result.gigs[0].venueCanonical).toBe('Marple Con Club');
  });
});

describe('flagged venues', () => {
  it('should flag Ashton Jubilee Club for review (wrong geocode risk)', () => {
    const html = `
      <div>Friday 13th June</div>
      <div>The Ashes at Ashton Jubilee Club, 8pm</div>
    `;

    const result = parseGigsNewsPage(html, 2026);
    // Should be parked, not imported
    expect(result.gigs).toHaveLength(0);
    expect(result.parked).toHaveLength(1);
    expect(result.parked[0].reason).toBe('venue_geocode_risk');
  });
});
