/**
 * KLMA Aliases Tests
 *
 * Tests for venue canonicalisation and alias lookup.
 * Based on aliases.json from handoff pack.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicaliseVenue,
  lookupVenueCanonical,
  isSpecialistVenue,
  isMultiActVenue,
  detectRegion,
  generateVenueSlug,
} from './aliases';

describe('KLMA Aliases', () => {
  describe('canonicaliseVenue', () => {
    it('should trim whitespace', () => {
      expect(canonicaliseVenue('  The Swan Stone  ')).toBe('The Swan Stone');
      expect(canonicaliseVenue('The Swan Stone\t')).toBe('The Swan Stone');
    });

    it('should normalise curly apostrophe to straight', () => {
      expect(canonicaliseVenue("The Nag's Head")).toBe("The Nag's Head");
    });

    it('should strip embedded UK postcodes', () => {
      expect(canonicaliseVenue('The Rigger Venue, Newcastle-Under-Lyme St5 1bt')).toBe(
        'The Rigger Venue, Newcastle-Under-Lyme'
      );
      expect(canonicaliseVenue('Cosey Club Haslington Cw1 5st')).toBe(
        'Cosey Club Haslington'
      );
      expect(canonicaliseVenue('Eleven Sandyford St6 5pd')).toBe('Eleven Sandyford');
    });

    it('should normalise town suffixes', () => {
      // " in <Town>" -> ", <Town>"
      expect(canonicaliseVenue('The Nags Head in Macclesfield')).toBe(
        'The Nags Head, Macclesfield'
      );
      // Already has comma - should be preserved
      expect(canonicaliseVenue('The Swan, Stone')).toBe('The Swan, Stone');
    });

    it('should handle multiple transformations', () => {
      expect(
        canonicaliseVenue('  The Rigger Venue, Newcastle-Under-Lyme St5 1bt  ')
      ).toBe('The Rigger Venue, Newcastle-Under-Lyme');
    });
  });

  describe('lookupVenueCanonical', () => {
    it('should return canonical for known variant', () => {
      expect(lookupVenueCanonical('The Nags Head Macclesfield')).toBe(
        'The Nags Head, Macclesfield'
      );
      expect(lookupVenueCanonical("The Nag's Head in Macclesfield")).toBe(
        'The Nags Head, Macclesfield'
      );
    });

    it('should return canonical for The Cosey variants', () => {
      expect(lookupVenueCanonical('The Cosey Haslington')).toBe(
        'The Cosey, Haslington'
      );
      expect(lookupVenueCanonical('The Cosey Club Near Crewe')).toBe(
        'The Cosey, Haslington'
      );
    });

    it('should return canonical for The Rigger variants', () => {
      expect(lookupVenueCanonical('The Rigger')).toBe(
        'The Rigger, Newcastle-under-Lyme'
      );
      expect(
        lookupVenueCanonical('The Rigger Venue, Newcastle-Under-Lyme St5 1bt')
      ).toBe('The Rigger, Newcastle-under-Lyme');
    });

    it('should return canonical for Artisan Tap variants', () => {
      expect(lookupVenueCanonical('Artisan Tap')).toBe('Artisan Tap, Hartshill');
      expect(lookupVenueCanonical('The Artisan Tap')).toBe('Artisan Tap, Hartshill');
    });

    it('should return null for unknown venue', () => {
      expect(lookupVenueCanonical('Some Unknown Venue')).toBe(null);
    });

    it('should be case-insensitive', () => {
      expect(lookupVenueCanonical('THE NAGS HEAD MACCLESFIELD')).toBe(
        'The Nags Head, Macclesfield'
      );
    });

    it('should match apostrophe variants algorithmically (ADR-013)', () => {
      // Swiftys with apostrophe should match Swiftys without
      // This works via slug-strength key (apostrophe stripping), not hand-coded variants
      expect(lookupVenueCanonical("Swifty's, Meir")).toBe('Swiftys, Meir');
      expect(lookupVenueCanonical("Swifty's")).toBe('Swiftys, Meir');
      // Nag's Head: apostrophe variant matches non-apostrophe variant
      expect(lookupVenueCanonical("The Nag's Head Macclesfield")).toBe(
        'The Nags Head, Macclesfield'
      );
    });
  });

  describe('generateVenueSlug', () => {
    it('should generate slug from venue name', () => {
      expect(generateVenueSlug('The Rigger, Newcastle-under-Lyme')).toBe(
        'the-rigger-newcastle-under-lyme'
      );
      expect(generateVenueSlug('Artisan Tap, Hartshill')).toBe(
        'artisan-tap-hartshill'
      );
    });

    it('should handle special characters', () => {
      expect(generateVenueSlug("The Nag's Head, Macclesfield")).toBe(
        'the-nags-head-macclesfield'
      );
    });

    it('should strip postcodes before slugging', () => {
      expect(generateVenueSlug('Eleven Sandyford St6 5pd')).toBe(
        'eleven-sandyford'
      );
    });
  });

  describe('isSpecialistVenue', () => {
    it('should identify specialist venues', () => {
      expect(isSpecialistVenue('artisan-tap')).toBe(true);
      expect(isSpecialistVenue('artisan-tap-hartshill')).toBe(true);
      expect(isSpecialistVenue('eleven')).toBe(true);
      expect(isSpecialistVenue('eleven-sandyford')).toBe(true);
    });

    it('should return false for non-specialist venues', () => {
      expect(isSpecialistVenue('the-rigger')).toBe(false);
      expect(isSpecialistVenue('the-swan-stone')).toBe(false);
    });
  });

  describe('isMultiActVenue', () => {
    it('should identify multi-act venues by full slug', () => {
      expect(isMultiActVenue('the-rigger-newcastle-under-lyme')).toBe(true);
    });

    it('should identify multi-act venues by prefix token', () => {
      // A Rigger variant not in the alias table would generate slug "the-rigger"
      // This should still be caught as multi-act
      expect(isMultiActVenue('the-rigger')).toBe(true);
      expect(isMultiActVenue('the-rigger-venue')).toBe(true);
    });

    it('should return false for non-multi-act venues', () => {
      expect(isMultiActVenue('artisan-tap')).toBe(false);
      expect(isMultiActVenue('the-swan-stone')).toBe(false);
    });
  });

  describe('detectRegion', () => {
    it('should detect Cheshire from town names', () => {
      expect(detectRegion('The Express, Crewe')).toEqual({
        region: 'Cheshire',
        city: 'Crewe',
      });
      expect(detectRegion('The Shamrock, Macclesfield')).toEqual({
        region: 'Cheshire',
        city: 'Macclesfield',
      });
      expect(detectRegion('The Cosey, Haslington')).toEqual({
        region: 'Cheshire',
        city: 'Haslington',
      });
    });

    it('should include Audlem as Cheshire', () => {
      expect(detectRegion('The Shroppie Fly, Audlem')).toEqual({
        region: 'Cheshire',
        city: 'Audlem',
      });
    });

    it('should extract Staffordshire towns from trailing comma segment', () => {
      expect(detectRegion('The Swan, Stone')).toEqual({
        region: 'Staffordshire',
        city: 'Stone',
      });
      expect(detectRegion('The Red Lion, Leek')).toEqual({
        region: 'Staffordshire',
        city: 'Leek',
      });
      expect(detectRegion('The Rigger, Newcastle-under-Lyme')).toEqual({
        region: 'Staffordshire',
        city: 'Newcastle-under-Lyme',
      });
      expect(detectRegion('The Globe, Biddulph')).toEqual({
        region: 'Staffordshire',
        city: 'Biddulph',
      });
      expect(detectRegion('The Bear Inn, Stafford')).toEqual({
        region: 'Staffordshire',
        city: 'Stafford',
      });
    });

    it('should handle embedded town references', () => {
      // Town embedded in name without comma
      expect(detectRegion('The Red Lion Leek')).toEqual({
        region: 'Staffordshire',
        city: 'Leek',
      });
    });

    it('should leave city unknown when town cannot be derived', () => {
      expect(detectRegion('The Random Pub')).toEqual({
        region: 'Staffordshire',
        city: '',
      });
    });

    it('should be case-insensitive for town matching', () => {
      expect(detectRegion('The Express, CREWE')).toEqual({
        region: 'Cheshire',
        city: 'Crewe',
      });
    });
  });
});
