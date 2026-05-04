import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema for Claude's structured output - matching the one in index.ts
const LLMClaimSchema = z.object({
  type: z.enum([
    'event_exists',
    'artist_performs',
    'venue_hosts',
    'event_date',
    'event_time',
    'ticket_source',
    'artist_exists',
    'venue_exists',
  ]),
  subject: z.string(),
  predicate: z.string(),
  object: z.string().optional(),
  value: z.string().optional(),
  strength: z.enum(['weak', 'moderate', 'strong']),
  reasoning: z.string(),
});

const LLMEventCandidateSchema = z.object({
  proposedName: z.string(),
  proposedDate: z.string().optional(),
  proposedTime: z.string().optional(),
  proposedVenueName: z.string().optional(),
  proposedArtistNames: z.array(z.string()),
  reasoning: z.string(),
  ambiguities: z.array(z.string()),
  sourceClaimRefs: z.array(z.string()),
});

const LLMClarificationQuestionSchema = z.object({
  questionType: z.enum([
    'entity_match',
    'date_confirm',
    'venue_location',
    'artist_identity',
  ]),
  question: z.string(),
  options: z.array(z.string()).optional(),
  relatedClaimTypes: z.array(z.string()),
});

const LLMOutputSchema = z.object({
  summary: z.string(),
  claims: z.array(LLMClaimSchema),
  eventCandidates: z.array(LLMEventCandidateSchema).optional(),
  clarificationQuestions: z.array(LLMClarificationQuestionSchema).optional(),
  uncertainties: z.array(z.string()),
});

describe('LLMClaimSchema', () => {
  describe('predicate requirement', () => {
    it('should require predicate on event_exists claims', () => {
      const validClaim = {
        type: 'event_exists',
        subject: 'Stingray Live',
        predicate: 'exists',
        object: 'Live music event',
        strength: 'moderate',
        reasoning: 'Event announcement',
      };
      expect(() => LLMClaimSchema.parse(validClaim)).not.toThrow();
    });

    it('should reject event_exists claims without predicate', () => {
      const invalidClaim = {
        type: 'event_exists',
        subject: 'Stingray Live',
        object: 'Live music event',
        strength: 'moderate',
        reasoning: 'Event announcement',
      };
      expect(() => LLMClaimSchema.parse(invalidClaim)).toThrow();
    });

    it('should require predicate on artist_exists claims', () => {
      const validClaim = {
        type: 'artist_exists',
        subject: 'Metallica',
        predicate: 'is_artist',
        object: 'Heavy metal band',
        strength: 'strong',
        reasoning: 'Well-known band',
      };
      expect(() => LLMClaimSchema.parse(validClaim)).not.toThrow();
    });

    it('should reject artist_exists claims without predicate', () => {
      const invalidClaim = {
        type: 'artist_exists',
        subject: 'Metallica',
        object: 'Heavy metal band',
        strength: 'strong',
        reasoning: 'Well-known band',
      };
      expect(() => LLMClaimSchema.parse(invalidClaim)).toThrow();
    });

    it('should require predicate on venue_exists claims', () => {
      const validClaim = {
        type: 'venue_exists',
        subject: 'Wembley Stadium',
        predicate: 'is_venue',
        object: 'London, UK',
        strength: 'strong',
        reasoning: 'Famous venue',
      };
      expect(() => LLMClaimSchema.parse(validClaim)).not.toThrow();
    });

    it('should reject venue_exists claims without predicate', () => {
      const invalidClaim = {
        type: 'venue_exists',
        subject: 'Wembley Stadium',
        object: 'London, UK',
        strength: 'strong',
        reasoning: 'Famous venue',
      };
      expect(() => LLMClaimSchema.parse(invalidClaim)).toThrow();
    });

    it('should require predicate on artist_performs claims', () => {
      const validClaim = {
        type: 'artist_performs',
        subject: 'Stingray',
        predicate: 'performs_at',
        object: 'The Rigger',
        strength: 'moderate',
        reasoning: 'Artist name in event title',
      };
      expect(() => LLMClaimSchema.parse(validClaim)).not.toThrow();
    });

    it('should require predicate on venue_hosts claims', () => {
      const validClaim = {
        type: 'venue_hosts',
        subject: 'The Rigger',
        predicate: 'hosts',
        object: 'Stingray Live',
        strength: 'moderate',
        reasoning: 'Venue name stated',
      };
      expect(() => LLMClaimSchema.parse(validClaim)).not.toThrow();
    });

    it('should require predicate on event_date claims', () => {
      const validClaim = {
        type: 'event_date',
        subject: 'Stingray Live',
        predicate: 'on_date',
        value: '2026-05-15',
        strength: 'weak',
        reasoning: 'Year inferred',
      };
      expect(() => LLMClaimSchema.parse(validClaim)).not.toThrow();
    });

    it('should require predicate on event_time claims', () => {
      const validClaim = {
        type: 'event_time',
        subject: 'Stingray Live',
        predicate: 'at_time',
        value: '20:00',
        strength: 'strong',
        reasoning: 'Time explicitly stated',
      };
      expect(() => LLMClaimSchema.parse(validClaim)).not.toThrow();
    });
  });
});

describe('LLMOutputSchema', () => {
  it('should parse valid complete output with all claim types', () => {
    const validOutput = {
      summary: 'Metallica concert at Wembley Stadium',
      claims: [
        {
          type: 'event_exists',
          subject: 'Metallica at Wembley',
          predicate: 'exists',
          object: 'Concert',
          strength: 'strong',
          reasoning: 'Clear announcement',
        },
        {
          type: 'artist_exists',
          subject: 'Metallica',
          predicate: 'is_artist',
          object: 'Heavy metal band',
          strength: 'strong',
          reasoning: 'Well-known band',
        },
        {
          type: 'venue_exists',
          subject: 'Wembley Stadium',
          predicate: 'is_venue',
          object: 'London, UK',
          strength: 'strong',
          reasoning: 'Famous venue',
        },
        {
          type: 'artist_performs',
          subject: 'Metallica',
          predicate: 'performs_at',
          object: 'Wembley Stadium',
          strength: 'strong',
          reasoning: 'Artist headlining',
        },
        {
          type: 'venue_hosts',
          subject: 'Wembley Stadium',
          predicate: 'hosts',
          object: 'Metallica concert',
          strength: 'strong',
          reasoning: 'Venue stated',
        },
        {
          type: 'event_date',
          subject: 'Metallica at Wembley',
          predicate: 'on_date',
          value: '2026-05-15',
          strength: 'strong',
          reasoning: 'Date explicitly stated',
        },
        {
          type: 'event_time',
          subject: 'Metallica at Wembley',
          predicate: 'at_time',
          value: '19:30',
          strength: 'strong',
          reasoning: 'Time stated as 7:30PM',
        },
      ],
      eventCandidates: [
        {
          proposedName: 'Metallica at Wembley Stadium',
          proposedDate: '2026-05-15',
          proposedTime: '19:30',
          proposedVenueName: 'Wembley Stadium',
          proposedArtistNames: ['Metallica'],
          reasoning: 'Complete event announcement',
          ambiguities: [],
          sourceClaimRefs: ['event_exists', 'event_date', 'event_time'],
        },
      ],
      clarificationQuestions: [],
      uncertainties: [],
    };

    expect(() => LLMOutputSchema.parse(validOutput)).not.toThrow();
    const parsed = LLMOutputSchema.parse(validOutput);
    expect(parsed.claims).toHaveLength(7);
    expect(parsed.eventCandidates).toHaveLength(1);
  });

  it('should reject output with claims missing predicate', () => {
    const invalidOutput = {
      summary: 'Metallica concert',
      claims: [
        {
          type: 'event_exists',
          subject: 'Metallica at Wembley',
          predicate: 'exists',
          object: 'Concert',
          strength: 'strong',
          reasoning: 'Clear announcement',
        },
        {
          // Missing predicate - should fail
          type: 'artist_exists',
          subject: 'Metallica',
          object: 'Heavy metal band',
          strength: 'strong',
          reasoning: 'Well-known band',
        },
      ],
      uncertainties: [],
    };

    expect(() => LLMOutputSchema.parse(invalidOutput)).toThrow();
  });
});
