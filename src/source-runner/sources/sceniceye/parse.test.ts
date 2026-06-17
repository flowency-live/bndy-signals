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

describe('multi-line table format (production innerText)', () => {
  it('parses day header with full date', () => {
    const result = parseDayHeader('Thursday 11 June 2026');
    expect(result).not.toBeNull();
    expect(result?.dayOfWeek).toBe('Thursday');
  });

  it('parses table format with 3-line gig entries', () => {
    // Simulates the actual innerText format from production
    const text = `11 June – 17 June 2026

Thursday 11 June 2026
Act
Venue
Time

Tony Gold
Number 73 Bar & Kitchen, 73 London Road, Waterlooville, PO7 7EX, England
7:30 PM – 9:30 PM

Taylor Crowley
The Crown Inn, 8 High Street, Emsworth, PO10 7AW, England
8:30 PM – 10:30 PM

Friday 12 June 2026
Act
Venue
Time

Will Tierney
Stansted Park Garden Centre, Stansted, Stansted Park, Rowlands Castle, PO9 6DX, England
2:30 PM – 4:30 PM`;

    const result = parseScenicEyePage(text, '2026-06-10');

    expect(result.isStale).toBe(false);
    expect(result.gigs.length).toBeGreaterThan(0);

    const tonyGold = result.gigs.find(g => g.artist === 'Tony Gold');
    expect(tonyGold).toBeDefined();
    expect(tonyGold?.venue).toBe('Number 73 Bar & Kitchen');
    expect(tonyGold?.time).toBe('19:30');
    expect(tonyGold?.date).toBe('2026-06-11');

    const taylorCrowley = result.gigs.find(g => g.artist === 'Taylor Crowley');
    expect(taylorCrowley).toBeDefined();
    expect(taylorCrowley?.time).toBe('20:30');

    const willTierney = result.gigs.find(g => g.artist === 'Will Tierney');
    expect(willTierney).toBeDefined();
    expect(willTierney?.date).toBe('2026-06-12');
    expect(willTierney?.time).toBe('14:30');
  });

  it('skips "No gigs listed" rows', () => {
    const text = `11 June – 17 June 2026

Monday 15 June 2026
Act
Venue
Time

No gigs listed

Tuesday 16 June 2026
Act
Venue
Time

No gigs listed`;

    const result = parseScenicEyePage(text, '2026-06-10');
    expect(result.gigs).toHaveLength(0);
    expect(result.isStale).toBe(false);
  });

  it('handles real production snapshot excerpt', () => {
    // Actual format from production S3 snapshot
    const text = `Home
Consultancy
Projects
Blog
About
Scenic Eye Gig Bot
Weekend local picks

11 June – 17 June 2026

Support Your Local Music Scene & Local Pubs!

Thursday 11 June 2026
Act
Venue
Time

Tony Gold
Number 73 Bar & Kitchen, 73 London Road, Waterlooville, PO7 7EX, England
7:30 PM – 9:30 PM

Taylor Crowley
The Crown Inn, 8 High Street, Emsworth, PO10 7AW, England
8:30 PM – 10:30 PM

Sponsored This Week

Friday 12 June 2026
Act
Venue
Time

Sykick Surfers
The Woodpecker Pub, 179 London Road, Waterlooville, PO7 7RJ, England
8:00 PM – 10:00 PM`;

    const result = parseScenicEyePage(text, '2026-06-10');

    expect(result.isStale).toBe(false);
    expect(result.gigs.length).toBe(3);

    expect(result.gigs[0].artist).toBe('Tony Gold');
    expect(result.gigs[0].date).toBe('2026-06-11');

    expect(result.gigs[2].artist).toBe('Sykick Surfers');
    expect(result.gigs[2].date).toBe('2026-06-12');
  });
});