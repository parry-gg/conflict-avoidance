# parrygg-conflict-avoidance

Finds attendees of a parry.gg tournament who are seeded into brackets of two different
events that share a wave (so they would be expected in two pools at once), and
suggests a seed swap that resolves each collision.

Conflicts are cross-event by definition: phases within one event run in sequence and
are never treated as colliding.

Talks to the backend through the public grpc-web API using the generated
`@parry-gg/parrygg-client` stubs (same client the apps use).

## Setup

```sh
npm install   # @parry-gg/parrygg-client comes from GitHub Packages; needs a token for npm.pkg.github.com in ~/.npmrc
```

## Usage

```sh
npm start -- <tournament-slug | tournament-id> [options]              # every event, each collision once
npm start -- <tournament-slug/event-slug | event-id> [options]        # one event's side of its collisions

# examples
npm start -- the-big-house-13 --api-key $PARRYGG_API_KEY
npm start -- the-big-house-13/melee-singles --auth "$JWT" --json
npm start -- my-tourney --target http://localhost:9090
```

A bare UUID is tried as a tournament id first, then as an event id. Scoping to one
event only changes which side of a collision is reported and which event the swap is
proposed in; every event of the tournament is always scanned.

| option | env | meaning |
| --- | --- | --- |
| `--target URL` | `PARRYGG_TARGET` | grpc-web endpoint, default `https://grpcweb.parry.gg` |
| `--api-key KEY` | `PARRYGG_API_KEY` | sent as `X-API-KEY` |
| `--auth JWT` | `PARRYGG_AUTH_TOKEN` | sent as `Authorization: Bearer` |
| `--include-projected` | | also treat projected (not yet filled) seeds as memberships |
| `--json` | | machine-readable output |

Auth is needed when the tournament's brackets are hidden from the public.

Exit code is `0` when there are no conflicts, `1` when conflicts were found, `3` on error.

## What it does

1. `TournamentService.GetTournament` to list the tournament's events.
2. `EventService.GetEvent` (bracket summary view) for every event, which includes
   phases, brackets, seeds with entrants, and each bracket's wave.
3. For every user, flags each pair of brackets in different events whose wave id
   matches. In tournament mode each collision is reported once, anchored on the
   event that comes first in the tournament's event list.
4. Suggests a fix: swap the entrant with the closest-seeded entrant in a sibling bracket
   of the same phase whose wave the entrant is free in, and whose own entrant is free in
   the vacated wave. If nothing works on the reported event's side it tries the other
   event, otherwise it reports that a manual change is needed. Each swap is printed
   with the `SeedService.SwapSeeds` ids needed to apply it.
5. Suggestions are made in seed order and build on each other: a seed moved by an
   earlier swap is not offered again, and a conflict that an earlier swap already
   resolves says so instead of proposing a second swap. Applying the swaps top to
   bottom therefore leaves no conflicts behind.

## Example output

```
Tournament: The Big House 13
Events:     Melee Singles, Ultimate Singles
Scanned:    2 events, 24 brackets (24 with a wave), 190 seeds, 150 users

1 wave conflict found

#1  Mango  — seed 1 in Melee Singles › Pools › Pool A1 (wave "Wave A")
    conflicts with: seed 3 in Ultimate Singles › Pools › Pool B1 (wave "Wave A")
    suggested fix:  swap Mango (seed 1, Pool A1) with Zain (seed 2, Pool A2, wave "Wave B")
                    SeedService.SwapSeeds source_seed_id=... target_seed_id=...
```

## Tests

```sh
npm test
```
