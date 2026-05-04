import { describe, it, expect } from 'vitest';

// Import schemas to test (will fail until implemented)
import {
  ClarificationRequestSchema,
  ClarificationStatusSchema,
  ClarificationQuestionTypeSchema,
  ClarificationOptionSchema,
  generateClarificationId,
} from './clarification';

describe('ClarificationStatusSchema', () => {
  it('should accept open', () => {
    expect(ClarificationStatusSchema.parse('open')).toBe('open');
  });

  it('should accept resolved', () => {
    expect(ClarificationStatusSchema.parse('resolved')).toBe('resolved');
  });

  it('should accept dismissed', () => {
    expect(ClarificationStatusSchema.parse('dismissed')).toBe('dismissed');
  });

  it('should reject invalid values', () => {
    expect(() => ClarificationStatusSchema.parse('pending')).toThrow();
    expect(() => ClarificationStatusSchema.parse('closed')).toThrow();
  });
});

describe('ClarificationQuestionTypeSchema', () => {
  it('should accept entity_match', () => {
    expect(ClarificationQuestionTypeSchema.parse('entity_match')).toBe('entity_match');
  });

  it('should accept date_confirm', () => {
    expect(ClarificationQuestionTypeSchema.parse('date_confirm')).toBe('date_confirm');
  });

  it('should accept venue_location', () => {
    expect(ClarificationQuestionTypeSchema.parse('venue_location')).toBe('venue_location');
  });

  it('should accept artist_identity', () => {
    expect(ClarificationQuestionTypeSchema.parse('artist_identity')).toBe('artist_identity');
  });
});

describe('ClarificationOptionSchema', () => {
  it('should validate option with entity reference', () => {
    const option = {
      optionId: 'opt_12345678',
      label: 'The Rigger, Newcastle-under-Lyme',
      entityId: 'vnue_abc12345',
      confidence: 0.85,
    };
    expect(() => ClarificationOptionSchema.parse(option)).not.toThrow();
  });

  it('should validate option without entity reference', () => {
    const option = {
      optionId: 'opt_12345678',
      label: 'None of these',
    };
    expect(() => ClarificationOptionSchema.parse(option)).not.toThrow();
  });

  it('should require optionId', () => {
    const option = {
      label: 'Some option',
    };
    expect(() => ClarificationOptionSchema.parse(option)).toThrow();
  });
});

describe('ClarificationRequestSchema', () => {
  const validClarification = {
    clarificationId: 'clar_a1b2c3d4',
    candidateId: 'cand_xyz12345',
    question: 'Is this The Rigger in Newcastle-under-Lyme?',
    questionType: 'entity_match',
    options: [
      {
        optionId: 'opt_11111111',
        label: 'The Rigger, Newcastle-under-Lyme',
        entityId: 'vnue_abc12345',
        confidence: 0.85,
      },
      {
        optionId: 'opt_22222222',
        label: 'The Rigger, Sheffield',
        entityId: 'vnue_def67890',
        confidence: 0.72,
      },
    ],
    status: 'open',
    createdAt: '2026-05-04T12:00:00.000Z',
  };

  it('should validate a complete clarification request', () => {
    expect(() => ClarificationRequestSchema.parse(validClarification)).not.toThrow();
  });

  it('should require clarificationId in correct format', () => {
    expect(() =>
      ClarificationRequestSchema.parse({ ...validClarification, clarificationId: 'invalid' })
    ).toThrow();
    expect(() =>
      ClarificationRequestSchema.parse({ ...validClarification, clarificationId: 'clar_12345678' })
    ).not.toThrow();
  });

  it('should require question', () => {
    const { question, ...noQuestion } = validClarification;
    expect(() => ClarificationRequestSchema.parse(noQuestion)).toThrow();
  });

  it('should require questionType', () => {
    const { questionType, ...noType } = validClarification;
    expect(() => ClarificationRequestSchema.parse(noType)).toThrow();
  });

  it('should allow optional claimId', () => {
    const withClaim = { ...validClarification, claimId: 'clm_abc12345' };
    expect(() => ClarificationRequestSchema.parse(withClaim)).not.toThrow();
  });

  it('should allow optional evidencePackId', () => {
    const withPack = { ...validClarification, evidencePackId: 'pack_abc12345' };
    expect(() => ClarificationRequestSchema.parse(withPack)).not.toThrow();
  });

  it('should allow empty options array', () => {
    const noOptions = { ...validClarification, options: [] };
    expect(() => ClarificationRequestSchema.parse(noOptions)).not.toThrow();
  });

  it('should validate resolved clarification', () => {
    const resolved = {
      ...validClarification,
      status: 'resolved',
      resolvedBy: 'user_123',
      resolution: 'vnue_abc12345',
      resolvedAt: '2026-05-04T13:00:00.000Z',
    };
    expect(() => ClarificationRequestSchema.parse(resolved)).not.toThrow();
  });
});

describe('generateClarificationId', () => {
  it('should generate ID in correct format', () => {
    const id = generateClarificationId();
    expect(id).toMatch(/^clar_[a-zA-Z0-9]{8}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateClarificationId()));
    expect(ids.size).toBe(100);
  });
});

describe('Clarification cognitive model', () => {
  it('should represent venue ambiguity from multiple matches', () => {
    const venueAmbiguity = {
      clarificationId: 'clar_abcd1234',
      candidateId: 'cand_xyz12345',
      question: 'Which "The Rigger" is this event at?',
      questionType: 'entity_match',
      options: [
        {
          optionId: 'opt_1111aaaa',
          label: 'The Rigger, Newcastle-under-Lyme',
          entityId: 'vnue_ncl12345',
          confidence: 0.7,
        },
        {
          optionId: 'opt_2222bbbb',
          label: 'The Rigger, Sheffield',
          entityId: 'vnue_shf67890',
          confidence: 0.6,
        },
        {
          optionId: 'opt_3333cccc',
          label: 'Create new venue',
        },
      ],
      status: 'open',
      createdAt: '2026-05-04T12:00:00.000Z',
    };

    expect(() => ClarificationRequestSchema.parse(venueAmbiguity)).not.toThrow();
  });

  it('should represent date uncertainty from year inference', () => {
    const dateAmbiguity = {
      clarificationId: 'clar_date1234',
      candidateId: 'cand_evnt5678',
      claimId: 'clm_date1234',
      question: 'Is this event on May 15th, 2026 or 2027?',
      questionType: 'date_confirm',
      options: [
        {
          optionId: 'opt_2026maya',
          label: 'May 15, 2026',
          confidence: 0.9,
        },
        {
          optionId: 'opt_2027mayb',
          label: 'May 15, 2027',
          confidence: 0.3,
        },
      ],
      status: 'open',
      createdAt: '2026-05-04T12:00:00.000Z',
    };

    expect(() => ClarificationRequestSchema.parse(dateAmbiguity)).not.toThrow();
  });

  it('should allow resolution to update candidate', () => {
    const resolved = {
      clarificationId: 'clar_rslvd123',
      candidateId: 'cand_evnt1234',
      question: 'Which venue is this?',
      questionType: 'entity_match',
      options: [
        {
          optionId: 'opt_selctd12',
          label: 'The Rigger, Newcastle-under-Lyme',
          entityId: 'vnue_ncl12345',
        },
      ],
      status: 'resolved',
      resolvedBy: 'user_submitter',
      resolution: 'vnue_ncl12345',
      resolvedAt: '2026-05-04T14:00:00.000Z',
      createdAt: '2026-05-04T12:00:00.000Z',
    };

    expect(() => ClarificationRequestSchema.parse(resolved)).not.toThrow();
    // Resolution should match an entityId from options
    expect(resolved.resolution).toBe('vnue_ncl12345');
  });
});
