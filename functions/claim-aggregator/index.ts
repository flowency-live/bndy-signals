import { customAlphabet } from 'nanoid';
import {
  Claim,
  ClaimType,
  EventCandidate,
  ClaimReference,
  Ambiguity,
  Completeness,
  CandidateVerificationStatus,
} from '../shared/entities';

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 8);

export interface EntityCandidate {
  entityId: string;
  name: string;
  location?: string;
}

export interface ResolvedEntity {
  claimId: string;
  entityType: 'artist' | 'venue';
  action: 'created' | 'linked' | 'candidates';
  entityId?: string;
  candidates?: EntityCandidate[];
}

export interface AggregatorInput {
  signalId: string;
  interpretationId: string;
  claims: Claim[];
  resolvedEntities: ResolvedEntity[];
  uncertainties: string[];
  submitterId?: string;
  isTrustedSubmitter?: boolean;
}

const EVENT_RELATED_CLAIM_TYPES: ClaimType[] = [
  'event_exists',
  'event_date',
  'event_time',
  'artist_performs',
  'venue_hosts',
];

export function isEventRelatedClaim(claimType: ClaimType): boolean {
  return EVENT_RELATED_CLAIM_TYPES.includes(claimType);
}

export function calculateEventCompleteness(fields: {
  proposedName?: string;
  proposedDate?: string;
  proposedVenueId?: string;
  proposedArtistIds?: string[];
}): { completeness: Completeness; missingFields: string[] } {
  const missingFields: string[] = [];

  if (!fields.proposedName) {
    missingFields.push('name');
  }
  if (!fields.proposedDate) {
    missingFields.push('date');
  }
  if (!fields.proposedVenueId) {
    missingFields.push('venue');
  }
  if (!fields.proposedArtistIds || fields.proposedArtistIds.length === 0) {
    missingFields.push('artists');
  }

  return {
    completeness: missingFields.length === 0 ? 'complete' : 'partial',
    missingFields,
  };
}

export function detectAmbiguities(
  resolvedEntities: ResolvedEntity[],
  uncertainties: string[]
): Ambiguity[] {
  const ambiguities: Ambiguity[] = [];

  // Check for entity match ambiguities
  for (const resolved of resolvedEntities) {
    if (resolved.action === 'candidates' && resolved.candidates && resolved.candidates.length > 1) {
      const locations = resolved.candidates
        .map((c) => c.location)
        .filter(Boolean)
        .join(', ');

      ambiguities.push({
        ambiguityType: 'entity_match',
        description: `Multiple ${resolved.entityType}s match: ${locations || 'multiple matches found'}`,
        affectedClaimIds: [resolved.claimId],
        suggestedResolution: 'Ask user to select the correct entity',
      });
    }
  }

  // Check for date uncertainties
  for (const uncertainty of uncertainties) {
    if (
      uncertainty.toLowerCase().includes('year') ||
      uncertainty.toLowerCase().includes('date') ||
      uncertainty.toLowerCase().includes('inferred')
    ) {
      ambiguities.push({
        ambiguityType: 'date_uncertain',
        description: uncertainty,
        affectedClaimIds: [],
        suggestedResolution: 'Confirm date with user',
      });
    }
  }

  return ambiguities;
}

export function groupClaimsIntoEventCandidate(input: AggregatorInput): EventCandidate | null {
  const { signalId, interpretationId, claims, resolvedEntities, uncertainties, submitterId, isTrustedSubmitter } = input;

  // Filter for event-related claims
  const eventClaims = claims.filter((c) => isEventRelatedClaim(c.claimType));

  if (eventClaims.length === 0) {
    return null;
  }

  // Find event_exists claim - required for event creation
  const eventExistsClaim = eventClaims.find((c) => c.claimType === 'event_exists');
  if (!eventExistsClaim) {
    return null;
  }

  // Extract event details from claims
  const eventDateClaim = eventClaims.find((c) => c.claimType === 'event_date');
  const eventTimeClaim = eventClaims.find((c) => c.claimType === 'event_time');
  const venueHostsClaims = eventClaims.filter((c) => c.claimType === 'venue_hosts');
  const artistPerformsClaims = eventClaims.filter((c) => c.claimType === 'artist_performs');

  // Build resolved entity lookup
  const resolvedByClaimId = new Map<string, ResolvedEntity>();
  for (const resolved of resolvedEntities) {
    resolvedByClaimId.set(resolved.claimId, resolved);
  }

  // Find venue ID from resolved entities
  let proposedVenueId: string | undefined;
  for (const venueClaim of venueHostsClaims) {
    const resolved = resolvedByClaimId.get(venueClaim.claimId);
    if (resolved && resolved.action !== 'candidates' && resolved.entityId) {
      proposedVenueId = resolved.entityId;
      break;
    }
  }

  // Find artist IDs from resolved entities
  const proposedArtistIds: string[] = [];
  for (const artistClaim of artistPerformsClaims) {
    const resolved = resolvedByClaimId.get(artistClaim.claimId);
    if (resolved && resolved.action !== 'candidates' && resolved.entityId) {
      proposedArtistIds.push(resolved.entityId);
    }
  }

  // Calculate completeness
  const { completeness, missingFields } = calculateEventCompleteness({
    proposedName: eventExistsClaim.subject,
    proposedDate: eventDateClaim?.value,
    proposedVenueId,
    proposedArtistIds,
  });

  // Detect ambiguities
  const ambiguities = detectAmbiguities(resolvedEntities, uncertainties);

  // Build source claims
  const sourceClaims: ClaimReference[] = eventClaims.map((claim) => ({
    claimId: claim.claimId,
    claimType: claim.claimType,
    value: claim.value || claim.object || claim.subject,
    status: claim.status === 'accepted' ? 'accepted' : claim.status === 'challenged' ? 'challenged' : 'proposed',
  }));

  // Determine verification status
  const verificationStatus: CandidateVerificationStatus = isTrustedSubmitter
    ? 'submitter_verified'
    : 'unverified';

  const now = new Date().toISOString();

  const candidate: EventCandidate = {
    candidateId: `cand_${nanoid()}`,
    candidateType: 'event',
    signalId,
    interpretationId,

    proposedName: eventExistsClaim.subject,
    proposedDate: eventDateClaim?.value,
    proposedTime: eventTimeClaim?.value,
    proposedVenueId,
    proposedArtistIds,

    sourceClaims,

    completeness,
    missingFields,

    ambiguities,

    verificationStatus,
    submitterId: isTrustedSubmitter ? submitterId : undefined,

    status: 'proposed',
    createdAt: now,
    updatedAt: now,
  };

  return candidate;
}

export function generateCandidateId(): string {
  return `cand_${nanoid()}`;
}
