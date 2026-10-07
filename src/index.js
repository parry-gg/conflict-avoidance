#!/usr/bin/env node
/**
 * parrygg-conflicts: find attendees seeded into brackets of two different events
 * that share a wave, and suggest seed swaps.
 *
 *   npm start -- <tournament-slug | tournament-id> [options]        whole tournament
 *   npm start -- <tournament-slug/event-slug | event-id> [options]  one event's side
 *
 * Options:
 *   --target URL        grpc-web endpoint (default https://grpcweb.parry.gg, env PARRYGG_TARGET)
 *   --api-key KEY       X-API-KEY header (env PARRYGG_API_KEY)
 *   --auth JWT          Authorization: Bearer header (env PARRYGG_AUTH_TOKEN)
 *   --include-projected treat projected (not yet filled) seeds as memberships
 *   --json              emit JSON instead of text
 */
import { createApi, loadTournament, DEFAULT_TARGET } from './client.js';
import { buildIndex, findConflicts } from './conflicts.js';
import { formatText, summarize, toJson } from './format.js';

function parseArgs(argv) {
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--include-projected') opts.includeProjected = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--')) opts[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else opts.positional.push(arg);
  }
  return opts;
}

const usage = `usage: parrygg-conflicts <tournament-slug | tournament-id>              all events
       parrygg-conflicts <tournament-slug/event-slug | event-id>     one event's side
          [--target URL] [--api-key KEY] [--auth JWT] [--include-projected] [--json]

env: PARRYGG_TARGET, PARRYGG_API_KEY, PARRYGG_AUTH_TOKEN`;

const GRPC_STATUS = {
  1: 'CANCELLED', 2: 'UNKNOWN', 3: 'INVALID_ARGUMENT', 4: 'DEADLINE_EXCEEDED', 5: 'NOT_FOUND',
  7: 'PERMISSION_DENIED', 8: 'RESOURCE_EXHAUSTED', 13: 'INTERNAL', 14: 'UNAVAILABLE', 16: 'UNAUTHENTICATED',
};

const opts = parseArgs(process.argv.slice(2));
const ref = opts.positional[0];
if (opts.help || !ref) {
  console.error(usage);
  process.exit(opts.help ? 0 : 2);
}

const api = createApi({
  target: opts.target ?? process.env.PARRYGG_TARGET ?? DEFAULT_TARGET,
  apiKey: opts.apiKey ?? process.env.PARRYGG_API_KEY,
  authToken: opts.auth ?? process.env.PARRYGG_AUTH_TOKEN,
});

try {
  const { tournament, events, scopeEventIds } = await loadTournament(api, ref);
  const index = buildIndex(events, { includeProjected: !!opts.includeProjected });
  const conflicts = findConflicts(index, scopeEventIds);
  const report = { tournament, events, scopeEventIds, conflicts, summary: summarize(index, events) };
  console.log(opts.json ? JSON.stringify(toJson(report), null, 2) : formatText(report));
  process.exit(conflicts.length === 0 ? 0 : 1);
} catch (err) {
  const code = err?.code !== undefined ? ` (${GRPC_STATUS[err.code] ?? `grpc code ${err.code}`})` : '';
  console.error(`error${code}: ${err?.message || 'request failed'}`);
  process.exit(3);
}
