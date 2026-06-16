/**
 * slugNormalise Tests
 *
 * ADR-013: Slug-strength normalisation is THE lookup key.
 */

import { describe, it, expect } from 'vitest';
import { slugNormalise } from './slugNormalise';

describe('slugNormalise', () => {
  describe('basic normalisation', () => {
    it('should lowercase', () => {
      expect(slugNormalise('The Swan')).toBe('the-swan');
    });

    it('should replace spaces with dashes', () => {
      expect(slugNormalise('The Swan Stone')).toBe('the-swan-stone');
    });

    it('should trim whitespace', () => {
      expect(slugNormalise('  The Swan  ')).toBe('the-swan');
    });
  });

  describe('apostrophe handling', () => {
    it('should strip straight apostrophes', () => {
      expect(slugNormalise("The Nag's Head")).toBe('the-nags-head');
    });

    it('should strip curly apostrophes', () => {
      expect(slugNormalise('The Nag\u2019s Head')).toBe('the-nags-head');
    });

    it('should make apostrophe variants equivalent', () => {
      const straight = slugNormalise("Swifty's");
      const curly = slugNormalise('Swifty\u2019s');
      const none = slugNormalise('Swiftys');

      expect(straight).toBe(none);
      expect(curly).toBe(none);
    });
  });

  describe('postcode stripping', () => {
    it('should strip UK postcodes', () => {
      expect(slugNormalise('The Rigger ST5 1BT')).toBe('the-rigger');
    });

    it('should strip postcodes with spaces', () => {
      expect(slugNormalise('Eleven Sandyford St6 5pd')).toBe('eleven-sandyford');
    });
  });

  describe('punctuation handling', () => {
    it('should replace commas with dashes', () => {
      expect(slugNormalise('The Swan, Stone')).toBe('the-swan-stone');
    });

    it('should collapse multiple non-alphanumeric chars', () => {
      expect(slugNormalise('The Swan,,, Stone')).toBe('the-swan-stone');
    });

    it('should trim leading/trailing dashes', () => {
      expect(slugNormalise('-The Swan-')).toBe('the-swan');
    });
  });

  describe('ADR-013 format variant collapse', () => {
    it('should normalise spacing consistently', () => {
      // Spaces become dashes
      expect(slugNormalise('Circa 81')).toBe('circa-81');
      expect(slugNormalise('Circa81')).toBe('circa81');
    });

    it('should make comma variants equivalent to space variants', () => {
      // Both comma and space become single dash
      expect(slugNormalise('The Swan, Stone')).toBe(slugNormalise('The Swan Stone'));
    });
  });
});
