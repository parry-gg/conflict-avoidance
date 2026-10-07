/**
 * Pure wave-conflict detection and swap suggestion. No network access; operates on
 * the plain-object (`toObject()`) shape of Event messages so it is easy to test.
 *
 * Vocabulary:
 *   membership — one seed in one bracket, from the point of view of one user who is
 *                part of the seeded entrant.
 *   conflict   — a membership whose bracket's wave is also the wave of a bracket the
 *                same user is seeded into in a DIFFERENT event of the tournament.
 *                Conflicts are cross-event by definition; phases of one event are
 *                sequential and never collide.
 */

/**
 * Flattens every event into memberships.
 * @returns {{ memberships: Membership[], seedsById: Map<string, SeedEntry>, bracketsById: Map<string, BracketEntry> }}
 */
export function buildIndex(events, { includeProjected = false } = {}) {
  const memberships = [];
  const seedsById = new Map();
  const bracketsById = new Map();

  for (const event of events) {
    event.phasesList.forEach((phase, phaseIndex) => {
      for (const bracket of phase.bracketsList) {
        const bracketEntry = {
          eventId: event.id,
          eventName: event.name,
          phaseId: phase.id,
          phaseName: phase.name,
          phaseIndex,
          bracketId: bracket.id,
          bracketName: bracket.name,
          bracketIndex: bracket.index,
          waveId: bracket.wave?.id || null,
          waveName: bracket.wave?.name || null,
          seeds: [],
        };
        bracketsById.set(bracket.id, bracketEntry);

        for (const seed of bracket.seedsList) {
          const eventEntrant = seed.eventEntrant ?? (includeProjected ? seed.projectedEventEntrant : undefined);
          if (!eventEntrant?.entrant) continue;
          const users = eventEntrant.entrant.usersList ?? [];
          const seedEntry = {
            ...bracketEntry,
            seeds: undefined,
            seedId: seed.id,
            seedNumber: seed.seed,
            entrantId: eventEntrant.entrant.id,
            entrantName: eventEntrant.name || users.map((u) => u.gamerTag).join(' / '),
            eventSeed: eventEntrant.seed,
            userIds: users.map((u) => u.id),
            gamerTags: users.map((u) => u.gamerTag),
            projected: !seed.eventEntrant,
          };
          delete seedEntry.seeds;
          seedsById.set(seed.id, seedEntry);
          bracketEntry.seeds.push(seedEntry);
          for (const user of users) {
            memberships.push({ userId: user.id, gamerTag: user.gamerTag, seed: seedEntry });
          }
        }
      }
    });
  }
  return { memberships, seedsById, bracketsById };
}

/** Groups memberships by user id. */
function byUser(memberships) {
  const map = new Map();
  for (const m of memberships) {
    if (!map.has(m.userId)) map.set(m.userId, []);
    map.get(m.userId).push(m);
  }
  return map;
}

/**
 * Wave ids an entrant is committed to through brackets other than `excludeBracketId`.
 * Considers every user on the entrant, since a swap moves the whole entrant.
 */
function busyWaves(seedEntry, index, usersIndex, excludeBracketId) {
  const waves = new Set();
  for (const userId of seedEntry.userIds) {
    for (const m of usersIndex.get(userId) ?? []) {
      if (m.seed.bracketId === excludeBracketId) continue;
      if (m.seed.waveId) waves.add(m.seed.waveId);
    }
  }
  return waves;
}

/**
 * Finds cross-event wave conflicts.
 *
 * @param eventIds events to report from, in priority order. A collision between two
 *   events is reported once, anchored on whichever of them comes first in this list,
 *   so passing every event of the tournament yields each conflict exactly once, and
 *   passing a single event yields only that event's side of its conflicts.
 * @returns {Conflict[]} one entry per conflicting seed, listing each affected user and
 *   the other-event brackets they collide with.
 */
export function findConflicts(index, eventIds) {
  const usersIndex = byUser(index.memberships);
  const conflictsBySeed = new Map();
  const rank = new Map(eventIds.map((id, i) => [id, i]));

  for (const [, userMemberships] of usersIndex) {
    const targets = userMemberships.filter((m) => rank.has(m.seed.eventId) && m.seed.waveId);
    for (const target of targets) {
      const collisions = userMemberships.filter(
        (m) => m.seed.eventId !== target.seed.eventId && m.seed.waveId === target.seed.waveId,
      );
      if (collisions.length === 0) continue;
      const targetRank = rank.get(target.seed.eventId);
      if (collisions.some((c) => rank.has(c.seed.eventId) && rank.get(c.seed.eventId) < targetRank)) continue;

      const key = target.seed.seedId;
      if (!conflictsBySeed.has(key)) {
        conflictsBySeed.set(key, { seed: target.seed, users: [], collidingSeeds: new Map() });
      }
      const conflict = conflictsBySeed.get(key);
      conflict.users.push({ userId: target.userId, gamerTag: target.gamerTag });
      for (const c of collisions) conflict.collidingSeeds.set(c.seed.seedId, c.seed);
    }
  }

  const conflicts = [...conflictsBySeed.values()].map((c) => ({
    seed: c.seed,
    users: c.users,
    collidingSeeds: [...c.collidingSeeds.values()],
  }));
  conflicts.sort(
    (a, b) =>
      rank.get(a.seed.eventId) - rank.get(b.seed.eventId) ||
      a.seed.seedNumber - b.seed.seedNumber ||
      a.seed.bracketIndex - b.seed.bracketIndex,
  );

  // Suggestions are made in order and build on each other: a seed that an earlier swap
  // moves is not offered again, and a conflict that an earlier swap already resolves
  // points at that fix instead of proposing a second one.
  const movedBy = new Map();
  conflicts.forEach((conflict, i) => {
    const resolvedBy = earlierFix(conflict, movedBy);
    if (resolvedBy !== undefined) {
      conflict.fix = { type: 'resolved-by', conflictIndex: resolvedBy };
      return;
    }
    conflict.fix = suggestFix(conflict, index, usersIndex, new Set(movedBy.keys()));
    if (conflict.fix.type === 'swap') {
      movedBy.set(conflict.fix.move.seedId, i);
      movedBy.set(conflict.fix.with.seedId, i);
    }
  });
  return conflicts;
}

/**
 * Looks for a seed in a sibling bracket (same phase) that `seedEntry` could swap with
 * without creating a new wave conflict for either entrant.
 */
export function findSwap(seedEntry, index, usersIndex, excludeSeedIds = new Set()) {
  const ownBusy = busyWaves(seedEntry, index, usersIndex, seedEntry.bracketId);
  let best = null;

  for (const bracket of index.bracketsById.values()) {
    if (bracket.phaseId !== seedEntry.phaseId || bracket.bracketId === seedEntry.bracketId) continue;
    if (bracket.waveId && ownBusy.has(bracket.waveId)) continue;

    for (const candidate of bracket.seeds) {
      if (candidate.projected || candidate.entrantId === seedEntry.entrantId) continue;
      if (excludeSeedIds.has(candidate.seedId)) continue;
      const candidateBusy = busyWaves(candidate, index, usersIndex, candidate.bracketId);
      if (seedEntry.waveId && candidateBusy.has(seedEntry.waveId)) continue;

      const distance = Math.abs(candidate.seedNumber - seedEntry.seedNumber);
      const unscheduledPenalty = bracket.waveId ? 0 : 1;
      const score = [unscheduledPenalty, distance, candidate.bracketIndex];
      if (!best || compare(score, best.score) < 0) best = { candidate, score };
    }
  }
  return best?.candidate ?? null;
}

/** Index of the earlier conflict whose swap already resolves this one, if any. */
function earlierFix(conflict, movedBy) {
  if (movedBy.has(conflict.seed.seedId)) return movedBy.get(conflict.seed.seedId);
  if (conflict.collidingSeeds.every((s) => movedBy.has(s.seedId))) {
    return Math.max(...conflict.collidingSeeds.map((s) => movedBy.get(s.seedId)));
  }
  return undefined;
}

function compare(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Suggests a fix: first a swap inside the target event's bracket, then a swap on the
 * other side of the collision, otherwise a manual note.
 */
export function suggestFix(conflict, index, usersIndex = byUser(index.memberships), excludeSeedIds = new Set()) {
  const own = findSwap(conflict.seed, index, usersIndex, excludeSeedIds);
  if (own) return { type: 'swap', move: conflict.seed, with: own };

  for (const other of conflict.collidingSeeds) {
    if (excludeSeedIds.has(other.seedId)) continue;
    const swap = findSwap(other, index, usersIndex, excludeSeedIds);
    if (swap) return { type: 'swap', move: other, with: swap };
  }

  return {
    type: 'manual',
    reason:
      'No sibling-bracket seed can be swapped without creating another wave conflict. ' +
      'Move one of the brackets to a different wave or re-seed manually.',
  };
}

/**
 * @typedef {object} SeedEntry
 * @property {string} eventId
 * @property {string} eventName
 * @property {string} phaseId
 * @property {string} phaseName
 * @property {number} phaseIndex
 * @property {string} bracketId
 * @property {string} bracketName
 * @property {number} bracketIndex
 * @property {string|null} waveId
 * @property {string|null} waveName
 * @property {string} seedId
 * @property {number} seedNumber
 * @property {string} entrantId
 * @property {string} entrantName
 * @property {number} eventSeed
 * @property {string[]} userIds
 * @property {string[]} gamerTags
 * @property {boolean} projected
 *
 * @typedef {{ userId: string, gamerTag: string, seed: SeedEntry }} Membership
 * @typedef {{ seed: SeedEntry, users: {userId: string, gamerTag: string}[], collidingSeeds: SeedEntry[], fix?: object }} Conflict
 */
