/**
 * Scenic Eye Parser
 *
 * Parses the weekly gig listings from scenicmind.co.uk/sceniceye.
 * Based on sceniceye-source-handoff.md:
 *
 * - Week header: "11 June – 17 June 2026"
 * - Day groupings (Thu-Sun are the busy ones)
 * - Full street addresses + explicit times
 * - Staleness check: if edition is past, import 0
 *
 * Region: Hampshire (Hayling Island, Havant, Emsworth, Waterlooville)
 */

const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

// Artist aliases from handoff doc
const ARTIST_ALIASES: Record<string, string> = {
  'lianne weston': 'Leanne Weston',
};

// Day of week to offset from week start (Thursday = 0)
const DAY_OFFSETS: Record<string, number> = {
  thursday: 0,
  friday: 1,
  saturday: 2,
  sunday: 3,
  monday: 4,
  tuesday: 5,
  wednesday: 6,
};

export interface WeekHeaderResult {
  startDay: number;
  startMonth: string;
  endDay: number;
  endMonth: string;
  year: number;
}

export interface DayHeaderResult {
  dayOfWeek: string;
}

export interface GigRowResult {
  artist: string;
  venue: string;
  venueAddress: string;
  time: string;
  skipReason?: string;
}

export interface ScenicEyeRawGig {
  date: string; // ISO date
  artist: string;
  venue: string;
  venueAddress: string;
  time: string;
}

export interface ScenicEyeParkedGig {
  date: string;
  rawLine: string;
  reason: string;
}

export interface ScenicEyeParseResult {
  gigs: ScenicEyeRawGig[];
  parked: ScenicEyeParkedGig[];
  isStale: boolean;
  staleReason?: string;
}

/**
 * Parse week header like "11 June – 17 June 2026" or "11 June - 17 June 2026"
 */
export function parseWeekHeader(line: string): WeekHeaderResult | null {
  // Pattern: DD Month [–-] DD Month YYYY
  const match = line.match(
    /^(\d{1,2})\s+(\w+)\s*[–-]\s*(\d{1,2})\s+(\w+)\s+(\d{4})$/i
  );
  if (!match) return null;

  const [, startDay, startMonth, endDay, endMonth, year] = match;
  if (!startDay || !startMonth || !endDay || !endMonth || !year) return null;

  return {
    startDay: parseInt(startDay, 10),
    startMonth,
    endDay: parseInt(endDay, 10),
    endMonth,
    year: parseInt(year, 10),
  };
}

/**
 * Parse day header like "Thursday 11 June 2026" or just "Thursday".
 * Returns day of week for day offset calculation.
 */
export function parseDayHeader(line: string): DayHeaderResult | null {
  const trimmed = line.trim();
  const days = ['Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday'];

  // Check for full date format: "Thursday 11 June 2026"
  const dateMatch = trimmed.match(/^(\w+)\s+\d{1,2}\s+\w+\s+\d{4}$/i);
  if (dateMatch && dateMatch[1]) {
    const dayWord = dateMatch[1];
    for (const day of days) {
      if (dayWord.toLowerCase() === day.toLowerCase()) {
        return { dayOfWeek: day };
      }
    }
  }

  // Also accept just the day name
  for (const day of days) {
    if (trimmed.toLowerCase() === day.toLowerCase()) {
      return { dayOfWeek: day };
    }
  }

  return null;
}

/**
 * Parse time string to HH:MM format.
 * Handles: "8pm", "9:30pm", "21:00", "3pm", "14:30", etc.
 */
function parseTime(timeStr: string): string {
  const clean = timeStr.trim().toLowerCase();

  // Try 12-hour format: "8pm", "9:30pm", "3pm"
  const match12 = clean.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)$/);
  if (match12 && match12[1] && match12[3]) {
    let hour = parseInt(match12[1], 10);
    const min = match12[2] || '00';
    const period = match12[3];

    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    return `${hour.toString().padStart(2, '0')}:${min}`;
  }

  // Try 24-hour format: "21:00", "14:30"
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24 && match24[1] && match24[2]) {
    const hour = match24[1].padStart(2, '0');
    return `${hour}:${match24[2]}`;
  }

  return '';
}

/**
 * Normalise artist name using aliases from handoff doc.
 */
function normaliseArtist(artist: string): string {
  // Strip a trailing ticketing marker the source appends, e.g. "Pulse - A Pink Floyd Tribute - 🎫Ticket".
  const cleaned = artist
    .replace(/\s*[-\u2013\u2014]\s*\uD83C\uDFAB?\s*ticket\s*$/iu, '')
    .replace(/\uD83C\uDFAB/gu, '')
    .trim();
  const lower = cleaned.toLowerCase().trim();
  if (ARTIST_ALIASES[lower]) {
    return ARTIST_ALIASES[lower];
  }
  return cleaned;
}

/**
 * Parse a single-line gig row like "The Ashes at West Town Inn, 22 West Town Lane, Hayling Island, 8pm"
 * This handles the old format where all info is on one line.
 */
export function parseGigRow(line: string): GigRowResult | null {
  const trimmed = line.trim();

  if (!trimmed) return null;

  // Must contain " at "
  const atIndex = trimmed.toLowerCase().indexOf(' at ');
  if (atIndex === -1) return null;

  const rawArtist = trimmed.slice(0, atIndex).trim();
  const venueAndRest = trimmed.slice(atIndex + 4).trim();

  // Parse venue, address, and time
  // Format: "Venue Name, Street Address, Town, Time"
  // Split by comma and work backwards - last part is time
  const parts = venueAndRest.split(',').map((p) => p.trim());

  if (parts.length < 2) return null;

  // Last part should be the time
  const timePart = parts[parts.length - 1];
  const time = parseTime(timePart || '');

  if (!time) return null;

  // First part is venue name
  const venue = parts[0] || '';

  // Middle parts (excluding first and last) are the address
  const addressParts = parts.slice(1, -1);
  const venueAddress = addressParts.join(', ');

  // Apply artist alias
  const artist = normaliseArtist(rawArtist);

  return {
    artist,
    venue,
    venueAddress,
    time,
  };
}

/**
 * Parse a time range like "7:30 PM – 9:30 PM" or "8:00 PM – 10:00 PM"
 * Returns just the start time in HH:MM format.
 */
function parseTimeRange(timeStr: string): string {
  // Split on dash or en-dash
  const parts = timeStr.split(/\s*[–-]\s*/);
  if (parts.length === 0 || !parts[0]) return '';

  // Parse the first (start) time
  const startTime = parts[0].trim();

  // Handle "7:30 PM" format
  const match = startTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match && match[1] && match[2] && match[3]) {
    let hour = parseInt(match[1], 10);
    const min = match[2];
    const period = match[3].toUpperCase();

    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;

    return `${hour.toString().padStart(2, '0')}:${min}`;
  }

  return parseTime(startTime);
}

/**
 * Check if a line is the table header row (Act, Venue, Time).
 */
function isTableHeader(line: string): boolean {
  const lower = line.toLowerCase().trim();
  return lower === 'act' || lower === 'venue' || lower === 'time';
}

/**
 * Check if a line is a "No gigs listed" placeholder.
 */
function isNoGigsLine(line: string): boolean {
  return /no gigs listed/i.test(line);
}

/**
 * Check if a line looks like a sponsored/ad section.
 */
function isSponsoredLine(line: string): boolean {
  return /^sponsored/i.test(line.trim()) || /^📌/.test(line.trim());
}

/**
 * Check if edition is stale (all gigs are in the past).
 */
export function isEditionStale(
  weekHeader: WeekHeaderResult,
  runDate: string
): boolean {
  // Convert end date to ISO for comparison
  const endMonthNum = MONTHS[weekHeader.endMonth.toLowerCase()];
  if (!endMonthNum) return true;

  const endDateStr = `${weekHeader.year}-${endMonthNum}-${weekHeader.endDay.toString().padStart(2, '0')}`;

  // Run date is after edition end date = stale
  return runDate > endDateStr;
}

/**
 * Calculate the ISO date for a day within the edition week.
 */
function calculateDayDate(
  weekHeader: WeekHeaderResult,
  dayOfWeek: string
): string {
  const offset = DAY_OFFSETS[dayOfWeek.toLowerCase()];
  if (offset === undefined) return '';

  const startMonthNum = MONTHS[weekHeader.startMonth.toLowerCase()];
  if (!startMonthNum) return '';

  // Create start date and add offset
  const startDate = new Date(
    weekHeader.year,
    parseInt(startMonthNum, 10) - 1,
    weekHeader.startDay
  );
  startDate.setDate(startDate.getDate() + offset);

  const year = startDate.getFullYear();
  const month = (startDate.getMonth() + 1).toString().padStart(2, '0');
  const day = startDate.getDate().toString().padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Parse the full Scenic Eye page into gigs.
 * Handles both single-line format and multi-line table format from innerText.
 * @param html The raw HTML content or innerText
 * @param runDate The run date (YYYY-MM-DD) for staleness check
 */
export function parseScenicEyePage(
  html: string,
  runDate: string
): ScenicEyeParseResult {
  // Strip HTML tags and get text lines
  const text = html.replace(/<[^>]+>/g, '\n');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const gigs: ScenicEyeRawGig[] = [];
  const parked: ScenicEyeParkedGig[] = [];

  // Find week header
  let weekHeader: WeekHeaderResult | null = null;
  for (const line of lines) {
    const parsed = parseWeekHeader(line);
    if (parsed) {
      weekHeader = parsed;
      break;
    }
  }

  // No week header = can't determine dates
  if (!weekHeader) {
    return {
      gigs: [],
      parked: [],
      isStale: true,
      staleReason: 'No week header found',
    };
  }

  // Check staleness
  if (isEditionStale(weekHeader, runDate)) {
    return {
      gigs: [],
      parked: [],
      isStale: true,
      staleReason: `Edition ${weekHeader.startDay} ${weekHeader.startMonth} – ${weekHeader.endDay} ${weekHeader.endMonth} ${weekHeader.year} is past run date ${runDate}`,
    };
  }

  // Parse gigs - handle both single-line and multi-line (table) formats
  let currentDay: string | null = null;
  let currentDate: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    // Check if it's a day header
    const dayHeader = parseDayHeader(line);
    if (dayHeader) {
      currentDay = dayHeader.dayOfWeek;
      currentDate = calculateDayDate(weekHeader, currentDay);
      i++;
      continue;
    }

    // Skip table headers, sponsored lines, no gigs placeholders
    if (isTableHeader(line) || isSponsoredLine(line) || isNoGigsLine(line)) {
      i++;
      continue;
    }

    // Skip if no current date set
    if (!currentDate) {
      i++;
      continue;
    }

    // Try single-line format first (old format with " at ")
    const singleLineParsed = parseGigRow(line);
    if (singleLineParsed) {
      gigs.push({
        date: currentDate,
        artist: singleLineParsed.artist,
        venue: singleLineParsed.venue,
        venueAddress: singleLineParsed.venueAddress,
        time: singleLineParsed.time,
      });
      i++;
      continue;
    }

    // Try multi-line table format: Artist, Venue+Address, TimeRange on 3 consecutive lines
    // Skip if this looks like a header or metadata line
    const venueLine = lines[i + 1];
    const timeLine = lines[i + 2];
    if (i + 2 < lines.length && !isTableHeader(line) && venueLine && timeLine) {
      const artistLine = line;

      // Validate: timeLine should look like a time range
      if (/\d{1,2}:\d{2}\s*(AM|PM)/i.test(timeLine)) {
        // Check it's not another day header or table header
        if (!parseDayHeader(venueLine) && !isTableHeader(venueLine) &&
            !parseDayHeader(timeLine) && !isTableHeader(timeLine)) {

          const time = parseTimeRange(timeLine);
          if (time) {
            // Parse venue - may have address embedded
            const venueParts = venueLine.split(',').map((p) => p.trim());
            const venue = venueParts[0] || venueLine;
            const venueAddress = venueParts.slice(1).join(', ');

            const artist = normaliseArtist(artistLine);

            gigs.push({
              date: currentDate,
              artist,
              venue,
              venueAddress,
              time,
            });

            i += 3; // Skip all 3 lines
            continue;
          }
        }
      }
    }

    // Not a gig row, skip
    i++;
  }

  return {
    gigs,
    parked,
    isStale: false,
  };
}