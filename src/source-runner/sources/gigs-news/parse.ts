/**
 * gigs-news Parser
 *
 * Parses the weekly gig listings from gigs-news.uk.
 * Based on handoff doc: gigs-news-source-handoff.md
 *
 * Page structure:
 * - "What's on This Week — <date range>" header
 * - Day groupings (Friday/Saturday/Sunday are the busy ones)
 * - Gig rows: {Artist} at {Venue}, {Time}
 *
 * Region: Stockport/Tameside/east Cheshire/Saddleworth/High Peak fringe
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

// Venue aliases from handoff doc
const VENUE_ALIASES: Record<string, string> = {
  'mash guru': 'Mash',
  'bulls head': "The Bull's Head",
  "bull's head": "The Bull's Head",
  'marple con & social club': 'Marple Con Club',
  'railway greenfield': 'Railway Greenfield', // Uses existing record NwEtqexKQqLHyBcPVgJF
};

// Flagged venues that should not be auto-created (geocode issues)
const FLAGGED_VENUES = ['ashton jubilee club'];

// Placeholder performers to skip
const PLACEHOLDER_PATTERNS = [
  /^reserved$/i,
  /^reserved\s*-/i,
  /^closed$/i,
  /^live bands?$/i,
  /^tbc$/i,
  /^to be confirmed$/i,
];

// Jam nights to flag
const JAM_PATTERNS = [/jam$/i, /jam\s*night$/i, /blues\s*jam/i];

// Generic recurring events to flag (match anywhere in the artist, not anchored —
// "Karl Magee's Open Mic", "Between the Vines Open Mic", "Dave's karaoke" must all skip)
const GENERIC_PATTERNS = [
  /open\s*mic/i,
  /karaoke/i,
  /^disco$/i,
  /music\s*quiz/i,
  /^quiz\s*night$/i,
  /^jazz(\s*night)?$/i, // bare "Jazz" + "Jazz Night" only. NB: a *named* recurring series
  // ("Jazz at the Railway") is intentionally NOT caught — recurring-series handling is still open.
  /^football$/i, // a TV sport screening, not a gig ("football - the Dog Inn")
];

// "gigs 2026" footer/booking rows: the parsed "artist" is actually a date ("Saturday 20th June")
const DATE_AS_ARTIST_PATTERN =
  /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2}(st|nd|rd|th)\s+\w+/i;
// A bare time parsed into the artist slot ("4pm", "8:30pm")
const TIME_AS_ARTIST_PATTERN = /^\d{1,2}([:.]\d{2})?\s*(am|pm)$/i;
// Booking placeholders carried on the venue ("… - branded", "… - Reserved", "… - Reserved - 4pm")
const PLACEHOLDER_VENUE_SUFFIX = /-\s*(branded|reserved)\b/i;

// Generic DJ rows to flag for manual review
const DJ_PATTERNS = [/^dj\s+\w+$/i];

// Footer/contact block patterns to ignore
const FOOTER_PATTERNS = [
  /recording my songs/i,
  /my bands/i,
  /contact/i,
  /chris statham/i,
  /^\d{5}\s+\d{6}$/, // Phone number pattern
  /email:/i,
];

export interface GigsNewsRawGig {
  date: string; // ISO date
  artist: string;
  venue: string;
  venueCanonical: string;
  time: string;
  timeDefaulted: boolean;
}

export interface GigsNewsParkedGig {
  date: string;
  rawLine: string;
  reason: string;
}

export interface GigsNewsParseResult {
  gigs: GigsNewsRawGig[];
  parked: GigsNewsParkedGig[];
}

export interface DayHeaderResult {
  dayOfWeek: string;
  dayOfMonth: number;
  month: string;
}

export interface GigRowResult {
  artist: string | null;
  venue: string | null;
  venueCanonical: string | null;
  time: string | null;
  skipReason?: string;
  venueOnly?: boolean;
}

/**
 * Parse a day header like "Friday 13th June"
 */
export function parseDayHeader(line: string): DayHeaderResult | null {
  // Pattern: DayOfWeek DDth Month
  const match = line.match(
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})(st|nd|rd|th)\s+(\w+)$/i
  );
  if (!match || !match[1] || !match[2] || !match[4]) return null;

  return {
    dayOfWeek: match[1],
    dayOfMonth: parseInt(match[2], 10),
    month: match[4],
  };
}

/**
 * Convert a day header to ISO date given the year.
 */
function dayHeaderToIsoDate(header: DayHeaderResult, year: number): string {
  const monthNum = MONTHS[header.month.toLowerCase()];
  if (!monthNum) return '';

  const day = header.dayOfMonth.toString().padStart(2, '0');
  return `${year}-${monthNum}-${day}`;
}

/**
 * Parse time string to HH:MM format.
 * Handles: "8pm", "9:30pm", "21:00", "4pm", etc.
 */
function parseTime(timeStr: string): string {
  const clean = timeStr.trim().toLowerCase();

  // Try 12-hour format: "8pm", "9:30pm"
  const match12 = clean.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)$/);
  if (match12 && match12[1] && match12[3]) {
    let hour = parseInt(match12[1], 10);
    const min = match12[2] || '00';
    const period = match12[3];

    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;

    return `${hour.toString().padStart(2, '0')}:${min}`;
  }

  // Try 24-hour format: "21:00"
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24 && match24[1] && match24[2]) {
    const hour = match24[1].padStart(2, '0');
    return `${hour}:${match24[2]}`;
  }

  return '';
}

/**
 * Normalise venue name using aliases from handoff doc.
 */
function normaliseVenue(venue: string): string {
  const lower = venue.toLowerCase().trim();

  // Check exact aliases first
  if (VENUE_ALIASES[lower]) {
    return VENUE_ALIASES[lower];
  }

  // Check partial matches for High Lane venues
  if (lower.includes("bull's head") || lower.includes('bulls head')) {
    if (lower.includes('high lane')) {
      return "The Bull's Head";
    }
  }

  return venue;
}

/**
 * Check if venue is flagged for geocode risk.
 */
function isFlaggedVenue(venue: string): boolean {
  const lower = venue.toLowerCase().trim();
  return FLAGGED_VENUES.some((flagged) => lower.includes(flagged));
}

/**
 * Parse dash format: "Artist - Venue" or "Artist time - Venue"
 * Time may appear after artist name, e.g. "Roy Pimmy  4:30pm - White Hart Woodley"
 */
function parseGigRowDashFormat(line: string, dashIndex: number): GigRowResult {
  const artistPart = line.slice(0, dashIndex).trim();
  const venue = line.slice(dashIndex + 3).trim(); // Skip " - "

  // Check if line starts with venue marker (empty artist)
  if (!artistPart) {
    return {
      artist: null,
      venue,
      venueCanonical: normaliseVenue(venue),
      time: null,
      venueOnly: true,
    };
  }

  // Extract time from artist part if present (e.g. "Roy Pimmy  4:30pm")
  const timeMatch = artistPart.match(/\s+(\d{1,2}:?\d{0,2}\s*(?:am|pm))\s*$/i);
  let artist: string;
  let time: string | null = null;

  if (timeMatch && timeMatch[1]) {
    artist = artistPart.slice(0, artistPart.length - timeMatch[0].length).trim();
    // gigs-news writes "<artist> from 5pm" — once the time is stripped the connector word is
    // left dangling on the artist ("Chris G from"). Drop a trailing "from".
    artist = artist.replace(/\s+from$/i, '').trim();
    time = parseTime(timeMatch[1]);
  } else {
    artist = artistPart;
  }

  // Check artist against skip patterns
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(artist)) {
      return {
        artist: null,
        venue,
        venueCanonical: normaliseVenue(venue),
        time,
        skipReason: 'placeholder_performer',
      };
    }
  }

  for (const pattern of JAM_PATTERNS) {
    if (pattern.test(artist)) {
      return {
        artist: null,
        venue,
        venueCanonical: normaliseVenue(venue),
        time,
        skipReason: 'jam_night',
      };
    }
  }

  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(artist)) {
      return {
        artist: null,
        venue,
        venueCanonical: normaliseVenue(venue),
        time,
        skipReason: 'generic_recurring',
      };
    }
  }

  for (const pattern of DJ_PATTERNS) {
    if (pattern.test(artist)) {
      return {
        artist: null,
        venue,
        venueCanonical: normaliseVenue(venue),
        time,
        skipReason: 'generic_dj',
      };
    }
  }

  // Check for placeholder venue
  if (/looking for a venue/i.test(venue)) {
    return {
      artist,
      venue,
      venueCanonical: venue,
      time,
      skipReason: 'placeholder_venue',
    };
  }

  // Check for flagged venue (geocode risk)
  if (isFlaggedVenue(venue)) {
    return {
      artist,
      venue,
      venueCanonical: normaliseVenue(venue),
      time,
      skipReason: 'venue_geocode_risk',
    };
  }

  return {
    artist,
    venue,
    venueCanonical: normaliseVenue(venue),
    time,
  };
}

/**
 * Parse a single gig row. Supports two formats:
 * - Dash format: "Artist - Venue" or "Artist time - Venue"
 * - At format: "Artist at Venue, time"
 */
export function parseGigRow(line: string): GigRowResult {
  const trimmed = line.trim();

  // Check for footer/contact lines - return null to skip entirely
  for (const pattern of FOOTER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { artist: null, venue: null, venueCanonical: null, time: null };
    }
  }

  // Try dash format first (more common in gigs-news): "Artist - Venue" or "Artist time - Venue"
  // Also handle "- Venue" (venue-only, starts with dash after trim)
  const dashIndex = trimmed.indexOf(' - ');
  if (dashIndex > 0) {
    return parseGigRowDashFormat(trimmed, dashIndex);
  }

  // Handle venue-only lines that start with "- " after trim
  if (trimmed.startsWith('- ')) {
    const venue = trimmed.slice(2).trim();
    return {
      artist: null,
      venue,
      venueCanonical: normaliseVenue(venue),
      time: null,
      venueOnly: true,
    };
  }

  // Try " at " format: "Artist at Venue, time"
  const atIndex = trimmed.toLowerCase().indexOf(' at ');

  if (atIndex === -1) {
    // No " at " or dash - might be venue-only row like "The Royal Oak, 8pm"
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex > 0) {
      const possibleVenue = trimmed.slice(0, commaIndex).trim();
      const possibleTime = trimmed.slice(commaIndex + 1).trim();
      const time = parseTime(possibleTime);

      return {
        artist: null,
        venue: possibleVenue,
        venueCanonical: normaliseVenue(possibleVenue),
        time: time || null,
        venueOnly: true,
      };
    }
    return { artist: null, venue: null, venueCanonical: null, time: null };
  }

  const artist = trimmed.slice(0, atIndex).trim();
  const venueAndTime = trimmed.slice(atIndex + 4).trim();

  // Check artist against skip patterns
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(artist)) {
      return {
        artist: null,
        venue: venueAndTime,
        venueCanonical: normaliseVenue(venueAndTime),
        time: null,
        skipReason: 'placeholder_performer',
      };
    }
  }

  for (const pattern of JAM_PATTERNS) {
    if (pattern.test(artist)) {
      return {
        artist: null,
        venue: venueAndTime,
        venueCanonical: normaliseVenue(venueAndTime),
        time: null,
        skipReason: 'jam_night',
      };
    }
  }

  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(artist)) {
      return {
        artist: null,
        venue: venueAndTime,
        venueCanonical: normaliseVenue(venueAndTime),
        time: null,
        skipReason: 'generic_recurring',
      };
    }
  }

  for (const pattern of DJ_PATTERNS) {
    if (pattern.test(artist)) {
      return {
        artist: null,
        venue: venueAndTime,
        venueCanonical: normaliseVenue(venueAndTime),
        time: null,
        skipReason: 'generic_dj',
      };
    }
  }

  // Parse venue and time - split on comma
  const commaIndex = venueAndTime.lastIndexOf(',');
  let venue: string;
  let time: string | null = null;

  if (commaIndex > 0) {
    venue = venueAndTime.slice(0, commaIndex).trim();
    const timeStr = venueAndTime.slice(commaIndex + 1).trim();
    time = parseTime(timeStr) || null;
  } else {
    venue = venueAndTime;
  }

  // Check for placeholder venue
  if (/looking for a venue/i.test(venue)) {
    return {
      artist,
      venue,
      venueCanonical: venue,
      time,
      skipReason: 'placeholder_venue',
    };
  }

  // Check for flagged venue (geocode risk)
  if (isFlaggedVenue(venue)) {
    return {
      artist,
      venue,
      venueCanonical: normaliseVenue(venue),
      time,
      skipReason: 'venue_geocode_risk',
    };
  }

  return {
    artist,
    venue,
    venueCanonical: normaliseVenue(venue),
    time,
  };
}

/**
 * Parse the full gigs-news page into gigs.
 * @param html The raw HTML content
 * @param year The year to use for dates (page doesn't include year)
 */
export function parseGigsNewsPage(
  html: string,
  year: number
): GigsNewsParseResult {
  // Strip HTML tags and get text lines
  const text = html.replace(/<[^>]+>/g, '\n');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const gigs: GigsNewsRawGig[] = [];
  const parked: GigsNewsParkedGig[] = [];

  let currentDate: string | null = null;

  for (const line of lines) {
    // Check if it's a day header
    const dayHeader = parseDayHeader(line);
    if (dayHeader) {
      currentDate = dayHeaderToIsoDate(dayHeader, year);
      continue;
    }

    // Skip if no current date set
    if (!currentDate) continue;

    // Check for footer/contact lines
    let isFooter = false;
    for (const pattern of FOOTER_PATTERNS) {
      if (pattern.test(line)) {
        isFooter = true;
        break;
      }
    }
    if (isFooter) continue;

    // Try to parse as gig row
    const parsed = parseGigRow(line);

    // Skip empty results (non-gig lines)
    if (!parsed.venue && !parsed.artist) continue;

    // Handle venue-only rows
    if (parsed.venueOnly) {
      parked.push({
        date: currentDate,
        rawLine: line,
        reason: 'venue_only',
      });
      continue;
    }

    // Handle skip reasons
    if (parsed.skipReason) {
      parked.push({
        date: currentDate,
        rawLine: line,
        reason: parsed.skipReason,
      });
      continue;
    }

    // "gigs 2026" footer / booking rows: artist is a date, or a bare time, or the venue is a branded/reserved placeholder
    if (parsed.artist && DATE_AS_ARTIST_PATTERN.test(parsed.artist)) {
      parked.push({ date: currentDate, rawLine: line, reason: 'footer_date_row' });
      continue;
    }
    if (parsed.artist && TIME_AS_ARTIST_PATTERN.test(parsed.artist)) {
      parked.push({ date: currentDate, rawLine: line, reason: 'time_not_artist' });
      continue;
    }
    if (parsed.venue && PLACEHOLDER_VENUE_SUFFIX.test(parsed.venue)) {
      parked.push({ date: currentDate, rawLine: line, reason: 'placeholder_venue_booking' });
      continue;
    }

    // Valid gig
    if (parsed.artist && parsed.venue && parsed.venueCanonical) {
      const time = parsed.time || '20:00';
      const timeDefaulted = !parsed.time;

      gigs.push({
        date: currentDate,
        artist: parsed.artist,
        venue: parsed.venue,
        venueCanonical: parsed.venueCanonical,
        time,
        timeDefaulted,
      });
    }
  }

  return { gigs, parked };
}
