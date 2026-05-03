import { describe, it, expect } from 'vitest';
import {
  CanonicalArtistSchema,
  CanonicalVenueSchema,
  CanonicalEventSchema,
  EntityStatusSchema,
  EvidenceLinkSchema,
  CanonicalArtist,
  CanonicalVenue,
  CanonicalEvent,
} from './canonical-entity';

describe('EntityStatusSchema', () => {
  it('accepts draft status', () => {
    expect(EntityStatusSchema.parse('draft')).toBe('draft');
  });

  it('accepts published status', () => {
    expect(EntityStatusSchema.parse('published')).toBe('published');
  });

  it('accepts all valid statuses', () => {
    const validStatuses = ['draft', 'published', 'merged', 'archived'];
    validStatuses.forEach((status) => {
      expect(EntityStatusSchema.parse(status)).toBe(status);
    });
  });

  it('rejects invalid status', () => {
    expect(() => EntityStatusSchema.parse('invalid')).toThrow();
  });
});

describe('EvidenceLinkSchema', () => {
  it('accepts valid evidence link', () => {
    const link = {
      claimId: 'clm_abc12345',
      claimType: 'artist_performs',
      strength: 'moderate',
      linkedAt: '2026-05-03T12:00:00.000Z',
    };
    expect(EvidenceLinkSchema.parse(link)).toEqual(link);
  });

  it('rejects evidence link without required fields', () => {
    expect(() => EvidenceLinkSchema.parse({})).toThrow();
  });
});

describe('CanonicalArtistSchema', () => {
  const validArtist: CanonicalArtist = {
    entityId: 'arts_abc12345',
    entityType: 'artist',
    name: 'Stingray',
    aliases: [],
    status: 'draft',
    evidence: [
      {
        claimId: 'clm_xyz98765',
        claimType: 'artist_performs',
        strength: 'moderate',
        linkedAt: '2026-05-03T12:00:00.000Z',
      },
    ],
    createdAt: '2026-05-03T12:00:00.000Z',
    updatedAt: '2026-05-03T12:00:00.000Z',
  };

  it('accepts valid artist with required fields', () => {
    const result = CanonicalArtistSchema.parse(validArtist);
    expect(result.entityId).toBe('arts_abc12345');
    expect(result.entityType).toBe('artist');
    expect(result.name).toBe('Stingray');
  });

  it('requires entityId with arts_ prefix', () => {
    const invalid = { ...validArtist, entityId: 'vnue_abc12345' };
    expect(() => CanonicalArtistSchema.parse(invalid)).toThrow();
  });

  it('requires entityId with 8-char suffix', () => {
    const invalid = { ...validArtist, entityId: 'arts_abc' };
    expect(() => CanonicalArtistSchema.parse(invalid)).toThrow();
  });

  it('accepts artist with optional fields', () => {
    const artistWithOptionals: CanonicalArtist = {
      ...validArtist,
      aliases: ['The Stingray Band', 'Stingray Live'],
      genres: ['rock', 'covers'],
      hometown: 'Newcastle-under-Lyme',
      artistType: 'band',
      bio: 'Local rock covers band',
      website: 'https://stingray.band',
      socialLinks: {
        facebook: 'https://facebook.com/stingrayband',
      },
    };
    const result = CanonicalArtistSchema.parse(artistWithOptionals);
    expect(result.aliases).toEqual(['The Stingray Band', 'Stingray Live']);
    expect(result.genres).toEqual(['rock', 'covers']);
  });

  it('enforces entityType is artist', () => {
    const invalid = { ...validArtist, entityType: 'venue' };
    expect(() => CanonicalArtistSchema.parse(invalid)).toThrow();
  });

  it('requires at least one evidence link', () => {
    const invalid = { ...validArtist, evidence: [] };
    expect(() => CanonicalArtistSchema.parse(invalid)).toThrow();
  });
});

describe('CanonicalVenueSchema', () => {
  const validVenue: CanonicalVenue = {
    entityId: 'vnue_abc12345',
    entityType: 'venue',
    name: 'The Rigger',
    aliases: [],
    status: 'draft',
    evidence: [
      {
        claimId: 'clm_xyz98765',
        claimType: 'venue_hosts',
        strength: 'moderate',
        linkedAt: '2026-05-03T12:00:00.000Z',
      },
    ],
    createdAt: '2026-05-03T12:00:00.000Z',
    updatedAt: '2026-05-03T12:00:00.000Z',
  };

  it('accepts valid venue with required fields', () => {
    const result = CanonicalVenueSchema.parse(validVenue);
    expect(result.entityId).toBe('vnue_abc12345');
    expect(result.entityType).toBe('venue');
    expect(result.name).toBe('The Rigger');
  });

  it('requires entityId with vnue_ prefix', () => {
    const invalid = { ...validVenue, entityId: 'arts_abc12345' };
    expect(() => CanonicalVenueSchema.parse(invalid)).toThrow();
  });

  it('accepts venue with location details', () => {
    const venueWithLocation: CanonicalVenue = {
      ...validVenue,
      address: {
        line1: '123 High Street',
        city: 'Newcastle-under-Lyme',
        postcode: 'ST5 1AB',
        country: 'UK',
      },
      coordinates: {
        lat: 53.0103,
        lng: -2.2285,
      },
    };
    const result = CanonicalVenueSchema.parse(venueWithLocation);
    expect(result.address?.city).toBe('Newcastle-under-Lyme');
    expect(result.coordinates?.lat).toBe(53.0103);
  });

  it('accepts venue with capacity and type', () => {
    const venueWithDetails: CanonicalVenue = {
      ...validVenue,
      capacity: 150,
      venueType: 'pub',
      genres: ['rock', 'blues'],
    };
    const result = CanonicalVenueSchema.parse(venueWithDetails);
    expect(result.capacity).toBe(150);
    expect(result.venueType).toBe('pub');
  });

  it('enforces entityType is venue', () => {
    const invalid = { ...validVenue, entityType: 'artist' };
    expect(() => CanonicalVenueSchema.parse(invalid)).toThrow();
  });
});

describe('CanonicalEventSchema', () => {
  const validEvent: CanonicalEvent = {
    entityId: 'evnt_abc12345',
    entityType: 'event',
    name: 'Stingray Live at The Rigger',
    status: 'draft',
    evidence: [
      {
        claimId: 'clm_xyz98765',
        claimType: 'event_exists',
        strength: 'moderate',
        linkedAt: '2026-05-03T12:00:00.000Z',
      },
    ],
    startDate: '2026-05-15',
    venueId: 'vnue_abc12345',
    artistIds: ['arts_abc12345'],
    createdAt: '2026-05-03T12:00:00.000Z',
    updatedAt: '2026-05-03T12:00:00.000Z',
  };

  it('accepts valid event with required fields', () => {
    const result = CanonicalEventSchema.parse(validEvent);
    expect(result.entityId).toBe('evnt_abc12345');
    expect(result.entityType).toBe('event');
    expect(result.name).toBe('Stingray Live at The Rigger');
    expect(result.startDate).toBe('2026-05-15');
  });

  it('requires entityId with evnt_ prefix', () => {
    const invalid = { ...validEvent, entityId: 'arts_abc12345' };
    expect(() => CanonicalEventSchema.parse(invalid)).toThrow();
  });

  it('requires startDate', () => {
    const { startDate, ...noDate } = validEvent;
    expect(() => CanonicalEventSchema.parse(noDate)).toThrow();
  });

  it('requires venueId', () => {
    const { venueId, ...noVenue } = validEvent;
    expect(() => CanonicalEventSchema.parse(noVenue)).toThrow();
  });

  it('accepts event with time details', () => {
    const eventWithTimes: CanonicalEvent = {
      ...validEvent,
      startTime: '20:00',
      doorsTime: '19:30',
    };
    const result = CanonicalEventSchema.parse(eventWithTimes);
    expect(result.startTime).toBe('20:00');
    expect(result.doorsTime).toBe('19:30');
  });

  it('accepts event with pricing', () => {
    const eventWithPricing: CanonicalEvent = {
      ...validEvent,
      pricing: {
        isFree: false,
        currency: 'GBP',
        minPrice: 5,
        maxPrice: 8,
      },
    };
    const result = CanonicalEventSchema.parse(eventWithPricing);
    expect(result.pricing?.minPrice).toBe(5);
  });

  it('accepts event with eventStatus', () => {
    const eventWithStatus: CanonicalEvent = {
      ...validEvent,
      eventStatus: 'confirmed',
    };
    const result = CanonicalEventSchema.parse(eventWithStatus);
    expect(result.eventStatus).toBe('confirmed');
  });

  it('accepts event with verificationStatus', () => {
    const verifiedEvent: CanonicalEvent = {
      ...validEvent,
      verificationStatus: 'venue_confirmed',
    };
    const result = CanonicalEventSchema.parse(verifiedEvent);
    expect(result.verificationStatus).toBe('venue_confirmed');
  });

  it('accepts all verification statuses', () => {
    const statuses = [
      'unverified',
      'submitter_verified',
      'community_verified',
      'source_correlated',
      'venue_confirmed',
      'artist_confirmed',
    ] as const;

    for (const status of statuses) {
      const event: CanonicalEvent = {
        ...validEvent,
        verificationStatus: status,
      };
      const result = CanonicalEventSchema.parse(event);
      expect(result.verificationStatus).toBe(status);
    }
  });

  it('enforces entityType is event', () => {
    const invalid = { ...validEvent, entityType: 'artist' };
    expect(() => CanonicalEventSchema.parse(invalid)).toThrow();
  });

  it('allows empty artistIds', () => {
    const eventNoArtists: CanonicalEvent = {
      ...validEvent,
      artistIds: [],
    };
    const result = CanonicalEventSchema.parse(eventNoArtists);
    expect(result.artistIds).toEqual([]);
  });
});

describe('Draft entity creation flow', () => {
  it('creates draft artist from accepted claim', () => {
    const draftArtist: CanonicalArtist = {
      entityId: 'arts_newdrft1',
      entityType: 'artist',
      name: 'Stingray',
      aliases: [],
      status: 'draft',
      evidence: [
        {
          claimId: 'clm_accptd01',
          claimType: 'artist_performs',
          strength: 'moderate',
          linkedAt: '2026-05-03T12:00:00.000Z',
        },
      ],
      createdAt: '2026-05-03T12:00:00.000Z',
      updatedAt: '2026-05-03T12:00:00.000Z',
    };

    const result = CanonicalArtistSchema.parse(draftArtist);
    expect(result.status).toBe('draft');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].claimId).toBe('clm_accptd01');
  });

  it('draft entity can be published', () => {
    const publishedArtist: CanonicalArtist = {
      entityId: 'arts_newdrft1',
      entityType: 'artist',
      name: 'Stingray',
      aliases: [],
      status: 'published',
      evidence: [
        {
          claimId: 'clm_accptd01',
          claimType: 'artist_performs',
          strength: 'moderate',
          linkedAt: '2026-05-03T12:00:00.000Z',
        },
      ],
      createdAt: '2026-05-03T12:00:00.000Z',
      updatedAt: '2026-05-03T12:00:00.000Z',
      publishedAt: '2026-05-03T14:00:00.000Z',
    };

    const result = CanonicalArtistSchema.parse(publishedArtist);
    expect(result.status).toBe('published');
    expect(result.publishedAt).toBe('2026-05-03T14:00:00.000Z');
  });
});
