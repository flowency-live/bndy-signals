/**
 * KLMA Stoke Parsing Rules
 *
 * Deterministic rules for parsing KLMA community sheet data.
 *
 * Time parsing handles 28 distinct patterns observed in the live sheet.
 * Date parsing handles sentinels, form metadata, and valid event dates.
 */

import { TimeProvenance } from '../../types';

// -----------------------------------------------------------------------------
// Time Parsing
// -----------------------------------------------------------------------------

export interface TimeParseResult {
  time: string | null;
  provenance: TimeProvenance;
  warning?: string;
}

// Known time corruption patterns from KLMA spreadsheet
const CORRUPT_TIME_PATTERNS = [
  /^0?7:12(:00)?(\s*(AM|PM))?$/i, // 7:12, 07:12, 7:12 AM, 7:12:00 AM
];

// Date leaked into time column
const DATE_IN_TIME_PATTERN = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b.*\d{4}/i;

// Price-only pattern (no time at all)
const PRICE_ONLY_PATTERN = /^[£$€][\d.,]+(\s*(adv|advance|door|otd|on the door))?$/i;

/**
 * Parse a time string into HH:MM format
 */
export function parseTime(input: string): TimeParseResult {
  const raw = input.trim();

  // Empty or TBC
  if (!raw || /^tbc$/i.test(raw)) {
    return { time: null, provenance: 'defaulted_from_missing' };
  }

  // Check for date leaked into time column
  if (DATE_IN_TIME_PATTERN.test(raw)) {
    return {
      time: null,
      provenance: 'defaulted_from_corrupt_time',
      warning: 'Date leaked into time column',
    };
  }

  // Check for known corrupt time patterns (7:12 family)
  for (const pattern of CORRUPT_TIME_PATTERNS) {
    if (pattern.test(raw)) {
      return {
        time: '21:00',
        provenance: 'defaulted_from_corrupt_time',
        warning: 'Known spreadsheet time corruption',
      };
    }
  }

  // Check for price-only (no time)
  if (PRICE_ONLY_PATTERN.test(raw)) {
    return { time: null, provenance: 'defaulted_from_missing' };
  }

  // Try to extract time from the string
  const extracted = extractTimeFromString(raw);
  if (extracted) {
    return extracted;
  }

  // Couldn't parse
  return {
    time: null,
    provenance: 'defaulted_from_missing',
    warning: `Could not parse time: ${raw}`,
  };
}

function extractTimeFromString(raw: string): TimeParseResult | null {
  // Remove parenthetical notes like "(Sunday matinee 3-7pm)"
  let cleaned = raw.replace(/^\(/, '').replace(/\)$/, '');

  // FIRST: Check for matinee BEFORE range extraction
  // Handle matinee: "Sunday matinee 3-7pm" -> extract "3pm" (afternoon)
  const matineeMatch = cleaned.match(/matinee\s*(\d+)\s*[-–—]\s*(\d+)\s*(pm)?/i);
  if (matineeMatch && matineeMatch[1]) {
    const startHour = parseInt(matineeMatch[1], 10);
    // Matinee is afternoon, so if hour < 12 and no meridiem or PM, add 12
    const hour = startHour < 12 ? startHour + 12 : startHour;
    return {
      time: `${String(hour).padStart(2, '0')}:00`,
      provenance: 'inferred_afternoon',
    };
  }

  // Remove trailing notes after comma: "9pm, tickets £12.50" -> "9pm"
  cleaned = cleaned.replace(/,\s*[^,]+$/, '');

  // Remove price suffixes: "7 PM £10" -> "7 PM", "20:00 £7.00" -> "20:00"
  cleaned = cleaned.replace(/\s*[£$€][\d.,]+.*$/i, '');

  // Remove "free entry" and similar notes
  cleaned = cleaned.replace(/,?\s*(free\s*entry|all\s*welcome|tickets?).*$/i, '');

  // Check for "H-MM" pattern BEFORE range extraction (e.g., "4-30" is time, not range)
  // This pattern: single digit, hyphen, two digits (no pm at end)
  const hyphenTimePattern = cleaned.trim().match(/^(\d{1,2})[-–—](\d{2})$/);
  if (hyphenTimePattern && hyphenTimePattern[1] && hyphenTimePattern[2]) {
    const hour = parseInt(hyphenTimePattern[1], 10);
    const minute = hyphenTimePattern[2];
    // Afternoon inference for 1-6
    if (hour >= 1 && hour <= 6) {
      return {
        time: `${String(hour + 12).padStart(2, '0')}:${minute}`,
        provenance: 'inferred_afternoon',
      };
    }
    return {
      time: `${String(hour).padStart(2, '0')}:${minute}`,
      provenance: 'parsed',
    };
  }

  // Handle ranges: take the start time
  // "9pm - 11pm" -> "9pm", "5:00 PM to 7:00 PM" -> "5:00 PM"
  // "8.30pm - 10.30pm" -> "8.30pm" (dot-separated time on right side)
  // Note: hyphenTimePattern above already handled "4-30" style times
  const rangeMatch = cleaned.match(/^(.+?)\s*[-–—]\s*\d+[.:,]?\d*\s*(am|pm)?/i);
  if (rangeMatch && rangeMatch[1]) {
    cleaned = rangeMatch[1];
  }
  const toMatch = cleaned.match(/^(.+?)\s+to\s+\d/i);
  if (toMatch && toMatch[1]) {
    cleaned = toMatch[1];
  }

  // Now try various time patterns
  cleaned = cleaned.trim();

  // Pattern: already 24h format "21:00" or "20:30"
  const time24h = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (time24h && time24h[1] && time24h[2]) {
    const hour = parseInt(time24h[1], 10);
    const minute = time24h[2];
    if (hour >= 0 && hour <= 23) {
      // Bare time without meridiem - apply evening default for hour 1-11
      if (hour >= 1 && hour <= 11) {
        return {
          time: `${String(hour + 12).padStart(2, '0')}:${minute}`,
          provenance: 'inferred_evening',
        };
      }
      return {
        time: `${String(hour).padStart(2, '0')}:${minute}`,
        provenance: 'parsed',
      };
    }
  }

  // Pattern: "HH:MM:SS AM/PM" - strip seconds
  const timeWithSeconds = cleaned.match(
    /^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i
  );
  if (timeWithSeconds && timeWithSeconds[1] && timeWithSeconds[2] && timeWithSeconds[4]) {
    return parseTimeWithMeridiem(
      timeWithSeconds[1],
      timeWithSeconds[2],
      timeWithSeconds[4]
    );
  }

  // Pattern: "HH:MM AM/PM" or "H:MM AM/PM"
  const timeWithMeridiem = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (timeWithMeridiem && timeWithMeridiem[1] && timeWithMeridiem[2] && timeWithMeridiem[3]) {
    return parseTimeWithMeridiem(
      timeWithMeridiem[1],
      timeWithMeridiem[2],
      timeWithMeridiem[3]
    );
  }

  // Pattern: "Hpm" or "HHpm" or "H PM" or "HH PM" (no minutes)
  const hourOnly = cleaned.match(/^(\d{1,2})\s*(AM|PM)$/i);
  if (hourOnly && hourOnly[1] && hourOnly[2]) {
    return parseTimeWithMeridiem(hourOnly[1], '00', hourOnly[2]);
  }

  // Pattern: "H.MMpm" - dot as colon separator
  const dotSeparator = cleaned.match(/^(\d{1,2})\.(\d{2})\s*(AM|PM)?$/i);
  if (dotSeparator && dotSeparator[1] && dotSeparator[2]) {
    const meridiem = dotSeparator[3] || 'PM'; // default to PM for evening
    return parseTimeWithMeridiem(dotSeparator[1], dotSeparator[2], meridiem);
  }

  // Pattern: "H MMpm" - space as separator
  const spaceSeparator = cleaned.match(/^(\d{1,2})\s+(\d{2})\s*(AM|PM)$/i);
  if (spaceSeparator && spaceSeparator[1] && spaceSeparator[2] && spaceSeparator[3]) {
    return parseTimeWithMeridiem(
      spaceSeparator[1],
      spaceSeparator[2],
      spaceSeparator[3]
    );
  }

  // Pattern: "HMMpm" or "HHMMpm" - no separator
  const noSeparator = cleaned.match(/^(\d{1,2})(\d{2})\s*(AM|PM)$/i);
  if (noSeparator && noSeparator[1] && noSeparator[2] && noSeparator[3]) {
    return parseTimeWithMeridiem(
      noSeparator[1],
      noSeparator[2],
      noSeparator[3]
    );
  }

  // Pattern: "H-MM" - hyphen as separator (afternoon inference)
  // e.g., "4-30" -> 16:30
  const hyphenSeparator = cleaned.match(/^(\d{1,2})[-–—](\d{1,2})$/);
  if (hyphenSeparator && hyphenSeparator[1] && hyphenSeparator[2]) {
    const hour = parseInt(hyphenSeparator[1], 10);
    const minutePart = hyphenSeparator[2];
    // Pad minute to 2 digits (4-30 -> 30, 4-5 -> 05)
    const minute = minutePart.length === 1 ? `0${minutePart}` : minutePart;
    // Afternoon inference for 1-6
    if (hour >= 1 && hour <= 6) {
      return {
        time: `${String(hour + 12).padStart(2, '0')}:${minute}`,
        provenance: 'inferred_afternoon',
      };
    }
    return {
      time: `${String(hour).padStart(2, '0')}:${minute}`,
      provenance: 'parsed',
    };
  }

  // Pattern: bare single digit "9" -> 21:00 (evening default)
  const bareHour = cleaned.match(/^(\d{1,2})$/);
  if (bareHour && bareHour[1]) {
    const hour = parseInt(bareHour[1], 10);
    if (hour >= 1 && hour <= 11) {
      return {
        time: `${String(hour + 12).padStart(2, '0')}:00`,
        provenance: 'inferred_evening',
      };
    }
    if (hour >= 12 && hour <= 23) {
      return {
        time: `${String(hour).padStart(2, '0')}:00`,
        provenance: 'parsed',
      };
    }
  }

  return null;
}

function parseTimeWithMeridiem(
  hourStr: string,
  minuteStr: string,
  meridiem: string
): TimeParseResult {
  let hour = parseInt(hourStr, 10);
  const minute = minuteStr;
  const isPM = /pm/i.test(meridiem);
  const isAM = /am/i.test(meridiem);

  // Handle 24h values with stray PM (13:30pm -> 13:30, NOT 25:30)
  if (hour >= 13 && hour <= 23) {
    // Already in 24h format, ignore meridiem
    return {
      time: `${String(hour).padStart(2, '0')}:${minute}`,
      provenance: 'parsed',
    };
  }

  // Standard 12h -> 24h conversion
  if (isPM && hour < 12) {
    hour += 12;
  } else if (isAM && hour === 12) {
    hour = 0;
  }

  return {
    time: `${String(hour).padStart(2, '0')}:${minute}`,
    provenance: 'parsed',
  };
}

// -----------------------------------------------------------------------------
// Date Parsing
// -----------------------------------------------------------------------------

const DATE_SENTINEL_1899 = /\b1899\b/;

const FORM_METADATA_PATTERNS = [
  /you can add your own gigs/i,
  /add your gig/i,
  /^1\/1\/0125$/,
  /keep live music alive/i,
  /^@everyone$/,
  /^\.$/, // Single dot
  /^https?:\/\//i, // URLs
  /there's got to be way more gigs/i,
  /this is the form/i,
];

// Invalid date patterns that indicate metadata rows
const INVALID_DATE_PATTERNS = [
  /\/0\d{2,3}$/, // Years like 0125, 0202
  /\/20[3-9]\d$/, // Far future years 2030-2099
  /\/204\d$/, // Years like 2040
];

/**
 * Check if a date string is the 1899 sentinel (Excel epoch)
 */
export function isDateSentinel(dateStr: string): boolean {
  return DATE_SENTINEL_1899.test(dateStr);
}

/**
 * Check if a row is form metadata (header/instruction row)
 */
export function isFormMetadataRow(row: {
  date: string;
  artist: string;
  venue: string;
  time: string;
}): boolean {
  // Check artist field for metadata text
  for (const pattern of FORM_METADATA_PATTERNS) {
    if (pattern.test(row.artist)) {
      return true;
    }
    if (pattern.test(row.date)) {
      return true;
    }
  }

  // Check for invalid date patterns (indicates metadata row)
  for (const pattern of INVALID_DATE_PATTERNS) {
    if (pattern.test(row.date)) {
      return true;
    }
  }

  return false;
}

/**
 * Parse a date string into YYYY-MM-DD format
 */
export function parseDate(dateStr: string): string | null {
  const trimmed = dateStr.trim();

  // Check for sentinel
  if (isDateSentinel(trimmed)) {
    return null;
  }

  // Long form: "Saturday, June 14, 2026"
  const longForm = trimmed.match(
    /^(?:\w+,\s*)?(\w+)\s+(\d{1,2}),?\s*(\d{4})$/
  );
  if (longForm && longForm[1] && longForm[2] && longForm[3]) {
    const month = parseMonth(longForm[1]);
    const day = parseInt(longForm[2], 10);
    const year = parseInt(longForm[3], 10);

    if (month && day >= 1 && day <= 31 && year >= 2000) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Short form with slashes: "14/06/2026" or "6/14/2026"
  // KLMA uses UK format (DD/MM/YYYY)
  const slashForm = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashForm && slashForm[1] && slashForm[2] && slashForm[3]) {
    const part1 = parseInt(slashForm[1], 10);
    const part2 = parseInt(slashForm[2], 10);
    let year = parseInt(slashForm[3], 10);

    // Convert 2-digit year
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }

    // UK format: DD/MM/YYYY
    if (part1 <= 31 && part2 <= 12 && year >= 2000) {
      return `${year}-${String(part2).padStart(2, '0')}-${String(part1).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseMonth(monthStr: string): number | null {
  const months: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };

  return months[monthStr.toLowerCase()] || null;
}
