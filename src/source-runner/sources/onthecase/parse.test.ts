/**
 * On The Case Parse Tests
 *
 * Tests parsing of the 3-line gig listing format:
 * 1. {Artist} at {Venue name + locality}
 * 2. {Street} / {Locality} / {Phone}
 * 3. {Start time} / {Price}
 *
 * Grouped under date headers like "Thursday 11 / June 2026"
 */

import { describe, it, expect } from 'vitest';
import {
  parseOnTheCasePage,
  parseDateHeader,
  parseGigLine1,
  parseGigLine2,
  parseGigLine3,
  OnTheCaseRawGig,
} from './parse';

describe('parseDateHeader', () => {
  it('should parse "Thursday 11 / June 2026"', () => {
    const result = parseDateHeader('Thursday 11 / June 2026');
    expect(result).toBe('2026-06-11');
  });

  it('should parse "Friday 20 / December 2026"', () => {
    const result = parseDateHeader('Friday 20 / December 2026');
    expect(result).toBe('2026-12-20');
  });

  it('should parse "Saturday 1 / January 2027"', () => {
    const result = parseDateHeader('Saturday 1 / January 2027');
    expect(result).toBe('2027-01-01');
  });

  it('should return null for non-date lines', () => {
    expect(parseDateHeader('Babel Fish at Blacksmiths Arms Gosforth')).toBeNull();
    expect(parseDateHeader('200 High Street / Gosforth / 0191 213 5302')).toBeNull();
    expect(parseDateHeader('9:00 PM / FREE')).toBeNull();
  });
});

describe('parseGigLine1', () => {
  it('should extract artist and venue from "Artist at Venue"', () => {
    const result = parseGigLine1('Babel Fish at Blacksmiths Arms Gosforth');
    expect(result.artist).toBe('Babel Fish');
    expect(result.venue).toBe('Blacksmiths Arms Gosforth');
  });

  it('should handle multi-word artist names', () => {
    const result = parseGigLine1('The Red Hot Chilli Pipers at The Sage Gateshead');
    expect(result.artist).toBe('The Red Hot Chilli Pipers');
    expect(result.venue).toBe('The Sage Gateshead');
  });

  it('should handle "at" in venue name (take first "at" as delimiter)', () => {
    const result = parseGigLine1('Andy Band at The Cat at the Fiddle Newcastle');
    expect(result.artist).toBe('Andy Band');
    expect(result.venue).toBe('The Cat at the Fiddle Newcastle');
  });

  it('should return null artist for TBC performers', () => {
    const result = parseGigLine1('to be confirmed at The Local Pub');
    expect(result.artist).toBeNull();
    expect(result.skipReason).toBe('placeholder_performer');
  });

  it('should flag TBC in different cases', () => {
    expect(parseGigLine1('TBC at Venue').skipReason).toBe('placeholder_performer');
    expect(parseGigLine1('Reserved at Venue').skipReason).toBe('placeholder_performer');
  });

  it('should flag jam nights', () => {
    expect(parseGigLine1('OasisJam at Venue').skipReason).toBe('jam_night');
    expect(parseGigLine1('Blues Jam at Venue').skipReason).toBe('jam_night');
    expect(parseGigLine1('Jazz Jam at Venue').skipReason).toBe('jam_night');
  });

  it('should flag generic recurring events', () => {
    expect(parseGigLine1('Open Mic at Venue').skipReason).toBe('generic_recurring');
    expect(parseGigLine1('Buskers night at Venue').skipReason).toBe('generic_recurring');
    expect(parseGigLine1('karaoke at Venue').skipReason).toBe('generic_recurring');
    expect(parseGigLine1('Jazz Night at Venue').skipReason).toBe('generic_recurring');
  });
});

describe('parseGigLine2', () => {
  it('should extract address parts', () => {
    const result = parseGigLine2('200 High Street / Gosforth / 0191 213 5302');
    expect(result.street).toBe('200 High Street');
    expect(result.locality).toBe('Gosforth');
    expect(result.phone).toBe('0191 213 5302');
  });

  it('should handle missing phone', () => {
    const result = parseGigLine2('Main Road / Durham');
    expect(result.street).toBe('Main Road');
    expect(result.locality).toBe('Durham');
    expect(result.phone).toBeNull();
  });

  it('should detect private function', () => {
    const result = parseGigLine2('Private / Private / Private');
    expect(result.isPrivate).toBe(true);
  });

  it('should detect placeholder venue', () => {
    const result = parseGigLine2('To be confirmed / No Street / No Town');
    expect(result.isPlaceholder).toBe(true);
  });
});

describe('parseGigLine3', () => {
  it('should extract time and price', () => {
    const result = parseGigLine3('9:00 PM / FREE');
    expect(result.startTime).toBe('21:00');
    expect(result.price).toBe('FREE');
  });

  it('should handle pound prices', () => {
    const result = parseGigLine3('8:30 PM / £4.00');
    expect(result.startTime).toBe('20:30');
    expect(result.price).toBe('£4.00');
  });

  it('should handle 24h times', () => {
    const result = parseGigLine3('19:30 / £10');
    expect(result.startTime).toBe('19:30');
    expect(result.price).toBe('£10');
  });

  it('should handle missing price', () => {
    const result = parseGigLine3('9:00 PM');
    expect(result.startTime).toBe('21:00');
    expect(result.price).toBeNull();
  });
});

describe('parseOnTheCasePage', () => {
  it('should parse multiple gigs under a date header', () => {
    const html = `
      <div>Thursday 11 / June 2026</div>
      <div>Babel Fish at Blacksmiths Arms Gosforth</div>
      <div>200 High Street / Gosforth / 0191 213 5302</div>
      <div>9:00 PM / FREE</div>
      <div>The Flames at The Runhead Ryton</div>
      <div>Main Street / Ryton / 0191 123 4567</div>
      <div>8:30 PM / £5.00</div>
    `;

    const result = parseOnTheCasePage(html);
    expect(result.gigs).toHaveLength(2);

    expect(result.gigs[0].date).toBe('2026-06-11');
    expect(result.gigs[0].artist).toBe('Babel Fish');
    expect(result.gigs[0].venue).toBe('Blacksmiths Arms Gosforth');
    expect(result.gigs[0].locality).toBe('Gosforth');
    expect(result.gigs[0].startTime).toBe('21:00');
    expect(result.gigs[0].price).toBe('FREE');

    expect(result.gigs[1].date).toBe('2026-06-11');
    expect(result.gigs[1].artist).toBe('The Flames');
    expect(result.gigs[1].venue).toBe('The Runhead Ryton');
  });

  it('should handle multiple date headers', () => {
    const html = `
      <div>Thursday 11 / June 2026</div>
      <div>Band A at Venue A Newcastle</div>
      <div>Street A / Newcastle / 0191 111 1111</div>
      <div>9:00 PM / FREE</div>
      <div>Friday 12 / June 2026</div>
      <div>Band B at Venue B Sunderland</div>
      <div>Street B / Sunderland / 0191 222 2222</div>
      <div>8:00 PM / £10</div>
    `;

    const result = parseOnTheCasePage(html);
    expect(result.gigs).toHaveLength(2);
    expect(result.gigs[0].date).toBe('2026-06-11');
    expect(result.gigs[1].date).toBe('2026-06-12');
  });

  it('should park skipped gigs (TBC, jam nights, etc)', () => {
    const html = `
      <div>Thursday 11 / June 2026</div>
      <div>TBC at Some Venue Newcastle</div>
      <div>Street / Newcastle / 0191 111 1111</div>
      <div>9:00 PM / FREE</div>
    `;

    const result = parseOnTheCasePage(html);
    expect(result.gigs).toHaveLength(0);
    expect(result.parked).toHaveLength(1);
    expect(result.parked[0].reason).toBe('placeholder_performer');
  });

  it('should park private function gigs', () => {
    const html = `
      <div>Thursday 11 / June 2026</div>
      <div>Private Function at Private Venue</div>
      <div>Private / Private / Private</div>
      <div>TBC / TBC</div>
    `;

    const result = parseOnTheCasePage(html);
    expect(result.gigs).toHaveLength(0);
    expect(result.parked).toHaveLength(1);
    expect(result.parked[0].reason).toBe('private_function');
  });
});
