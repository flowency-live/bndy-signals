/**
 * Resolution Module
 *
 * Entity resolution for the source runner.
 */

export {
  SourceStateStore,
  SourceStateEntry,
  ResolutionMethod,
  InMemorySourceStateStore,
} from './SourceStateStore';

export { resolveVenue, VenueResolutionResult, ResolveVenueOptions } from './resolveVenue';

export { resolveArtist, ArtistResolutionResult, ResolveArtistOptions } from './resolveArtist';

export {
  resolveEntities,
  ResolveEntitiesOptions,
  ResolveEntitiesResult,
} from './resolveEntities';
