import { z } from 'zod';
import { StrengthSchema } from './claim';

export const EntityStatusSchema = z.enum(['draft', 'published', 'merged', 'archived']);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

export const EntityTypeSchema = z.enum(['artist', 'venue', 'event']);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const EvidenceLinkSchema = z.object({
  claimId: z.string().regex(/^clm_[a-zA-Z0-9]{8}$/),
  claimType: z.string(),
  strength: StrengthSchema,
  linkedAt: z.string().datetime(),
});
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;

export const SocialLinksSchema = z.object({
  facebook: z.string().url().optional(),
  instagram: z.string().url().optional(),
  twitter: z.string().url().optional(),
  tiktok: z.string().url().optional(),
}).partial();
export type SocialLinks = z.infer<typeof SocialLinksSchema>;

export const MusicLinksSchema = z.object({
  spotify: z.string().url().optional(),
  appleMusic: z.string().url().optional(),
  bandcamp: z.string().url().optional(),
  soundcloud: z.string().url().optional(),
  youtube: z.string().url().optional(),
}).partial();
export type MusicLinks = z.infer<typeof MusicLinksSchema>;

export const ArtistTypeSchema = z.enum([
  'solo',
  'band',
  'duo',
  'dj',
  'collective',
  'orchestra',
  'choir',
  'other',
]);
export type ArtistType = z.infer<typeof ArtistTypeSchema>;

export const CanonicalArtistSchema = z.object({
  entityId: z.string().regex(/^arts_[a-zA-Z0-9]{8}$/),
  entityType: z.literal('artist'),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  status: EntityStatusSchema,
  evidence: z.array(EvidenceLinkSchema).min(1),

  // Optional profile fields
  artistType: ArtistTypeSchema.optional(),
  genres: z.array(z.string()).optional(),
  bio: z.string().optional(),
  hometown: z.string().optional(),
  formedYear: z.number().int().positive().optional(),
  memberCount: z.number().int().positive().optional(),

  // Links
  website: z.string().url().optional(),
  socialLinks: SocialLinksSchema.optional(),
  musicLinks: MusicLinksSchema.optional(),

  // Media
  imageUrl: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().optional(),

  // Merge tracking
  mergedInto: z.string().regex(/^arts_[a-zA-Z0-9]{8}$/).optional(),
  mergedAt: z.string().datetime().optional(),
});
export type CanonicalArtist = z.infer<typeof CanonicalArtistSchema>;

export const VenueTypeSchema = z.enum([
  'bar',
  'pub',
  'club',
  'theatre',
  'concert_hall',
  'cafe',
  'restaurant',
  'outdoor',
  'warehouse',
  'community_space',
  'church',
  'other',
]);
export type VenueType = z.infer<typeof VenueTypeSchema>;

export const AddressSchema = z.object({
  line1: z.string(),
  line2: z.string().optional(),
  city: z.string(),
  region: z.string().optional(),
  postcode: z.string(),
  country: z.string(),
});
export type Address = z.infer<typeof AddressSchema>;

export const CoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;

export const CanonicalVenueSchema = z.object({
  entityId: z.string().regex(/^vnue_[a-zA-Z0-9]{8}$/),
  entityType: z.literal('venue'),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  status: EntityStatusSchema,
  evidence: z.array(EvidenceLinkSchema).min(1),

  // Location
  address: AddressSchema.optional(),
  coordinates: CoordinatesSchema.optional(),

  // Venue details
  venueType: VenueTypeSchema.optional(),
  capacity: z.number().int().positive().optional(),
  genres: z.array(z.string()).optional(),
  description: z.string().optional(),

  // Contact
  website: z.string().url().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  socialLinks: SocialLinksSchema.optional(),

  // Media
  imageUrl: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().optional(),

  // Merge tracking
  mergedInto: z.string().regex(/^vnue_[a-zA-Z0-9]{8}$/).optional(),
  mergedAt: z.string().datetime().optional(),
});
export type CanonicalVenue = z.infer<typeof CanonicalVenueSchema>;

export const EventStatusSchema = z.enum([
  'confirmed',
  'tentative',
  'cancelled',
  'postponed',
  'sold_out',
  'past',
]);
export type EventStatus = z.infer<typeof EventStatusSchema>;

// Verification status tracks trust level, separate from existence
// A single signal can create an event - what changes is verification level
export const VerificationStatusSchema = z.enum([
  'unverified',          // Unknown submitter, no corroboration
  'submitter_verified',  // Submitter has verified account
  'community_verified',  // Multiple users confirm
  'source_correlated',   // Found on external source
  'venue_confirmed',     // Venue owner/rep confirmed
  'artist_confirmed',    // Artist/band confirmed
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const EventTypeSchema = z.enum([
  'gig',
  'club_night',
  'festival',
  'open_mic',
  'acoustic',
  'dj_set',
  'jam_session',
  'album_launch',
  'residency',
  'other',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventPricingSchema = z.object({
  isFree: z.boolean(),
  currency: z.string().optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  priceNote: z.string().optional(),
});
export type EventPricing = z.infer<typeof EventPricingSchema>;

export const CanonicalEventSchema = z.object({
  entityId: z.string().regex(/^evnt_[a-zA-Z0-9]{8}$/),
  entityType: z.literal('event'),
  name: z.string().min(1),
  status: EntityStatusSchema,
  evidence: z.array(EvidenceLinkSchema).min(1),

  // When
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  doorsTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().optional(),

  // Where
  venueId: z.string().regex(/^vnue_[a-zA-Z0-9]{8}$/),

  // Who
  artistIds: z.array(z.string().regex(/^arts_[a-zA-Z0-9]{8}$/)),

  // What
  description: z.string().optional(),
  genres: z.array(z.string()).optional(),
  eventType: EventTypeSchema.optional(),
  ageRestriction: z.enum(['18+', '21+', 'all_ages']).optional(),

  // Tickets
  ticketUrl: z.string().url().optional(),
  infoUrl: z.string().url().optional(),
  pricing: EventPricingSchema.optional(),

  // Event lifecycle status (different from entity status)
  eventStatus: EventStatusSchema.optional(),

  // Trust level - separate from existence
  // A single signal can create an event; verification tracks confidence
  verificationStatus: VerificationStatusSchema.optional(),

  // Media
  imageUrl: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().optional(),

  // Merge tracking
  mergedInto: z.string().regex(/^evnt_[a-zA-Z0-9]{8}$/).optional(),
  mergedAt: z.string().datetime().optional(),
});
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

export type CanonicalEntity = CanonicalArtist | CanonicalVenue | CanonicalEvent;
