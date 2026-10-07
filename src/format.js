/** Human-readable and JSON renderings of conflicts. */

function place(seed) {
  const wave = seed.waveName ? `wave "${seed.waveName}"` : 'no wave';
  return `${seed.eventName} › ${seed.phaseName} › ${seed.bracketName} (${wave})`;
}

function who(seed) {
  return seed.gamerTags.length > 1 ? `${seed.entrantName} [${seed.gamerTags.join(', ')}]` : seed.gamerTags[0] || seed.entrantName;
}

export function summarize(index, events) {
  const brackets = [...index.bracketsById.values()];
  return {
    events: events.length,
    brackets: brackets.length,
    wavedBrackets: brackets.filter((b) => b.waveId).length,
    seeds: index.seedsById.size,
    users: new Set(index.memberships.map((m) => m.userId)).size,
  };
}

export function formatText({ tournament, events, scopeEventIds, conflicts, summary }) {
  const lines = [];
  const scoped = events.filter((e) => scopeEventIds.includes(e.id));
  lines.push(`Tournament: ${tournament.name}`);
  lines.push(`Events:     ${scoped.map((e) => e.name.trim()).join(', ')}` + (scoped.length < events.length ? '  (reporting this side only)' : ''));
  if (summary) {
    lines.push(
      `Scanned:    ${summary.events} events, ${summary.brackets} brackets ` +
        `(${summary.wavedBrackets} with a wave), ${summary.seeds} seeds, ${summary.users} users`,
    );
  }
  lines.push('');
  if (conflicts.length === 0) {
    lines.push('No wave conflicts found.');
    return lines.join('\n');
  }
  lines.push(`${conflicts.length} wave conflict${conflicts.length === 1 ? '' : 's'} found`);
  lines.push('');

  conflicts.forEach((conflict, i) => {
    const seed = conflict.seed;
    const tags = conflict.users.map((u) => u.gamerTag).join(', ');
    lines.push(`#${i + 1}  ${tags}  — seed ${seed.seedNumber} in ${place(seed)}`);
    for (const other of conflict.collidingSeeds) {
      lines.push(`    conflicts with: seed ${other.seedNumber} in ${place(other)}`);
    }
    const fix = conflict.fix;
    if (fix.type === 'swap') {
      const sameSide = fix.move.seedId === seed.seedId;
      lines.push(
        `    suggested fix:  swap ${who(fix.move)} (seed ${fix.move.seedNumber}, ${fix.move.bracketName})` +
          ` with ${who(fix.with)} (seed ${fix.with.seedNumber}, ${fix.with.bracketName}, ` +
          `${fix.with.waveName ? `wave "${fix.with.waveName}"` : 'no wave'})` +
          (sameSide ? '' : `  [in ${fix.move.eventName}]`),
      );
      lines.push(`                    seed ids: ${fix.move.seedId} <-> ${fix.with.seedId}`);
    } else if (fix.type === 'resolved-by') {
      lines.push(`    suggested fix:  already resolved by the swap in #${fix.conflictIndex + 1}`);
    } else {
      lines.push(`    suggested fix:  ${fix.reason}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

export function toJson({ tournament, events, scopeEventIds, conflicts, summary }) {
  const seedView = (s) => ({
    seedId: s.seedId,
    seed: s.seedNumber,
    entrant: s.entrantName,
    gamerTags: s.gamerTags,
    event: { id: s.eventId, name: s.eventName },
    phase: { id: s.phaseId, name: s.phaseName },
    bracket: { id: s.bracketId, name: s.bracketName, index: s.bracketIndex },
    wave: s.waveId ? { id: s.waveId, name: s.waveName } : null,
  });
  return {
    tournament: { id: tournament.id, name: tournament.name },
    events: events.map((e) => ({ id: e.id, name: e.name, reported: scopeEventIds.includes(e.id) })),
    summary,
    conflicts: conflicts.map((c) => ({
      users: c.users,
      seed: seedView(c.seed),
      conflictsWith: c.collidingSeeds.map(seedView),
      fix:
        c.fix.type === 'swap'
          ? {
              type: 'swap',
              move: seedView(c.fix.move),
              with: seedView(c.fix.with),
              seedIds: { move: c.fix.move.seedId, with: c.fix.with.seedId },
            }
          : c.fix.type === 'resolved-by'
            ? { type: 'resolved-by', conflictIndex: c.fix.conflictIndex }
            : c.fix,
    })),
  };
}
