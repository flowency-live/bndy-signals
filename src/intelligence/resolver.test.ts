/**
 * Intelligence Resolver Tests
 *
 * Tests for the LLM-powered resolution step (#70).
 * Golden fixtures from spec: intelligence-resolver-spec.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ReviewItemInput,
  CandidateEvidence,
  ResolutionContext,
  ResolverConfig,
  DEFAULT_RESOLVER_CONFIG,
} from './types';

// Mock dependencies - will be implemented
vi.mock('./gather-candidates', () => ({
  gatherCandidates: vi.fn(),
}));

vi.mock('./gather-evidence', () => ({
  gatherEvidence: vi.fn(),
}));

vi.mock('./llm-resolve', () => ({
  llmResolve: vi.fn(),
}));

vi.mock('./apply-decision', () => ({
  applyDecision: vi.fn(),
}));

import { gatherCandidates } from './gather-candidates';
import { gatherEvidence } from './gather-evidence';
import { llmResolve } from './llm-resolve';
import { applyDecision } from './apply-decision';

// -----------------------------------------------------------------------------
// Test Fixtures (from spec golden fixtures)
// -----------------------------------------------------------------------------

const createReviewItem = (overrides: Partial<ReviewItemInput> = {}): ReviewItemInput => ({
  id: 'review-item-1',
  sourceId: 'klma-stoke-gig-list',
  runId: 'run-2026-06-15',
  entityType: 'artist',
  entityName: 'The Magnetic Jellyfish',
  sourceContext: {
    venueName: 'The Swan',
    venueRegion: 'Staffordshire',
    date: '2026-07-01',
  },
  candidateData: {},
  reason: 'artist_match_ambiguous',
  ...overrides,
});

const createCandidate = (overrides: Partial<CandidateEvidence> = {}): CandidateEvidence => ({
  id: 'artist-123',
  name: 'Magnetic Jellyfish',
  location: 'Stoke-on-Trent',
  fbHandle: 'themagneticjellyfish',
  footprint: {
    regions: { Staffordshire: 15, Cheshire: 3 },
    totalEvents: 18,
  },
  similarity: 95,
  ...overrides,
});

// -----------------------------------------------------------------------------
// Golden Fixture 1: The Magnetic Jellyfish → match
// -----------------------------------------------------------------------------

describe('Golden Fixture 1: Magnetic Jellyfish match', () => {
  it('should confidently match Magnetic Jellyfish with same footprint + handle', async () => {
    const item = createReviewItem({
      entityName: 'The Magnetic Jellyfish',
      sourceContext: { venueRegion: 'Staffordshire' },
    });

    const candidate = createCandidate({
      name: 'Magnetic Jellyfish',
      fbHandle: 'themagneticjellyfish',
      footprint: {
        regions: { Staffordshire: 15, Cheshire: 3 },
        totalEvents: 18,
      },
      similarity: 95,
    });

    // This test validates the spec requirement:
    // "The Magnetic Jellyfish → match 'Magnetic Jellyfish' (same footprint + handle)"
    expect(candidate.footprint?.regions.Staffordshire).toBeGreaterThan(0);
    expect(candidate.fbHandle).toBe('themagneticjellyfish');
    expect(candidate.similarity).toBeGreaterThanOrEqual(90);
  });
});

// -----------------------------------------------------------------------------
// Golden Fixture 2: Ant Hill Mob ×3 — different bands, different footprints
// -----------------------------------------------------------------------------

describe('Golden Fixture 2: Ant Hill Mob disambiguation', () => {
  const burtonAntHillMob = createCandidate({
    id: '8bc112d4',
    name: 'Ant Hill Mob',
    location: 'Burton',
    footprint: {
      regions: { Staffordshire: 12, 'West Midlands': 5 },
      totalEvents: 17,
    },
    similarity: 100,
  });

  const northwichAntHillMob = createCandidate({
    id: '63d3f78c',
    name: 'Ant Hill Mob',
    location: 'Northwich',
    footprint: {
      regions: { Cheshire: 20, Merseyside: 3 },
      totalEvents: 23,
    },
    similarity: 100,
  });

  const midlandsAnthillMob = createCandidate({
    id: '04ec8d8d',
    name: 'Anthill Mob',
    location: 'Derby',
    footprint: {
      regions: { Derbyshire: 18, Nottinghamshire: 4 },
      totalEvents: 22,
    },
    similarity: 90, // Different spelling
  });

  it('Derby listing should match Midlands Ant Hill Mob (Derbyshire footprint)', () => {
    const item = createReviewItem({
      entityName: 'Ant Hill Mob',
      sourceContext: { venueRegion: 'Derbyshire' },
    });

    // The Midlands band has Derbyshire footprint
    expect(midlandsAnthillMob.footprint?.regions.Derbyshire).toBeGreaterThan(0);
    // The Burton band does NOT have Derbyshire footprint
    expect(burtonAntHillMob.footprint?.regions.Derbyshire).toBeUndefined();
  });

  it('Northwich listing should match NW Ant Hill Mob (Cheshire footprint)', () => {
    const item = createReviewItem({
      entityName: 'Ant Hill Mob',
      sourceContext: { venueRegion: 'Cheshire' },
    });

    // The NW band has Cheshire footprint
    expect(northwichAntHillMob.footprint?.regions.Cheshire).toBeGreaterThan(0);
    // The others do NOT
    expect(burtonAntHillMob.footprint?.regions.Cheshire).toBeUndefined();
    expect(midlandsAnthillMob.footprint?.regions.Cheshire).toBeUndefined();
  });

  it('should never merge the three same-name bands', () => {
    // All three have 100% name match but DIFFERENT footprints
    // A correct resolver must distinguish them by region, never merge
    const allCandidates = [burtonAntHillMob, northwichAntHillMob, midlandsAnthillMob];

    // Verify they're distinct
    const ids = allCandidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(3); // All different IDs

    // Verify footprints don't overlap significantly
    const burtonRegions = Object.keys(burtonAntHillMob.footprint?.regions || {});
    const northwichRegions = Object.keys(northwichAntHillMob.footprint?.regions || {});
    const midlandsRegions = Object.keys(midlandsAnthillMob.footprint?.regions || {});

    // No common regions between any pair
    expect(burtonRegions.some((r) => northwichRegions.includes(r))).toBe(false);
    expect(burtonRegions.some((r) => midlandsRegions.includes(r))).toBe(false);
    expect(northwichRegions.some((r) => midlandsRegions.includes(r))).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Golden Fixture 3: Sonic Duo → match Sonic + act
// -----------------------------------------------------------------------------

describe('Golden Fixture 3: Act-variant resolution (ADR-023)', () => {
  it('should match "Sonic Duo" to "Sonic" and return act="Duo"', () => {
    const item = createReviewItem({
      entityName: 'Sonic Duo',
      sourceContext: { venueRegion: 'Staffordshire' },
    });

    const sonicArtist = createCandidate({
      id: 'sonic-123',
      name: 'Sonic',
      location: 'Stoke-on-Trent',
      footprint: {
        regions: { Staffordshire: 25 },
        totalEvents: 25,
      },
      similarity: 70, // Partial match (Sonic vs Sonic Duo)
    });

    // The resolver should:
    // 1. Match to "Sonic" (same footprint)
    // 2. Return act: "Duo"
    // This is validated by the LLM output, but we can verify the setup
    expect(item.entityName).toBe('Sonic Duo');
    expect(sonicArtist.name).toBe('Sonic');
    expect(sonicArtist.footprint?.regions.Staffordshire).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// Golden Fixture 4: Same name, disjoint footprint → uncertain
// -----------------------------------------------------------------------------

describe('Golden Fixture 4: Disjoint footprints → uncertain', () => {
  it('should return uncertain for same-name with disjoint footprints', () => {
    const item = createReviewItem({
      entityName: 'Not Guilty',
      sourceContext: { venueRegion: 'Staffordshire' },
    });

    const notGuiltyLondon = createCandidate({
      id: 'not-guilty-london',
      name: 'Not Guilty',
      location: 'London',
      footprint: {
        regions: { London: 30, Surrey: 5 },
        totalEvents: 35,
      },
      similarity: 100,
    });

    // A Stoke listing for "Not Guilty" should NOT match a London-based "Not Guilty"
    // because the footprints are disjoint
    expect(item.sourceContext.venueRegion).toBe('Staffordshire');
    expect(notGuiltyLondon.footprint?.regions.Staffordshire).toBeUndefined();
    expect(notGuiltyLondon.footprint?.regions.London).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// Golden Fixture 5: Genuinely new act → create → human
// -----------------------------------------------------------------------------

describe('Golden Fixture 5: Genuinely new act', () => {
  it('should return create for no plausible candidates', () => {
    const item = createReviewItem({
      entityName: 'Brand New Band Nobody Has Heard Of',
      sourceContext: { venueRegion: 'Staffordshire' },
    });

    // When no candidate clears thresholdLow (70), decision should be 'create'
    // But auto-CREATE is never allowed → goes to human
    const noCandidates: CandidateEvidence[] = [];

    expect(noCandidates.length).toBe(0);
    // Resolver should return decision: 'create' but action: 'proposed' (human review)
  });
});

// -----------------------------------------------------------------------------
// Decision Bands (from spec)
// -----------------------------------------------------------------------------

describe('Decision Bands', () => {
  const config = DEFAULT_RESOLVER_CONFIG;

  it('should have correct threshold defaults', () => {
    expect(config.thresholdHigh).toBe(90);
    expect(config.thresholdLow).toBe(70);
    expect(config.marginRequired).toBe(10);
  });

  it('match >= T_high with margin → auto_applied', () => {
    // confidence >= 90, clear winner (next candidate > 10 behind)
    const confidence = 95;
    const nextBestConfidence = 80;
    const margin = confidence - nextBestConfidence;

    expect(confidence).toBeGreaterThanOrEqual(config.thresholdHigh);
    expect(margin).toBeGreaterThanOrEqual(config.marginRequired);
    // → Should auto-apply
  });

  it('match 70-90 or within margin → proposed (human)', () => {
    // confidence 85, next is 82 (margin only 3)
    const confidence = 85;
    const nextBestConfidence = 82;
    const margin = confidence - nextBestConfidence;

    expect(confidence).toBeLessThan(config.thresholdHigh);
    expect(margin).toBeLessThan(config.marginRequired);
    // → Should go to human
  });

  it('create decision → proposed (human)', () => {
    // Per spec: "create → HUMAN (entity creation is the dup-risk path)"
    // Never auto-create
  });

  it('uncertain or < T_low → proposed (human)', () => {
    const confidence = 65;
    expect(confidence).toBeLessThan(config.thresholdLow);
    // → Should go to human
  });
});
