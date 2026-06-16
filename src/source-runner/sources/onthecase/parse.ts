/**
 * On The Case Parser
 *
 * Parses the 3-line gig listing format from onthecasemusic.co.uk/gigs:
 * 1. {Artist} at {Venue name + locality}
 * 2. {Street} / {Locality} / {Phone}
 * 3. {Start time} / {Price}
 *
 * Grouped under date headers like "Thursday 11 / June 2026"
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

// Placeholder performers to skip
const PLACEHOLDER_PATTERNS = [
  /^to be confirmed$/i,
  /^tbc$/i,
  /^reserved$/i,
  /proposal$/i, // "Indie Scene Proposal"
];

// Jam nights to flag for review
const JAM_PATTERNS = [/jam$/i, /jam\s*night$/i];

// Generic recurring events to flag
const GENERIC_PATTERNS = [
  /^buskers?\s*night$/i,
  /^open\s*mic$/i,
  /^karaoke$/i,
  /^jazz\s*night$/i,
];

export interface OnTheCaseRawGig {
  date: string; // ISO date
  artist: string;
  venue: string;
  street: string;
  locality: string;
  phone: string | null;
  startTime: string;
  price: string | null;
}

export interface OnTheCaseParkedGig {
  date: string;
  rawLine1: string;
  rawLine2: string;
  rawLine3: string;
  reason: string;
}

export interface OnTheCaseParseResult {
  gigs: OnTheCaseRawGig[];
  parked: OnTheCaseParkedGig[];
}

/**
 * Parse a date header like "Thursday 11 / June 2026"
 * Returns ISO date string (YYYY-MM-DD) or null if not a date header.
 */
export function parseDateHeader(line: string): string | null {
  // Pattern: Day DD / Month YYYY
  const match = line.match(/^\w+\s+(\d{1,2})\s*\/\s*(\w+)\s+(\d{4})$/);
  if (!match || !match[1] || !match[2] || !match[3]) return null;

  const day = match[1].padStart(2, '0');
  const monthName = match[2].toLowerCase();
  const year = match[3];

  const month = MONTHS[monthName];
  if (!month) return null;

  return `${year}-${month}-${day}`;
}

/**
 * Parse line 1: "{Artist} at {Venue name + locality}"
 */
export function parseGigLine1(line: string): {
  artist: string | null;
  venue: string;
  skipReason?: string;
} {
  // Split on first " at " (case-insensitive)
  const atIndex = line.toLowerCase().indexOf(' at ');
  if (atIndex === -1) {
    return { artist: null, venue: line, skipReason: 'unparseable' };
  }

  const artist = line.slice(0, atIndex).trim();
  const venue = line.slice(atIndex + 4).trim();

  // Check for placeholder performers
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(artist)) {
      return { artist: null, venue, skipReason: 'placeholder_performer' };
    }
  }

  // Check for jam nights
  for (const pattern of JAM_PATTERNS) {
    if (pattern.test(artist)) {
      return { artist: null, venue, skipReason: 'jam_night' };
    }
  }

  // Check for generic recurring events
  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(artist)) {
      return { artist: null, venue, skipReason: 'generic_recurring' };
    }
  }

  return { artist, venue };
}

/**
 * Parse line 2: "{Street} / {Locality} / {Phone}"
 */
export function parseGigLine2(line: string): {
  street: string;
  locality: string;
  phone: string | null;
  isPrivate?: boolean;
  isPlaceholder?: boolean;
} {
  const parts = line.split('/').map((p) => p.trim());

  const street = parts[0] || '';
  const locality = parts[1] || '';
  const phone = parts[2] || null;

  // Check for private function
  if (
    street.toLowerCase() === 'private' &&
    locality.toLowerCase() === 'private'
  ) {
    return { street, locality, phone, isPrivate: true };
  }

  // Check for placeholder venue
  if (
    street.toLowerCase().includes('to be confirmed') ||
    street.toLowerCase() === 'no street' ||
    locality.toLowerCase() === 'no town'
  ) {
    return { street, locality, phone, isPlaceholder: true };
  }

  return { street, locality, phone };
}

/**
 * Parse line 3: "{Start time} / {Price}"
 */
export function parseGigLine3(line: string): {
  startTime: string;
  price: string | null;
} {
  const parts = line.split('/').map((p) => p.trim());
  const timeStr = parts[0] || '';
  const price = parts[1] || null;

  const startTime = parseTime(timeStr);

  return { startTime, price };
}

/**
 * Parse time string to HH:MM format.
 * Handles: "9:00 PM", "8:30 PM", "19:30", "9 PM", etc.
 */
function parseTime(timeStr: string): string {
  // Remove extra whitespace
  const clean = timeStr.trim().toUpperCase();

  // Try 12-hour format: "9:00 PM", "8:30 PM", "9 PM"
  const match12 = clean.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/);
  if (match12 && match12[1] && match12[3]) {
    let hour = parseInt(match12[1], 10);
    const min = match12[2] || '00';
    const period = match12[3];

    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;

    return `${hour.toString().padStart(2, '0')}:${min}`;
  }

  // Try 24-hour format: "19:30"
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24 && match24[1] && match24[2]) {
    const hour = match24[1].padStart(2, '0');
    const min = match24[2];
    return `${hour}:${min}`;
  }

  // Default to evening if unparseable
  return '21:00';
}

/**
 * Parse the full On The Case HTML page into gigs.
 * Extracts text lines and groups them by date header.
 */
export function parseOnTheCasePage(html: string): OnTheCaseParseResult {
  // Strip HTML tags and get text lines
  const text = html.replace(/<[^>]+>/g, '\n');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const gigs: OnTheCaseRawGig[] = [];
  const parked: OnTheCaseParkedGig[] = [];

  let currentDate: string | null = null;
  let lineBuffer: string[] = [];

  for (const line of lines) {
    // Check if it's a date header
    const date = parseDateHeader(line);
    if (date) {
      // Process any buffered lines under previous date
      processBuffer(lineBuffer, currentDate, gigs, parked);
      lineBuffer = [];
      currentDate = date;
      continue;
    }

    // Accumulate lines
    lineBuffer.push(line);

    // If we have 3 lines, process as a gig
    if (lineBuffer.length === 3 && currentDate) {
      processGig(lineBuffer as [string, string, string], currentDate, gigs, parked);
      lineBuffer = [];
    }
  }

  // Process any remaining lines
  processBuffer(lineBuffer, currentDate, gigs, parked);

  return { gigs, parked };
}

/**
 * Process remaining buffered lines (may be incomplete gig).
 */
function processBuffer(
  lines: string[],
  date: string | null,
  _gigs: OnTheCaseRawGig[],
  _parked: OnTheCaseParkedGig[]
): void {
  // If incomplete, just discard (or could park as unparseable)
  // For now, discard incomplete entries
  if (lines.length > 0 && lines.length < 3) {
    // Could log or park these
  }
}

/**
 * Process a complete 3-line gig entry.
 */
function processGig(
  lines: [string, string, string], // Exactly 3 lines
  date: string,
  gigs: OnTheCaseRawGig[],
  parked: OnTheCaseParkedGig[]
): void {
  const [rawLine1, rawLine2, rawLine3] = lines;
  const line1 = parseGigLine1(rawLine1);
  const line2 = parseGigLine2(rawLine2);
  const line3 = parseGigLine3(rawLine3);

  // Check for skip reasons
  if (line1.skipReason) {
    parked.push({
      date,
      rawLine1,
      rawLine2,
      rawLine3,
      reason: line1.skipReason,
    });
    return;
  }

  if (line2.isPrivate) {
    parked.push({
      date,
      rawLine1,
      rawLine2,
      rawLine3,
      reason: 'private_function',
    });
    return;
  }

  if (line2.isPlaceholder) {
    parked.push({
      date,
      rawLine1,
      rawLine2,
      rawLine3,
      reason: 'placeholder_venue',
    });
    return;
  }

  if (!line1.artist) {
    parked.push({
      date,
      rawLine1,
      rawLine2,
      rawLine3,
      reason: 'unparseable',
    });
    return;
  }

  gigs.push({
    date,
    artist: line1.artist,
    venue: line1.venue,
    street: line2.street,
    locality: line2.locality,
    phone: line2.phone,
    startTime: line3.startTime,
    price: line3.price,
  });
}
