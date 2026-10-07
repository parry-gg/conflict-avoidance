/**
 * Thin wrapper over the generated @parry-gg/client grpc-web stubs
 * (https://github.com/parry-gg/client).
 *
 * Everything is returned as plain objects (google-protobuf `toObject()` shape:
 * camelCase fields, repeated fields suffixed with `List`).
 */
import {
  EventServiceClient,
  TournamentServiceClient,
  GetEventRequest,
  GetEventOptions,
  EventView,
  EventIdentifier,
  EventSlugPath,
  GetTournamentRequest,
} from '@parry-gg/client';
import { installXhr } from './xhr.js';

// Must run before the first request; grpc-web resolves XMLHttpRequest at call time.
installXhr();

export const DEFAULT_TARGET = 'https://grpcweb.parry.gg';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 5;

/**
 * @param {object} opts
 * @param {string} [opts.target] grpc-web base URL
 * @param {string} [opts.apiKey] value for the X-API-KEY header
 * @param {string} [opts.authToken] bearer JWT for the Authorization header
 */
export function createApi({ target = DEFAULT_TARGET, apiKey, authToken } = {}) {
  const metadata = {};
  if (apiKey) metadata['X-API-KEY'] = apiKey;
  if (authToken) metadata.Authorization = `Bearer ${authToken}`;

  const events = new EventServiceClient(target);
  const tournaments = new TournamentServiceClient(target);

  /** Builds an EventIdentifier from a UUID or a `tournament-slug/event-slug` path. */
  function eventIdentifier(ref) {
    const identifier = new EventIdentifier();
    if (ref.includes('/')) {
      const [tournamentSlug, eventSlug] = ref.split('/');
      const path = new EventSlugPath();
      path.setTournamentSlug(tournamentSlug);
      path.setEventSlug(eventSlug);
      identifier.setEventSlugPath(path);
    } else {
      identifier.setId(ref);
    }
    return identifier;
  }

  return {
    target,

    /** Fetches an event with its phases, brackets, seeds and waves. */
    async getEvent(ref) {
      const options = new GetEventOptions();
      options.setEventView(EventView.EVENT_VIEW_BRACKET_SUMMARY);
      const request = new GetEventRequest();
      request.setIdentifier(eventIdentifier(ref));
      request.setOptions(options);
      const response = await events.getEvent(request, metadata);
      const event = response.toObject().event;
      if (!event) throw new Error(`Event not found: ${ref}`);
      return event;
    },

    /** Fetches a tournament by UUID or slug; the events list carries the event ids. */
    async getTournament(ref) {
      const request = new GetTournamentRequest();
      if (UUID.test(ref)) request.setId(ref);
      else request.setTournamentSlug(ref);
      const response = await tournaments.getTournament(request, metadata);
      const tournament = response.toObject().tournament;
      if (!tournament) throw new Error(`Tournament not found: ${ref}`);
      return tournament;
    },
  };
}

/**
 * Loads every event of a tournament with full bracket data.
 *
 * `ref` is a tournament slug or id (scan the whole tournament), or an event
 * `tournament-slug/event-slug` path or event id (report that event's side only).
 * A bare UUID is tried as a tournament first, then as an event.
 *
 * @returns {{ tournament, events, scopeEventIds: string[] }} scopeEventIds lists the
 *   events to report from, in the tournament's event order.
 */
export async function loadTournament(api, ref) {
  let tournament;
  let scopedEvent;
  if (ref.includes('/')) {
    scopedEvent = await api.getEvent(ref);
  } else {
    try {
      tournament = await api.getTournament(ref);
    } catch (err) {
      if (err?.code !== NOT_FOUND || !UUID.test(ref)) throw err;
      scopedEvent = await api.getEvent(ref);
    }
  }
  tournament ??= await api.getTournament(scopedEvent.tournamentId);

  const events = await Promise.all(
    tournament.eventsList.map((e) => (scopedEvent && e.id === scopedEvent.id ? scopedEvent : api.getEvent(e.id))),
  );
  const scopeEventIds = scopedEvent ? [scopedEvent.id] : events.map((e) => e.id);
  return { tournament, events, scopeEventIds };
}
