/**
 * KLMA Source Fetch
 *
 * Fetches KLMA data from Google Sheets with preferred/fallback URL support.
 * - Preferred: /export?format=csv (direct download)
 * - Fallback: /gviz/tq?tqx=out:csv (query API, needs column realignment)
 */

import { SourceConfig, SourceRun } from '../../types';
import { FetchedSource } from '../../runner';

interface GoogleSheetInput {
  kind: 'google_sheet_csv';
  sheetId: string;
  gid: string;
  preferredExport: string;
  fallbackExport: string;
  gvizRealignment?: GvizRealignment;
}

export interface GvizRealignment {
  dropLeadingColumn: boolean;
  keepColumns: number;
}

/**
 * Build the preferred export URL (direct CSV download)
 */
export function buildExportUrl(input: GoogleSheetInput): string {
  return `https://docs.google.com/spreadsheets/d/${input.sheetId}/export?format=csv&gid=${input.gid}`;
}

/**
 * Build the gviz fallback URL (query API CSV output)
 */
export function buildGvizUrl(input: GoogleSheetInput): string {
  return `https://docs.google.com/spreadsheets/d/${input.sheetId}/gviz/tq?tqx=out:csv&gid=${input.gid}`;
}

/**
 * Parse a CSV row respecting quoted fields
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
        // Escaped quote
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
 * Convert fields back to CSV row with proper quoting
 */
function fieldsToCsvRow(fields: string[]): string {
  return fields
    .map((field) => {
      // If field contains comma, quote, or newline, wrap in quotes
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      // If field is empty or already quoted, preserve it
      if (field === '' || (field.startsWith('"') && field.endsWith('"'))) {
        return `"${field}"`;
      }
      return `"${field}"`;
    })
    .join(',');
}

/**
 * Realign gviz CSV data by dropping the leading column and keeping only
 * the specified number of columns.
 *
 * gviz returns 13 columns; we drop the first (Google serial) and keep 6.
 */
export function realignGvizCsv(csvData: string, realignment: GvizRealignment): string {
  const lines = csvData.split('\n');

  return lines
    .map((line) => {
      if (!line.trim()) {
        return line;
      }

      const fields = parseCsvRow(line);

      // Drop leading column if configured
      const startIndex = realignment.dropLeadingColumn ? 1 : 0;

      // Keep only the specified number of columns
      const keptFields = fields.slice(startIndex, startIndex + realignment.keepColumns);

      return fieldsToCsvRow(keptFields);
    })
    .join('\n');
}

/**
 * Check if CSV data needs realignment (has leading empty column).
 * This happens when the sheet has a serial/timestamp column that should be dropped.
 */
function needsRealignment(csvData: string): boolean {
  const firstLine = csvData.split('\n')[0];
  if (!firstLine) return false;
  // If first line starts with comma or first field is empty, needs realignment
  return firstLine.startsWith(',') || firstLine.startsWith('"",');
}

/**
 * Fetch KLMA source data from Google Sheets
 * Tries preferred URL first, falls back to gviz if that fails.
 * Applies realignment if data has leading empty column (from either source).
 */
export async function fetchKlmaSource(
  config: SourceConfig,
  run: SourceRun
): Promise<FetchedSource> {
  const input = config.input as GoogleSheetInput;

  // Try preferred URL first
  const preferredUrl = buildExportUrl(input);

  try {
    const preferredResponse = await fetch(preferredUrl);

    if (preferredResponse.ok) {
      const originalBody = await preferredResponse.text();

      // Check if preferred export needs realignment (sheet may have extra columns)
      let body = originalBody;
      if (input.gvizRealignment && needsRealignment(originalBody)) {
        body = realignGvizCsv(originalBody, input.gvizRealignment);
      }

      return {
        kind: 'csv',
        body,
        originalBody: originalBody !== body ? originalBody : undefined,
        fetchMethod: 'export_csv',
      };
    }
  } catch (error) {
    // Network error on preferred URL - will try fallback
    // But if it's a real network error, we should throw
    throw error;
  }

  // Preferred failed, try gviz fallback
  const gvizUrl = buildGvizUrl(input);
  const gvizResponse = await fetch(gvizUrl);

  if (!gvizResponse.ok) {
    throw new Error(`Failed to fetch KLMA source: both preferred and gviz URLs failed`);
  }

  const originalBody = await gvizResponse.text();

  // Realign gviz data if configured
  let body = originalBody;
  if (input.gvizRealignment) {
    body = realignGvizCsv(originalBody, input.gvizRealignment);
  }

  return {
    kind: 'csv',
    body,
    originalBody,
    fetchMethod: 'gviz_csv',
  };
}
