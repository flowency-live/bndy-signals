import { describe, it, expect } from 'vitest';
import {
  EventCandidateSchema,
  CandidateStatusSchema,
  CompletenessSchema,
  CandidateVerificationStatusSchema,
  AmbiguitySchema,
  ClaimReferenceSchema,
  EventCandidate,
  Ambiguity,
} from './event-candidate';

describe('CandidateStatusSchema', () => {
  it('accepts proposed status', () => {
    expect(CandidateStatusSchema.parse('proposed')).toBe('proposed');
  });

  it('accepts ratified status', () => {
    expect(CandidateStatusSchema.parse('ratified')).toBe('ratified');
  });

  it('accepts all valid statuses', () => {
    const validStatuses = ['proposed', 'ratified', 'rejected', 'merged'];
    validStatuses.forEach((status) => {
      expect(CandidateStatusSchema.parse(status)).toBe(status);
    });
  });

  it('rejects invalid status', () => {
    expect(() => CandidateStatusSchema.parse('invalid')).toThrow();
  });
});

describe('CompletenessSchema', () => {
  it('accepts partial completeness', () => {
    expect(CompletenessSchema.parse('partial')).toBe('partial');
  });

  it('accepts complete completeness', () => {
    expect(CompletenessSchema.parse('complete')).toBe('complete');
  });

  it('rejects invalid completeness', () => {
    expect(() => CompletenessSchema.parse('unknown')).toThrow();
  });
});

describe('CandidateVerificationStatusSchema', () => {
  it('accepts unverified status', () => {
    expect(CandidateVerificationStatusSchema.parse('unverified')).toBe('unverified');
  });

  it('accepts submitter_verified status', () => {
    expect(CandidateVerificationStatusSchema.parse('submitter_verified')).toBe('submitter_verified');
  });

  it('rejects invalid verification status', () => {
    expect(() => CandidateVerificationStatusSchema.parse('owner_confirmed')).toThrow();
  });
});

describe('AmbiguitySchema', () => {
  it('accepts valid ambiguity', () => {
    const ambiguity: Ambiguity = {
      ambiguityType: 'entity_match',
      description: 'Multiple venues named The Rigger',
      affectedClaimIds: ['clm_abc12345'],
    };
    expect(AmbiguitySchema.parse(ambiguity)).toEqual(ambiguity);
  });

  it('accepts ambiguity with suggested resolution', () => {
    const ambiguity: Ambiguity = {
      ambiguityType: 'date_uncertain',
      description: 'Year not specified',
      affectedClaimIds: ['clm_xyz98765'],
      suggestedResolution: 'Assume 2026 based on day of week',
    };
    const result = AmbiguitySchema.parse(ambiguity);
    expect(result.suggestedResolution).toBe('Assume 2026 based on day of week');
  });

  it('accepts all ambiguity types', () => {
    const types = ['entity_match', 'date_uncertain', 'conflicting', 'incomplete'];
    types.forEach((type) => {
      const ambiguity = {
        ambiguityType: type,
        description: 'Test',
        affectedClaimIds: [],
      };
      expect(AmbiguitySchema.parse(ambiguity).ambiguityType).toBe(type);
    });
  });

  it('rejects ambiguity without required fields', () => {
    expect(() => AmbiguitySchema.parse({})).toThrow();
  });
});

describe('ClaimReferenceSchema', () => {
  it('accepts valid claim reference', () => {
    const ref = {
      claimId: 'clm_abc12345',
      claimType: 'event_exists',
      value: 'Stingray Live',
      status: 'accepted',
    };
    expect(ClaimReferenceSchema.parse(ref)).toEqual(ref);
  });

  // Note: ClaimReferenceSchema is imported from evidence-pack and does not validate claimId format

  it('accepts all claim statuses', () => {
    const statuses = ['proposed', 'accepted', 'challenged'];
    statuses.forEach((status) => {
      const ref = {
        claimId: 'clm_abc12345',
        claimType: 'event_exists',
        value: 'Test',
        status,
      };
      expect(ClaimReferenceSchema.parse(ref).status).toBe(status);
    });
  });
});

describe('EventCandidateSchema', () => {
  const validCandidate: EventCandidate = {
    candidateId: 'cand_abc12345',
    candidateType: 'event',
    signalId: 'sgnl_xyz98765',
    interpretationId: 'intp_def45678',

    proposedName: 'Stingray Live at The Rigger',
    proposedDate: '2026-05-15',
    proposedTime: '20:00',
    proposedVenueId: 'vnue_abc12345',
    proposedArtistIds: ['arts_abc12345'],

    reasoning: 'Signal announces Stingray performing at The Rigger on Thursday 15th May at 8PM',

    sourceClaims: [
      {
        claimId: 'clm_claim001',
        claimType: 'event_exists',
        value: 'Stingray Live',
        status: 'accepted',
      },
    ],

    completeness: 'complete',
    missingFields: [],

    ambiguities: [],

    verificationStatus: 'unverified',

    status: 'proposed',
    createdAt: '2026-05-04T10:00:00.000Z',
    updatedAt: '2026-05-04T10:00:00.000Z',
  };

  it('accepts valid event candidate with all required fields', () => {
    const result = EventCandidateSchema.parse(validCandidate);
    expect(result.candidateId).toBe('cand_abc12345');
    expect(result.candidateType).toBe('event');
    expect(result.proposedName).toBe('Stingray Live at The Rigger');
  });

  it('requires candidateId with cand_ prefix', () => {
    const invalid = { ...validCandidate, candidateId: 'evnt_abc12345' };
    expect(() => EventCandidateSchema.parse(invalid)).toThrow();
  });

  it('requires candidateId with 8-char suffix', () => {
    const invalid = { ...validCandidate, candidateId: 'cand_abc' };
    expect(() => EventCandidateSchema.parse(invalid)).toThrow();
  });

  it('requires signalId with sgnl_ prefix', () => {
    const invalid = { ...validCandidate, signalId: 'sig_xyz98765' };
    expect(() => EventCandidateSchema.parse(invalid)).toThrow();
  });

  it('requires interpretationId with intp_ prefix', () => {
    const invalid = { ...validCandidate, interpretationId: 'int_def45678' };
    expect(() => EventCandidateSchema.parse(invalid)).toThrow();
  });

  it('allows candidate without venue (partial)', () => {
    const partial: EventCandidate = {
      ...validCandidate,
      proposedVenueId: undefined,
      completeness: 'partial',
      missingFields: ['venue'],
    };
    const result = EventCandidateSchema.parse(partial);
    expect(result.proposedVenueId).toBeUndefined();
    expect(result.completeness).toBe('partial');
  });

  it('allows candidate without artists', () => {
    const noArtists: EventCandidate = {
      ...validCandidate,
      proposedArtistIds: [],
      completeness: 'partial',
      missingFields: ['artists'],
    };
    const result = EventCandidateSchema.parse(noArtists);
    expect(result.proposedArtistIds).toEqual([]);
  });

  it('accepts candidate with ambiguities', () => {
    const withAmbiguity: EventCandidate = {
      ...validCandidate,
      ambiguities: [
        {
          ambiguityType: 'entity_match',
          description: 'Multiple venues named The Rigger',
          affectedClaimIds: ['clm_venue001'],
          suggestedResolution: 'Ask user to confirm location',
        },
      ],
    };
    const result = EventCandidateSchema.parse(withAmbiguity);
    expect(result.ambiguities).toHaveLength(1);
    expect(result.ambiguities[0].ambiguityType).toBe('entity_match');
  });

  it('requires proposedVenueId with vnue_ prefix when provided', () => {
    const invalid = { ...validCandidate, proposedVenueId: 'venue_123' };
    expect(() => EventCandidateSchema.parse(invalid)).toThrow();
  });

  it('requires proposedArtistIds with arts_ prefix', () => {
    const invalid = { ...validCandidate, proposedArtistIds: ['artist_123'] };
    expect(() => EventCandidateSchema.parse(invalid)).toThrow();
  });

  it('accepts submitter_verified verification status', () => {
    const verified: EventCandidate = {
      ...validCandidate,
      verificationStatus: 'submitter_verified',
      submitterId: 'user_trusted01',
    };
    const result = EventCandidateSchema.parse(verified);
    expect(result.verificationStatus).toBe('submitter_verified');
    expect(result.submitterId).toBe('user_trusted01');
  });

  it('allows ratified status with ratification details', () => {
    const ratified: EventCandidate = {
      ...validCandidate,
      status: 'ratified',
      ratifiedAt: '2026-05-04T12:00:00.000Z',
      ratifiedBy: 'user_reviewer1',
    };
    const result = EventCandidateSchema.parse(ratified);
    expect(result.status).toBe('ratified');
    expect(result.ratifiedAt).toBe('2026-05-04T12:00:00.000Z');
  });

  it('allows rejected status', () => {
    const rejected: EventCandidate = {
      ...validCandidate,
      status: 'rejected',
    };
    const result = EventCandidateSchema.parse(rejected);
    expect(result.status).toBe('rejected');
  });

  it('allows merged status with merge target', () => {
    const merged: EventCandidate = {
      ...validCandidate,
      status: 'merged',
      mergedInto: 'cand_target01',
    };
    const result = EventCandidateSchema.parse(merged);
    expect(result.status).toBe('merged');
    expect(result.mergedInto).toBe('cand_target01');
  });

  it('requires at least one source claim', () => {
    const noClaims = { ...validCandidate, sourceClaims: [] };
    expect(() => EventCandidateSchema.parse(noClaims)).toThrow();
  });

  it('requires proposedDate in YYYY-MM-DD format when provided', () => {
    const badDate = { ...validCandidate, proposedDate: '15/05/2026' };
    expect(() => EventCandidateSchema.parse(badDate)).toThrow();
  });

  it('requires proposedTime in HH:MM format when provided', () => {
    const badTime = { ...validCandidate, proposedTime: '8pm' };
    expect(() => EventCandidateSchema.parse(badTime)).toThrow();
  });

  it('allows candidate without date (partial)', () => {
    const noDate: EventCandidate = {
      ...validCandidate,
      proposedDate: undefined,
      completeness: 'partial',
      missingFields: ['date'],
    };
    const result = EventCandidateSchema.parse(noDate);
    expect(result.proposedDate).toBeUndefined();
  });
});

describe('Event candidate completeness calculation', () => {
  it('is complete when name, date, venue, and artists present', () => {
    const complete: EventCandidate = {
      candidateId: 'cand_complete',
      candidateType: 'event',
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_def45678',
      proposedName: 'Stingray Live',
      proposedDate: '2026-05-15',
      proposedVenueId: 'vnue_abc12345',
      proposedArtistIds: ['arts_abc12345'],
      reasoning: 'Complete event with all required fields',
      sourceClaims: [
        {
          claimId: 'clm_claim001',
          claimType: 'event_exists',
          value: 'Stingray Live',
          status: 'accepted',
        },
      ],
      completeness: 'complete',
      missingFields: [],
      ambiguities: [],
      verificationStatus: 'unverified',
      status: 'proposed',
      createdAt: '2026-05-04T10:00:00.000Z',
      updatedAt: '2026-05-04T10:00:00.000Z',
    };
    const result = EventCandidateSchema.parse(complete);
    expect(result.completeness).toBe('complete');
    expect(result.missingFields).toEqual([]);
  });

  it('is partial when missing venue', () => {
    const partial: EventCandidate = {
      candidateId: 'cand_partial1',
      candidateType: 'event',
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_def45678',
      proposedName: 'Stingray Live',
      proposedDate: '2026-05-15',
      proposedArtistIds: ['arts_abc12345'],
      reasoning: 'Event missing venue information',
      sourceClaims: [
        {
          claimId: 'clm_claim001',
          claimType: 'event_exists',
          value: 'Stingray Live',
          status: 'accepted',
        },
      ],
      completeness: 'partial',
      missingFields: ['venue'],
      ambiguities: [],
      verificationStatus: 'unverified',
      status: 'proposed',
      createdAt: '2026-05-04T10:00:00.000Z',
      updatedAt: '2026-05-04T10:00:00.000Z',
    };
    const result = EventCandidateSchema.parse(partial);
    expect(result.completeness).toBe('partial');
    expect(result.missingFields).toContain('venue');
  });
});

describe('Trusted source fast-path', () => {
  it('accepts submitter_verified for trusted source submission', () => {
    const trusted: EventCandidate = {
      candidateId: 'cand_trusted1',
      candidateType: 'event',
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_def45678',
      proposedName: 'Stingray Live',
      proposedDate: '2026-05-15',
      proposedVenueId: 'vnue_abc12345',
      proposedArtistIds: ['arts_abc12345'],
      reasoning: 'Submitted by verified venue owner',
      sourceClaims: [
        {
          claimId: 'clm_claim001',
          claimType: 'event_exists',
          value: 'Stingray Live',
          status: 'accepted',
        },
      ],
      completeness: 'complete',
      missingFields: [],
      ambiguities: [],
      verificationStatus: 'submitter_verified',
      submitterId: 'user_venueowner',
      status: 'proposed',
      createdAt: '2026-05-04T10:00:00.000Z',
      updatedAt: '2026-05-04T10:00:00.000Z',
    };
    const result = EventCandidateSchema.parse(trusted);
    expect(result.verificationStatus).toBe('submitter_verified');
    expect(result.submitterId).toBe('user_venueowner');
  });
});
