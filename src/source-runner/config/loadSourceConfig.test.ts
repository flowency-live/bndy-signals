import { describe, it, expect } from 'vitest';
import { loadSourceConfig, SourceConfigNotFoundError } from './loadSourceConfig';
import { SourceConfig, SourceConfigSchema } from '../types';

describe('loadSourceConfig', () => {
  describe('KLMA Stoke config', () => {
    it('should load klma-stoke-gig-list config', async () => {
      const config = await loadSourceConfig('klma-stoke-gig-list');

      expect(config.id).toBe('klma-stoke-gig-list');
      expect(config.name).toBe('KLMA Stoke Gig List');
      expect(config.type).toBe('community_sheet');
    });

    it('should have correct source input configuration', async () => {
      const config = await loadSourceConfig('klma-stoke-gig-list');

      expect(config.input.kind).toBe('google_sheet_csv');
      expect(config.input.sheetId).toBe('1atEqyN-RI1smTzSaCtMUSui7oNp2dhCpiGoAfY5ySno');
      expect(config.input.gid).toBe('831966245');
      expect(config.input.preferredExport).toBe('export_csv');
      expect(config.input.fallbackExport).toBe('gviz_csv');
    });

    it('should have gviz realignment configuration', async () => {
      const config = await loadSourceConfig('klma-stoke-gig-list');

      expect(config.input.gvizRealignment).toBeDefined();
      expect(config.input.gvizRealignment?.dropLeadingColumn).toBe(true);
      expect(config.input.gvizRealignment?.keepColumns).toBe(6);
    });

    it('should have correct event policy', async () => {
      const config = await loadSourceConfig('klma-stoke-gig-list');

      expect(config.eventPolicy.createPublicEvents).toBe(true);
      expect(config.eventPolicy.missingTimeDefault).toBe('21:00');
      expect(config.eventPolicy.deleteFutureMissingRows).toBe(true);
      expect(config.eventPolicy.neverDeletePastEvents).toBe(true);
    });

    it('should have specialist and multi-act venue slugs', async () => {
      const config = await loadSourceConfig('klma-stoke-gig-list');

      expect(config.parkingLot.specialistVenueSlugs).toContain('artisan-tap');
      expect(config.parkingLot.specialistVenueSlugs).toContain('eleven');
      expect(config.parkingLot.multiActVenueSlugs).toContain('the-rigger-newcastle-under-lyme');
    });

    it('should have region override configuration for Cheshire', async () => {
      const config = await loadSourceConfig('klma-stoke-gig-list');

      expect(config.regionOverride).toBeDefined();
      expect(config.regionOverride?.defaultRegion).toBe('Staffordshire');
      expect(config.regionOverride?.defaultCity).toBe('Stoke-on-Trent');
      expect(config.regionOverride?.overrideTowns).toHaveProperty('Crewe', 'Cheshire');
      expect(config.regionOverride?.overrideTowns).toHaveProperty('Macclesfield', 'Cheshire');
      expect(config.regionOverride?.overrideTowns).toHaveProperty('Haslington', 'Cheshire');
    });

    it('should have correct timezone', async () => {
      const config = await loadSourceConfig('klma-stoke-gig-list');

      expect(config.timezone).toBe('Europe/London');
    });

    it('should pass Zod schema validation', async () => {
      const config = await loadSourceConfig('klma-stoke-gig-list');

      const result = SourceConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw SourceConfigNotFoundError for unknown sourceId', async () => {
      await expect(loadSourceConfig('unknown-source')).rejects.toThrow(
        SourceConfigNotFoundError
      );
    });

    it('should include sourceId in error message', async () => {
      await expect(loadSourceConfig('unknown-source')).rejects.toThrow(
        'Source config not found: unknown-source'
      );
    });
  });
});
