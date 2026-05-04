import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  groupClaimsIntoEventCandidate,
  isEventRelatedClaim,
  calculateEventCompleteness,
  detectAmbiguities,
  AggregatorInput,
  ResolvedEntity,
} from './index';
import { Claim, ClaimType } from '../shared/entities';

const createClaim = (
  overrides: Partial<Claim> & { claimType: ClaimType }
): Claim => ({
  claimId: `clm_${Math.random().toString(36).slice(2, 10)}`,
  subject: 'Test Subject',
  predicate: 'test',
  strength: 'moderate',
  strengthReasoning: 'Test reasoning',
  interpretationId: 'intp_abc12345',
  signalId: 'sgnl_xyz98765',
  status: 'accepted',
  createdAt: '2026-05-04T10:00:00.000Z',
  ...overrides,
});

describe('isEventRelatedClaim', () => {
  it('returns true for event_exists', () => {
    expect(isEventRelatedClaim('event_exists')).toBe(true);
  });

  it('returns true for event_date', () => {
    expect(isEventRelatedClaim('event_date')).toBe(true);
  });

  it('returns true for event_time', () => {
    expect(isEventRelatedClaim('event_time')).toBe(true);
  });

  it('returns true for artist_performs', () => {
    expect(isEventRelatedClaim('artist_performs')).toBe(true);
  });

  it('returns true for venue_hosts', () => {
    expect(isEventRelatedClaim('venue_hosts')).toBe(true);
  });

  it('returns false for artist_exists', () => {
    expect(isEventRelatedClaim('artist_exists')).toBe(false);
  });

  it('returns false for venue_exists', () => {
    expect(isEventRelatedClaim('venue_exists')).toBe(false);
  });

  it('returns false for ticket_source', () => {
    expect(isEventRelatedClaim('ticket_source')).toBe(false);
  });
});

describe('calculateEventCompleteness', () => {
  it('returns complete when all fields present', () => {
    const result = calculateEventCompleteness({
      proposedName: 'Stingray Live',
      proposedDate: '2026-05-15',
      proposedVenueId: 'vnue_abc12345',
      proposedArtistIds: ['arts_abc12345'],
    });
    expect(result.completeness).toBe('complete');
    expect(result.missingFields).toEqual([]);
  });

  it('returns partial when missing venue', () => {
    const result = calculateEventCompleteness({
      proposedName: 'Stingray Live',
      proposedDate: '2026-05-15',
      proposedArtistIds: ['arts_abc12345'],
    });
    expect(result.completeness).toBe('partial');
    expect(result.missingFields).toContain('venue');
  });

  it('returns partial when missing date', () => {
    const result = calculateEventCompleteness({
      proposedName: 'Stingray Live',
      proposedVenueId: 'vnue_abc12345',
      proposedArtistIds: ['arts_abc12345'],
    });
    expect(result.completeness).toBe('partial');
    expect(result.missingFields).toContain('date');
  });

  it('returns partial when missing artists', () => {
    const result = calculateEventCompleteness({
      proposedName: 'Stingray Live',
      proposedDate: '2026-05-15',
      proposedVenueId: 'vnue_abc12345',
      proposedArtistIds: [],
    });
    expect(result.completeness).toBe('partial');
    expect(result.missingFields).toContain('artists');
  });

  it('returns partial when missing name', () => {
    const result = calculateEventCompleteness({
      proposedDate: '2026-05-15',
      proposedVenueId: 'vnue_abc12345',
      proposedArtistIds: ['arts_abc12345'],
    });
    expect(result.completeness).toBe('partial');
    expect(result.missingFields).toContain('name');
  });

  it('tracks multiple missing fields', () => {
    const result = calculateEventCompleteness({
      proposedName: 'Stingray Live',
    });
    expect(result.completeness).toBe('partial');
    expect(result.missingFields).toContain('date');
    expect(result.missingFields).toContain('venue');
    expect(result.missingFields).toContain('artists');
  });
});

describe('detectAmbiguities', () => {
  it('returns empty array when no ambiguities', () => {
    const resolvedEntities: ResolvedEntity[] = [
      {
        claimId: 'clm_venue001',
        entityType: 'venue',
        action: 'linked',
        entityId: 'vnue_abc12345',
      },
    ];
    const result = detectAmbiguities(resolvedEntities, []);
    expect(result).toEqual([]);
  });

  it('detects entity_match ambiguity when candidates returned', () => {
    const resolvedEntities: ResolvedEntity[] = [
      {
        claimId: 'clm_venue001',
        entityType: 'venue',
        action: 'candidates',
        candidates: [
          { entityId: 'vnue_rigger01', name: 'The Rigger', location: 'Newcastle' },
          { entityId: 'vnue_rigger02', name: 'The Rigger', location: 'Sheffield' },
        ],
      },
    ];
    const result = detectAmbiguities(resolvedEntities, []);
    expect(result).toHaveLength(1);
    expect(result[0].ambiguityType).toBe('entity_match');
    expect(result[0].affectedClaimIds).toContain('clm_venue001');
  });

  it('detects date_uncertain ambiguity from uncertainties', () => {
    const uncertainties = ['Year not specified - inferred from current date'];
    const result = detectAmbiguities([], uncertainties);
    expect(result).toHaveLength(1);
    expect(result[0].ambiguityType).toBe('date_uncertain');
  });
});

describe('groupClaimsIntoEventCandidate', () => {
  it('creates event candidate from complete claim set', () => {
    const claims: Claim[] = [
      createClaim({
        claimId: 'clm_event001',
        claimType: 'event_exists',
        subject: 'Stingray Live at The Rigger',
        object: 'Stingray Live',
      }),
      createClaim({
        claimId: 'clm_date0001',
        claimType: 'event_date',
        subject: 'Stingray Live',
        value: '2026-05-15',
      }),
      createClaim({
        claimId: 'clm_time0001',
        claimType: 'event_time',
        subject: 'Stingray Live',
        value: '20:00',
      }),
      createClaim({
        claimId: 'clm_venue001',
        claimType: 'venue_hosts',
        subject: 'The Rigger',
        object: 'Stingray Live',
      }),
      createClaim({
        claimId: 'clm_artst001',
        claimType: 'artist_performs',
        subject: 'Stingray',
        object: 'The Rigger',
      }),
    ];

    const resolvedEntities: ResolvedEntity[] = [
      {
        claimId: 'clm_venue001',
        entityType: 'venue',
        action: 'linked',
        entityId: 'vnue_abc12345',
      },
      {
        claimId: 'clm_artst001',
        entityType: 'artist',
        action: 'created',
        entityId: 'arts_xyz98765',
      },
    ];

    const input: AggregatorInput = {
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_abc12345',
      claims,
      resolvedEntities,
      uncertainties: [],
    };

    const candidate = groupClaimsIntoEventCandidate(input);

    expect(candidate).toBeDefined();
    expect(candidate!.candidateId).toMatch(/^cand_[a-zA-Z0-9]{8}$/);
    expect(candidate!.candidateType).toBe('event');
    expect(candidate!.proposedName).toBe('Stingray Live at The Rigger');
    expect(candidate!.proposedDate).toBe('2026-05-15');
    expect(candidate!.proposedTime).toBe('20:00');
    expect(candidate!.proposedVenueId).toBe('vnue_abc12345');
    expect(candidate!.proposedArtistIds).toContain('arts_xyz98765');
    expect(candidate!.completeness).toBe('complete');
    expect(candidate!.status).toBe('proposed');
  });

  it('returns null when no event_exists claim', () => {
    const claims: Claim[] = [
      createClaim({
        claimId: 'clm_date0001',
        claimType: 'event_date',
        subject: 'Stingray Live',
        value: '2026-05-15',
      }),
    ];

    const input: AggregatorInput = {
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_abc12345',
      claims,
      resolvedEntities: [],
      uncertainties: [],
    };

    const candidate = groupClaimsIntoEventCandidate(input);
    expect(candidate).toBeNull();
  });

  it('creates partial candidate when missing venue', () => {
    const claims: Claim[] = [
      createClaim({
        claimId: 'clm_event001',
        claimType: 'event_exists',
        subject: 'Stingray Live',
        object: 'Stingray Live',
      }),
      createClaim({
        claimId: 'clm_date0001',
        claimType: 'event_date',
        subject: 'Stingray Live',
        value: '2026-05-15',
      }),
      createClaim({
        claimId: 'clm_artst001',
        claimType: 'artist_performs',
        subject: 'Stingray',
        object: 'Some Venue',
      }),
    ];

    const resolvedEntities: ResolvedEntity[] = [
      {
        claimId: 'clm_artst001',
        entityType: 'artist',
        action: 'created',
        entityId: 'arts_xyz98765',
      },
    ];

    const input: AggregatorInput = {
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_abc12345',
      claims,
      resolvedEntities,
      uncertainties: [],
    };

    const candidate = groupClaimsIntoEventCandidate(input);

    expect(candidate).toBeDefined();
    expect(candidate!.completeness).toBe('partial');
    expect(candidate!.missingFields).toContain('venue');
    expect(candidate!.proposedVenueId).toBeUndefined();
  });

  it('includes ambiguities when venue has multiple matches', () => {
    const claims: Claim[] = [
      createClaim({
        claimId: 'clm_event001',
        claimType: 'event_exists',
        subject: 'Stingray Live',
        object: 'Stingray Live',
      }),
      createClaim({
        claimId: 'clm_venue001',
        claimType: 'venue_hosts',
        subject: 'The Rigger',
        object: 'Stingray Live',
      }),
    ];

    const resolvedEntities: ResolvedEntity[] = [
      {
        claimId: 'clm_venue001',
        entityType: 'venue',
        action: 'candidates',
        candidates: [
          { entityId: 'vnue_rigger01', name: 'The Rigger', location: 'Newcastle' },
          { entityId: 'vnue_rigger02', name: 'The Rigger', location: 'Sheffield' },
        ],
      },
    ];

    const input: AggregatorInput = {
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_abc12345',
      claims,
      resolvedEntities,
      uncertainties: [],
    };

    const candidate = groupClaimsIntoEventCandidate(input);

    expect(candidate).toBeDefined();
    expect(candidate!.ambiguities).toHaveLength(1);
    expect(candidate!.ambiguities[0].ambiguityType).toBe('entity_match');
    expect(candidate!.proposedVenueId).toBeUndefined();
  });

  it('includes source claims in result', () => {
    const claims: Claim[] = [
      createClaim({
        claimId: 'clm_event001',
        claimType: 'event_exists',
        subject: 'Stingray Live',
        value: 'Stingray Live',
      }),
    ];

    const input: AggregatorInput = {
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_abc12345',
      claims,
      resolvedEntities: [],
      uncertainties: [],
    };

    const candidate = groupClaimsIntoEventCandidate(input);

    expect(candidate).toBeDefined();
    expect(candidate!.sourceClaims).toHaveLength(1);
    expect(candidate!.sourceClaims[0].claimId).toBe('clm_event001');
    expect(candidate!.sourceClaims[0].claimType).toBe('event_exists');
  });

  it('handles multiple artists', () => {
    const claims: Claim[] = [
      createClaim({
        claimId: 'clm_event001',
        claimType: 'event_exists',
        subject: 'Double Bill at The Rigger',
        object: 'Double Bill',
      }),
      createClaim({
        claimId: 'clm_artst001',
        claimType: 'artist_performs',
        subject: 'Stingray',
        object: 'The Rigger',
      }),
      createClaim({
        claimId: 'clm_artst002',
        claimType: 'artist_performs',
        subject: 'Electric Dreams',
        object: 'The Rigger',
      }),
    ];

    const resolvedEntities: ResolvedEntity[] = [
      {
        claimId: 'clm_artst001',
        entityType: 'artist',
        action: 'created',
        entityId: 'arts_stngray1',
      },
      {
        claimId: 'clm_artst002',
        entityType: 'artist',
        action: 'created',
        entityId: 'arts_elecdre1',
      },
    ];

    const input: AggregatorInput = {
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_abc12345',
      claims,
      resolvedEntities,
      uncertainties: [],
    };

    const candidate = groupClaimsIntoEventCandidate(input);

    expect(candidate).toBeDefined();
    expect(candidate!.proposedArtistIds).toHaveLength(2);
    expect(candidate!.proposedArtistIds).toContain('arts_stngray1');
    expect(candidate!.proposedArtistIds).toContain('arts_elecdre1');
  });

  it('detects date uncertainty from uncertainties array', () => {
    const claims: Claim[] = [
      createClaim({
        claimId: 'clm_event001',
        claimType: 'event_exists',
        subject: 'Stingray Live',
        value: 'Stingray Live',
      }),
      createClaim({
        claimId: 'clm_date0001',
        claimType: 'event_date',
        subject: 'Stingray Live',
        value: '2026-05-15',
      }),
    ];

    const input: AggregatorInput = {
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_abc12345',
      claims,
      resolvedEntities: [],
      uncertainties: ['Year not specified - inferred from current date'],
    };

    const candidate = groupClaimsIntoEventCandidate(input);

    expect(candidate).toBeDefined();
    expect(candidate!.ambiguities.some((a) => a.ambiguityType === 'date_uncertain')).toBe(true);
  });

  it('sets verificationStatus to unverified by default', () => {
    const claims: Claim[] = [
      createClaim({
        claimId: 'clm_event001',
        claimType: 'event_exists',
        subject: 'Stingray Live',
        value: 'Stingray Live',
      }),
    ];

    const input: AggregatorInput = {
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_abc12345',
      claims,
      resolvedEntities: [],
      uncertainties: [],
    };

    const candidate = groupClaimsIntoEventCandidate(input);

    expect(candidate).toBeDefined();
    expect(candidate!.verificationStatus).toBe('unverified');
  });

  it('sets verificationStatus to submitter_verified for trusted submitter', () => {
    const claims: Claim[] = [
      createClaim({
        claimId: 'clm_event001',
        claimType: 'event_exists',
        subject: 'Stingray Live',
        value: 'Stingray Live',
      }),
    ];

    const input: AggregatorInput = {
      signalId: 'sgnl_xyz98765',
      interpretationId: 'intp_abc12345',
      claims,
      resolvedEntities: [],
      uncertainties: [],
      submitterId: 'user_venueowner',
      isTrustedSubmitter: true,
    };

    const candidate = groupClaimsIntoEventCandidate(input);

    expect(candidate).toBeDefined();
    expect(candidate!.verificationStatus).toBe('submitter_verified');
    expect(candidate!.submitterId).toBe('user_venueowner');
  });
});
