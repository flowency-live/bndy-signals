import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCliArgs, CliCommand } from './cli';

describe('CLI argument parsing', () => {
  describe('parseCliArgs', () => {
    it('should parse source:run command with sourceId (dry-run by default)', () => {
      const result = parseCliArgs(['source:run', 'klma-stoke-gig-list']);

      expect(result.command).toBe('run');
      expect(result.sourceId).toBe('klma-stoke-gig-list');
      // CRITICAL: dryRun defaults to true; writes require explicit --write
      expect(result.options.dryRun).toBe(true);
      expect(result.options.write).toBe(false);
    });

    it('should enable writes only with explicit --write flag', () => {
      const result = parseCliArgs(['source:run', 'klma-stoke-gig-list', '--write']);

      expect(result.command).toBe('run');
      expect(result.options.dryRun).toBe(false);
      expect(result.options.write).toBe(true);
    });

    it('should parse source:dry-run command', () => {
      const result = parseCliArgs(['source:dry-run', 'klma-stoke-gig-list']);

      expect(result.command).toBe('dry-run');
      expect(result.sourceId).toBe('klma-stoke-gig-list');
      expect(result.options.dryRun).toBe(true);
    });

    it('should parse --date option', () => {
      const result = parseCliArgs([
        'source:run',
        'klma-stoke-gig-list',
        '--date',
        '2026-06-14',
      ]);

      expect(result.options.date).toBe('2026-06-14');
    });

    it('should default date to today in source timezone', () => {
      const result = parseCliArgs(['source:run', 'klma-stoke-gig-list']);

      // Should be today's date in YYYY-MM-DD format
      expect(result.options.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should parse --dry-run flag', () => {
      const result = parseCliArgs([
        'source:run',
        'klma-stoke-gig-list',
        '--dry-run',
      ]);

      expect(result.options.dryRun).toBe(true);
    });

    it('should parse --local-storage flag', () => {
      const result = parseCliArgs([
        'source:run',
        'klma-stoke-gig-list',
        '--local-storage',
      ]);

      expect(result.options.localStorage).toBe(true);
    });

    it('should parse --max-writes option', () => {
      const result = parseCliArgs([
        'source:run',
        'klma-stoke-gig-list',
        '--max-writes',
        '25',
      ]);

      expect(result.options.maxWrites).toBe(25);
    });

    it('should parse --review-only flag', () => {
      const result = parseCliArgs([
        'source:run',
        'klma-stoke-gig-list',
        '--review-only',
      ]);

      expect(result.options.reviewOnly).toBe(true);
    });

    it('should parse source:parse command', () => {
      const result = parseCliArgs(['source:parse', 'klma-stoke-gig-list']);

      expect(result.command).toBe('parse');
      expect(result.sourceId).toBe('klma-stoke-gig-list');
    });

    it('should parse source:diff command', () => {
      const result = parseCliArgs(['source:diff', 'klma-stoke-gig-list']);

      expect(result.command).toBe('diff');
      expect(result.sourceId).toBe('klma-stoke-gig-list');
    });

    it('should parse source:report command with --latest flag', () => {
      const result = parseCliArgs([
        'source:report',
        'klma-stoke-gig-list',
        '--latest',
      ]);

      expect(result.command).toBe('report');
      expect(result.sourceId).toBe('klma-stoke-gig-list');
      expect(result.options.latest).toBe(true);
    });

    it('should throw on unknown command', () => {
      expect(() => parseCliArgs(['source:unknown', 'klma-stoke-gig-list'])).toThrow(
        'Unknown command: source:unknown'
      );
    });

    it('should throw on missing sourceId', () => {
      expect(() => parseCliArgs(['source:run'])).toThrow(
        'sourceId is required'
      );
    });

    it('should validate date format', () => {
      expect(() =>
        parseCliArgs([
          'source:run',
          'klma-stoke-gig-list',
          '--date',
          'invalid-date',
        ])
      ).toThrow('Invalid date format');
    });

    it('should validate max-writes is positive', () => {
      expect(() =>
        parseCliArgs([
          'source:run',
          'klma-stoke-gig-list',
          '--max-writes',
          '-5',
        ])
      ).toThrow('max-writes must be positive');
    });
  });
});

describe('CliCommand type', () => {
  it('should have correct structure', () => {
    const command: CliCommand = {
      command: 'run',
      sourceId: 'klma-stoke-gig-list',
      options: {
        date: '2026-06-14',
        dryRun: false,
        localStorage: false,
        reviewOnly: false,
      },
    };

    expect(command.command).toBe('run');
    expect(command.sourceId).toBe('klma-stoke-gig-list');
  });
});
