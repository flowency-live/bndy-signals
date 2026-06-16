/**
 * KLMA Parsing Rules Tests
 *
 * 28 time parsing patterns + date handling rules
 */

import { describe, it, expect } from 'vitest';
import {
  parseTime,
  parseDate,
  isFormMetadataRow,
  isDateSentinel,
  TimeParseResult,
} from './rules';

describe('KLMA Time Parsing', () => {
  // Time vectors for 28 distinct patterns observed in the live sheet
  const timeVectors: Array<{
    in: string;
    out: string | null;
    note?: string;
    provenance?: string;
  }> = [
    { in: '9pm', out: '21:00', note: 'meridiem pm' },
    { in: '9 PM', out: '21:00' },
    { in: '8:30pm', out: '20:30' },
    { in: '9.30pm', out: '21:30', note: 'dot as colon' },
    { in: '21:00', out: '21:00', note: 'already 24h' },
    { in: '2:00:00 PM', out: '14:00', note: 'strip seconds' },
    { in: '7 30pm', out: '19:30', note: 'space as separator' },
    { in: '915pm', out: '21:15', note: 'no separator, 3-4 digits + meridiem' },
    {
      in: '13:30pm',
      out: '13:30',
      note: '24h value already >12 -> ignore stray pm, do NOT add 12',
    },
    { in: '9pm - 11pm', out: '21:00', note: 'range -> take start' },
    { in: '8.30pm - 10.30pm', out: '20:30' },
    { in: '9pm, tickets £12.50', out: '21:00', note: 'strip trailing price/notes' },
    {
      in: '(Sunday matinee 3-7pm)',
      out: '15:00',
      note: 'matinee, range start, parenthetical',
    },
    {
      in: '7:12 AM',
      out: '21:00',
      note: 'KLMA spreadsheet time-corruption sentinel',
      provenance: 'defaulted_from_corrupt_time',
    },
    { in: '07:12', out: '21:00', provenance: 'defaulted_from_corrupt_time' },
    { in: '7:12:00 AM', out: '21:00', provenance: 'defaulted_from_corrupt_time' },
    {
      in: 'TBC',
      out: null,
      note: 'explicit unknown -> null (then config default may apply)',
    },
    {
      in: '',
      out: null,
      note: 'blank -> null; eventPolicy.missingTimeDefault=21:00 applies as INFERRED',
    },
    { in: '10pm', out: '22:00', note: 'observed' },
    {
      in: '9:30',
      out: '21:30',
      note: 'bare H:MM, no meridiem -> evening default',
      provenance: 'inferred_evening',
    },
    {
      in: '9',
      out: '21:00',
      note: 'bare hour, no meridiem -> evening default PM',
      provenance: 'inferred_evening',
    },
    {
      in: '£15.00 adv',
      out: null,
      note: 'PRICE ONLY, no time -> null + park/anomaly',
    },
    { in: '7 PM  £10', out: '19:00', note: 'extract time, drop price' },
    { in: '20:00  £7.00', out: '20:00', note: 'extract time, drop price' },
    { in: '9pm, free entry, all welcome', out: '21:00', note: 'strip notes' },
    { in: '5:00 PM to 7:00 PM', out: '17:00', note: "'to' range -> start" },
    {
      in: '4-30',
      out: '16:30',
      note: 'ambiguous afternoon, hyphen as colon',
      provenance: 'inferred_afternoon',
    },
    {
      in: 'Saturday, December 30, 1899',
      out: null,
      note: 'DATE leaked into time column -> null + anomaly',
    },
  ];

  describe('parseTime', () => {
    timeVectors.forEach(({ in: input, out: expected, note, provenance }) => {
      it(`should parse "${input}" -> ${expected}${note ? ` (${note})` : ''}`, () => {
        const result = parseTime(input);

        expect(result.time).toBe(expected);

        if (provenance) {
          expect(result.provenance).toBe(provenance);
        }
      });
    });

    it('should handle whitespace variations', () => {
      expect(parseTime('  9pm  ').time).toBe('21:00');
      expect(parseTime('\t8:30pm\n').time).toBe('20:30');
    });

    it('should handle case insensitivity', () => {
      expect(parseTime('9PM').time).toBe('21:00');
      expect(parseTime('9Am').time).toBe('09:00');
      expect(parseTime('tbc').time).toBe(null);
    });
  });
});

describe('KLMA Date Parsing', () => {
  describe('parseDate', () => {
    it('should parse long form dates', () => {
      expect(parseDate('Saturday, June 14, 2026')).toBe('2026-06-14');
      expect(parseDate('Thursday, May 15, 2026')).toBe('2026-05-15');
    });

    it('should return null for sentinel dates', () => {
      expect(parseDate('Saturday, December 30, 1899')).toBe(null);
    });

    it('should return null for invalid dates', () => {
      expect(parseDate('1/1/0125')).toBe(null); // Year 125 is invalid (< 2000)
    });

    it('should parse valid short-form dates (UK format DD/MM/YYYY)', () => {
      expect(parseDate('1/5/2026')).toBe('2026-05-01');
      expect(parseDate('14/06/2026')).toBe('2026-06-14');
    });
  });

  describe('isDateSentinel', () => {
    it('should identify 1899 sentinel', () => {
      expect(isDateSentinel('Saturday, December 30, 1899')).toBe(true);
      expect(isDateSentinel('December 30, 1899')).toBe(true);
    });

    it('should not flag valid dates', () => {
      expect(isDateSentinel('Saturday, June 14, 2026')).toBe(false);
    });
  });

  describe('isFormMetadataRow', () => {
    it('should identify form metadata rows', () => {
      expect(
        isFormMetadataRow({
          date: '1/1/0125',
          artist: 'You can add your own gigs',
          venue: '',
          time: '',
        })
      ).toBe(true);

      expect(
        isFormMetadataRow({
          date: '1/5/2026',
          artist: 'Add your gig here',
          venue: '',
          time: '',
        })
      ).toBe(true);
    });

    it('should not flag valid event rows', () => {
      expect(
        isFormMetadataRow({
          date: 'Saturday, June 14, 2026',
          artist: 'Stingray',
          venue: 'The Rigger',
          time: '9pm',
        })
      ).toBe(false);
    });
  });
});

describe('TimeParseResult', () => {
  it('should have correct structure', () => {
    const result: TimeParseResult = {
      time: '21:00',
      provenance: 'parsed',
      warning: undefined,
    };

    expect(result.time).toBe('21:00');
    expect(result.provenance).toBe('parsed');
  });
});
