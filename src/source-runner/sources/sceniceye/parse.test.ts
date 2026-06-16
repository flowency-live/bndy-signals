/**
 * Scenic Eye Parser Tests
 *
 * TDD tests for parsing scenicmind.co.uk/sceniceye.
 * Based on sceniceye-source-handoff.md:
 * - Week header: "11 June – 17 June 2026"
 * - Day groupings (Thu-Sun)
 * - Full street addresses + explicit times
 * - Artist alias: "Lianne Weston" → "Leanne Weston"
 * - Staleness detection: compare edition week vs run date
 */

import { describe, it, expect } from 'vitest';
import {
  parseWeekHeader,
  parseDayHeader,
  parseGigRow,
  parseScenicEyePage,
  isEditionStale,
  ScenicEyeRawGig,
} from './parse';

describe('parseWeekHeader', () => {
  it('parses standard week header with en-dash', () => {
    const result = parseWeekHeader('11 June – 17 June 2026');
    expect(result).toEqual({
      startDay: 11,
      startMonth: 'June',
      endDay: 17,
      endMonth: 'June',
      year: 2026,
    });
  });

  it('parses week header with hyphen', () => {
    const result = parseWeekHeader('11 June - 17 June 2026');
    expect(result).toEqual({
      startDay: 11,
      startMonth: 'June',
      endDay: 17,
      endMonth: 'June',
      year: 2026,
    });
  });

  it('handles month boundary crossover', () => {
    const result = parseWeekHeader('28 June – 4 July 2026');
    expect(result).toEqual({
      startDay: 28,
      startMonth: 'June',
      endDay: 4,
      endMonth: 'July',
      year: 2026,
    });
  });

  it('returns null for non-header lines', () => {
    expect(parseWeekHeader('Some random text')).toBeNull();
    expect(parseWeekHeader('Thursday')).toBeNull();
    expect(parseWeekHeader('')).toBeNull();
  });
});

describe('parseDayHeader', () => {
  it('parses Thursday header', () => {
    const result = parseDayHeader('Thursday');
    expect(result).toEqual({ dayOfWeek: 'Thursday' });
  });

  it('parses Friday header', () => {
    const result = parseDayHeader('Friday');
    expect(result).toEqual({ dayOfWeek: 'Friday' });
  });

  it('parses Saturday header', () => {
    const result = parseDayHeader('Saturday');
    expect(result).toEqual({ dayOfWeek: 'Saturday' });
  });

  it('parses Sunday header', () => {
    const result = parseDayHeader('Sunday');
    expect(result).toEqual({ dayOfWeek: 'Sunday' });
  });

  it('returns null for non-day lines', () => {
    expect(parseDayHeader('Some gig listing')).toBeNull();
    expect(parseDayHeader('11 June – 17 June 2026')).toBeNull();
  });
});

describe('parseGigRow', () => {
  it('parses gig with full address and time', () => {
    const result = parseGigRow(
      'The Ashes at West Town Inn, 22 West Town Lane, Hayling Island, 8pm'
    );
    expect(result).toEqual({
      artist: 'The Ashes',
      venue: 'West Town Inn',
      venueAddress: '22 West Town Lane, Hayling Island',
      time: '20:00',
      skipReason: undefined,
    });
  });

  it('parses Sunday afternoon gig with 24h time', () => {
    const result = parseGigRow(
      'Leanne Weston at The Golden Lion, 2 East Street, Havant, 14:30'
    );
    expect(result).toEqual({
      artist: 'Leanne Weston',
      venue: 'The Golden Lion',
      venueAddress: '2 East Street, Havant',
      time: '14:30',
      skipReason: undefined,
    });
  });

  it('parses gig with PM time', () => {
    const result = parseGigRow(
      'Soul Miners at The Crown Inn, High Street, Emsworth, 9pm'
    );
    expect(result).toEqual({
      artist: 'Soul Miners',
      venue: 'The Crown Inn',
      venueAddress: 'High Street, Emsworth',
      time: '21:00',
      skipReason: undefined,
    });
  });

  it('parses gig with time having minutes', () => {
    const result = parseGigRow(
      'Blue Notes at The Fox & Hounds, London Road, Waterlooville, 8:30pm'
    );
    expect(result).toEqual({
      artist: 'Blue Notes',
      venue: 'The Fox & Hounds',
      venueAddress: 'London Road, Waterlooville',
      time: '20:30',
      skipReason: undefined,
    });
  });

  it('applies artist alias: Lianne Weston → Leanne Weston', () => {
    const result = parseGigRow(
      'Lianne Weston at The Heroes, Stakes Hill Road, Waterlooville, 3pm'
    );
    expect(result).toEqual({
      artist: 'Leanne Weston',
      venue: 'The Heroes',
      venueAddress: 'Stakes Hill Road, Waterlooville',
      time: '15:00',
      skipReason: undefined,
    });
  });

  it('returns null for empty or whitespace lines', () => {
    expect(parseGigRow('')).toBeNull();
    expect(parseGigRow('   ')).toBeNull();
  });

  it('returns null for lines without " at "', () => {
    expect(parseGigRow('Some random text')).toBeNull();
  });
});

describe('isEditionStale', () => {
  it('returns false when run date is within edition week', () => {
    // Edition: 11-17 June 2026, run date: 13 June 2026 (Saturday)
    const weekHeader = {
      startDay: 11,
      startMonth: 'June',
      endDay: 17,
      endMonth: 'June',
      year: 2026,
    };
    expect(isEditionStale(weekHeader, '2026-06-13')).toBe(false);
  });

  it('returns true when run date is after edition week', () => {
    // Edition: 11-17 June 2026, run date: 20 June 2026
    const weekHeader = {
      startDay: 11,
      startMonth: 'June',
      endDay: 17,
      endMonth: 'June',
      year: 2026,
    };
    expect(isEditionStale(weekHeader, '2026-06-20')).toBe(true);
  });

  it('returns false on the last day of edition week', () => {
    // Edition: 11-17 June 2026, run date: 17 June 2026
    const weekHeader = {
      startDay: 11,
      startMonth: 'June',
      endDay: 17,
      endMonth: 'June',
      year: 2026,
    };
    expect(isEditionStale(weekHeader, '2026-06-17')).toBe(false);
  });

  it('handles month boundary correctly', () => {
    // Edition: 28 June - 4 July 2026, run date: 2 July 2026
    const weekHeader = {
      startDay: 28,
      startMonth: 'June',
      endDay: 4,
      endMonth: 'July',
      year: 2026,
    };
    expect(isEditionStale(weekHeader, '2026-07-02')).toBe(false);
  });

  it('detects staleness across month boundary', () => {
    // Edition: 28 June - 4 July 2026, run date: 10 July 2026
    const weekHeader = {
      startDay: 28,
      startMonth: 'June',
      endDay: 4,
      endMonth: 'July',
      year: 2026,
    };
    expect(isEditionStale(weekHeader, '2026-07-10')).toBe(true);
  });
});

describe('parseScenicEyePage', () => {
  it('parses a complete page with multiple days', () => {
    const html = `
      <html>
        <body>
          <h1>11 June – 17 June 2026</h1>
          <h2>Thursday</h2>
          <p>The Ashes at West Town Inn, 22 West Town Lane, Hayling Island, 8pm</p>
          <h2>Friday</h2>
          <p>Soul Miners at The Crown Inn, High Street, Emsworth, 9pm</p>
          <p>Blue Notes at The Fox & Hounds, London Road, Waterlooville, 8:30pm</p>
          <h2>Saturday</h2>
          <p>Rock Revival at The Golden Lion, 2 East Street, Havant, 8pm</p>
          <h2>Sunday</h2>
          <p>Leanne Weston at The Heroes, Stakes Hill Road, Waterlooville, 3pm</p>
        </body>
      </html>
    `;

    const result = parseScenicEyePage(html, '2026-06-13');

    expect(result.isStale).toBe(false);
    expect(result.gigs).toHaveLength(5);

    // Thursday gig (day 12)
    expect(result.gigs[0]).toMatchObject({
      date: '2026-06-11',
      artist: 'The Ashes',
      venue: 'West Town Inn',
    });

    // Friday gigs (day 13)
    expect(result.gigs[1]).toMatchObject({
      date: '2026-06-12',
      artist: 'Soul Miners',
      venue: 'The Crown Inn',
    });

    // Saturday (day 14)
    expect(result.gigs[3]).toMatchObject({
      date: '2026-06-13',
      artist: 'Rock Revival',
      venue: 'The Golden Lion',
    });

    // Sunday (day 15)
    expect(result.gigs[4]).toMatchObject({
      date: '2026-06-14',
      artist: 'Leanne Weston',
      venue: 'The Heroes',
      time: '15:00',
    });
  });

  it('returns empty gigs array when edition is stale', () => {
    const html = `
      <html>
        <body>
          <h1>4 June – 10 June 2026</h1>
          <h2>Thursday</h2>
          <p>The Ashes at West Town Inn, 22 West Town Lane, Hayling Island, 8pm</p>
        </body>
      </html>
    `;

    // Run date is after the edition week
    const result = parseScenicEyePage(html, '2026-06-15');

    expect(result.isStale).toBe(true);
    expect(result.gigs).toHaveLength(0);
    expect(result.staleReason).toContain('past');
  });

  it('applies artist alias in full page parse', () => {
    const html = `
      <html>
        <body>
          <h1>11 June – 17 June 2026</h1>
          <h2>Sunday</h2>
          <p>Lianne Weston at The Heroes, Stakes Hill Road, Waterlooville, 3pm</p>
        </body>
      </html>
    `;

    const result = parseScenicEyePage(html, '2026-06-14');

    expect(result.gigs[0]?.artist).toBe('Leanne Weston');
  });

  it('handles missing week header gracefully', () => {
    const html = `
      <html>
        <body>
          <h2>Thursday</h2>
          <p>The Ashes at West Town Inn, 22 West Town Lane, Hayling Island, 8pm</p>
        </body>
      </html>
    `;

    const result = parseScenicEyePage(html, '2026-06-13');

    expect(result.isStale).toBe(true);
    expect(result.gigs).toHaveLength(0);
    expect(result.staleReason).toContain('header');
  });
});