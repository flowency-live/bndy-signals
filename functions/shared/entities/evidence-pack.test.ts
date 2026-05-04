import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Import schemas to test
import {
  EvidencePackSchema,
  CorroborationStrengthSchema,
  PackStatusSchema,
  calculateCorroborationStrength,
} from './evidence-pack';

describe('CorroborationStrengthSchema', () => {
  it('should accept weak', () => {
    expect(CorroborationStrengthSchema.parse('weak')).toBe('weak');
  });

  it('should accept moderate', () => {
    expect(CorroborationStrengthSchema.parse('moderate')).toBe('moderate');
  });

  it('should accept strong', () => {
    expect(CorroborationStrengthSchema.parse('strong')).toBe('strong');
  });

  it('should reject invalid values', () => {
    expect(() => CorroborationStrengthSchema.parse('very_strong')).toThrow();
    expect(() => CorroborationStrengthSchema.parse('medium')).toThrow();
    expect(() => CorroborationStrengthSchema.parse(0.5)).toThrow();
  });
});

describe('PackStatusSchema', () => {
  it('should accept gathering', () => {
    expect(PackStatusSchema.parse('gathering')).toBe('gathering');
  });

  it('should accept ready', () => {
    expect(PackStatusSchema.parse('ready')).toBe('ready');
  });

  it('should accept ratified', () => {
    expect(PackStatusSchema.parse('ratified')).toBe('ratified');
  });

  it('should accept rejected', () => {
    expect(PackStatusSchema.parse('rejected')).toBe('rejected');
  });
});

describe('EvidencePackSchema', () => {
  const validPack = {
    packId: 'pack_a1b2c3d4',
    proposition: 'Stingray plays at The Rigger on 2026-05-15',
    propositionKey: 'stingray play at rigger on 2026-05-15',
    propositionType: 'event',
    signalIds: ['sgnl_abc12345'],
    interpretationIds: ['intp_def67890'],
    claimIds: ['clm_111', 'clm_222', 'clm_333'],
    candidateIds: ['cand_xyz12345'],
    corroborationStrength: 'weak',
    corroborationReasoning: 'Single source, no corroboration yet',
    sourceCount: 1,
    status: 'gathering',
    createdAt: '2026-05-04T12:00:00.000Z',
    updatedAt: '2026-05-04T12:00:00.000Z',
  };

  it('should validate a complete pack', () => {
    expect(() => EvidencePackSchema.parse(validPack)).not.toThrow();
  });

  it('should require packId in correct format', () => {
    expect(() =>
      EvidencePackSchema.parse({ ...validPack, packId: 'invalid' })
    ).toThrow();
    expect(() =>
      EvidencePackSchema.parse({ ...validPack, packId: 'pack_12345678' })
    ).not.toThrow();
  });

  it('should require proposition', () => {
    const { proposition, ...noProp } = validPack;
    expect(() => EvidencePackSchema.parse(noProp)).toThrow();
  });

  it('should require propositionType', () => {
    const { propositionType, ...noType } = validPack;
    expect(() => EvidencePackSchema.parse(noType)).toThrow();
  });

  it('should accept valid propositionTypes', () => {
    const types = ['event', 'artist_venue', 'venue_location', 'artist_exists', 'venue_exists'];
    for (const type of types) {
      expect(() =>
        EvidencePackSchema.parse({ ...validPack, propositionType: type })
      ).not.toThrow();
    }
  });

  it('should require at least one signalId', () => {
    expect(() =>
      EvidencePackSchema.parse({ ...validPack, signalIds: [] })
    ).toThrow();
  });

  it('should require at least one interpretationId', () => {
    expect(() =>
      EvidencePackSchema.parse({ ...validPack, interpretationIds: [] })
    ).toThrow();
  });

  it('should require at least one claimId', () => {
    expect(() =>
      EvidencePackSchema.parse({ ...validPack, claimIds: [] })
    ).toThrow();
  });

  it('should allow empty candidateIds (pack may not have candidates yet)', () => {
    expect(() =>
      EvidencePackSchema.parse({ ...validPack, candidateIds: [] })
    ).not.toThrow();
  });

  it('should require corroborationStrength', () => {
    const { corroborationStrength, ...noStrength } = validPack;
    expect(() => EvidencePackSchema.parse(noStrength)).toThrow();
  });

  it('should require corroborationReasoning', () => {
    const { corroborationReasoning, ...noReasoning } = validPack;
    expect(() => EvidencePackSchema.parse(noReasoning)).toThrow();
  });

  it('should require sourceCount', () => {
    const { sourceCount, ...noCount } = validPack;
    expect(() => EvidencePackSchema.parse(noCount)).toThrow();
  });
});

describe('calculateCorroborationStrength', () => {
  it('should return weak for single source', () => {
    const result = calculateCorroborationStrength({
      sourceCount: 1,
      trustedSourceCount: 0,
    });
    expect(result.strength).toBe('weak');
    expect(result.reasoning).toContain('Single source');
  });

  it('should return moderate for 2 sources', () => {
    const result = calculateCorroborationStrength({
      sourceCount: 2,
      trustedSourceCount: 0,
    });
    expect(result.strength).toBe('moderate');
    expect(result.reasoning).toContain('2 independent sources');
  });

  it('should return moderate for 1 trusted source', () => {
    const result = calculateCorroborationStrength({
      sourceCount: 1,
      trustedSourceCount: 1,
    });
    expect(result.strength).toBe('moderate');
    expect(result.reasoning).toContain('trusted source');
  });

  it('should return strong for 3+ sources', () => {
    const result = calculateCorroborationStrength({
      sourceCount: 3,
      trustedSourceCount: 0,
    });
    expect(result.strength).toBe('strong');
    expect(result.reasoning).toContain('3+ independent sources');
  });

  it('should return strong for 2+ trusted sources', () => {
    const result = calculateCorroborationStrength({
      sourceCount: 2,
      trustedSourceCount: 2,
    });
    expect(result.strength).toBe('strong');
    expect(result.reasoning).toContain('trusted sources');
  });
});

describe('Evidence Pack cognitive model', () => {
  it('should represent a proposition about an event', () => {
    const eventPack = {
      packId: 'pack_event123',
      proposition: 'Metallica plays at Wembley Stadium on 2026-05-15',
      propositionKey: 'metallica play at wembley stadium on 2026-05-15',
      propositionType: 'event',
      signalIds: ['sgnl_abc12345', 'sgnl_def67890'],
      interpretationIds: ['intp_111', 'intp_222'],
      claimIds: ['clm_event', 'clm_date', 'clm_venue', 'clm_artist'],
      candidateIds: ['cand_metallica'],
      corroborationStrength: 'moderate',
      corroborationReasoning: '2 independent sources agree on event details',
      sourceCount: 2,
      status: 'gathering',
      createdAt: '2026-05-04T12:00:00.000Z',
      updatedAt: '2026-05-04T12:00:00.000Z',
    };

    expect(() => EvidencePackSchema.parse(eventPack)).not.toThrow();
  });

  it('should represent a proposition about artist-venue relationship', () => {
    const relationshipPack = {
      packId: 'pack_rel12345',
      proposition: 'Stingray regularly performs at The Rigger',
      propositionKey: 'stingray regularly performs at rigger',
      propositionType: 'artist_venue',
      signalIds: ['sgnl_1', 'sgnl_2', 'sgnl_3'],
      interpretationIds: ['intp_1', 'intp_2', 'intp_3'],
      claimIds: ['clm_perf1', 'clm_perf2', 'clm_perf3'],
      candidateIds: [],
      corroborationStrength: 'strong',
      corroborationReasoning: '3+ independent sources show recurring performances',
      sourceCount: 3,
      status: 'ready',
      createdAt: '2026-05-04T12:00:00.000Z',
      updatedAt: '2026-05-04T13:00:00.000Z',
    };

    expect(() => EvidencePackSchema.parse(relationshipPack)).not.toThrow();
  });

  it('should require propositionKey', () => {
    const packWithoutKey = {
      packId: 'pack_a1b2c3d4',
      proposition: 'Stingray plays at The Rigger',
      propositionType: 'event',
      signalIds: ['sgnl_abc12345'],
      interpretationIds: ['intp_def67890'],
      claimIds: ['clm_111'],
      candidateIds: [],
      corroborationStrength: 'weak',
      corroborationReasoning: 'Single source',
      sourceCount: 1,
      status: 'gathering',
      createdAt: '2026-05-04T12:00:00.000Z',
      updatedAt: '2026-05-04T12:00:00.000Z',
    };

    expect(() => EvidencePackSchema.parse(packWithoutKey)).toThrow();
  });
});
