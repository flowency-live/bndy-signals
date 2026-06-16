/**
 * KLMA CSV Parser
 *
 * Parses KLMA CSV data into structured rows.
 * Handles quoted fields, escaped quotes, and identifies metadata/sentinel rows.
 */

import { isFormMetadataRow, isDateSentinel, parseDate } from './rules';

export interface KlmaRawRow {
  rowIndex: number;
  date: string;
  artist: string;
  venue: string;
  time: string;
  genre: string;
  url: string;
}

export interface ParsedKlmaData {
  rawRowCount: number;
  eventRows: KlmaRawRow[];
  metadataRows: KlmaRawRow[];
  sentinelRows: KlmaRawRow[];
  unparseableDateRows: KlmaRawRow[];
}

/**
 * Parse a single CSV row respecting quoted fields
 * Returns array of field values
 */
function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];

    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        // Escaped quote ("")
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // Don't forget the last field
  fields.push(current);

  return fields;
}

/**
 * Parse CSV data into raw row objects.
 * Skips the header row and returns data rows.
 */
export function parseCsv(csvData: string): Omit<KlmaRawRow, 'rowIndex'>[] {
  const lines = csvData.split('\n');
  const rows: Omit<KlmaRawRow, 'rowIndex'>[] = [];

  // Skip header row (index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Skip empty lines
    if (!line.trim()) {
      continue;
    }

    const fields = parseCsvRow(line);

    // Map fields to named properties
    // KLMA format: date, artist, venue, time, genre, url
    rows.push({
      date: fields[0] || '',
      artist: fields[1] || '',
      venue: fields[2] || '',
      time: fields[3] || '',
      genre: fields[4] || '',
      url: fields[5] || '',
    });
  }

  return rows;
}

/**
 * Parse KLMA CSV data and categorise rows.
 * - eventRows: Valid event data
 * - metadataRows: Form metadata/header rows
 * - sentinelRows: Rows with 1899 sentinel date
 */
export function parseKlmaRows(csvData: string): ParsedKlmaData {
  const lines = csvData.split('\n');
  const eventRows: KlmaRawRow[] = [];
  const metadataRows: KlmaRawRow[] = [];
  const sentinelRows: KlmaRawRow[] = [];
  const unparseableDateRows: KlmaRawRow[] = [];

  let rawRowCount = 0;

  // Skip header row (index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Skip empty lines
    if (!line.trim()) {
      continue;
    }

    rawRowCount++;

    const fields = parseCsvRow(line);

    const row: KlmaRawRow = {
      rowIndex: i, // 1-based index (after header)
      date: fields[0] || '',
      artist: fields[1] || '',
      venue: fields[2] || '',
      time: fields[3] || '',
      genre: fields[4] || '',
      url: fields[5] || '',
    };

    // Check for sentinel date (1899)
    if (isDateSentinel(row.date)) {
      sentinelRows.push(row);
      continue;
    }

    // Check for form metadata rows
    if (isFormMetadataRow(row)) {
      metadataRows.push(row);
      continue;
    }

    // Check if date is parseable - if not, it's an unparseable date row
    // This catches rows with empty dates or invalid date formats
    if (parseDate(row.date) === null) {
      unparseableDateRows.push(row);
      continue;
    }

    // Valid event row
    eventRows.push(row);
  }

  return {
    rawRowCount,
    eventRows,
    metadataRows,
    sentinelRows,
    unparseableDateRows,
  };
}
