import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, findConflicts } from '../src/conflicts.js';

const WAVE_A = { id: 'wave-a', name: 'Wave A' };
const WAVE_B = { id: 'wave-b', name: 'Wave B' };
const WAVE_C = { id: 'wave-c', name: 'Wave C' };

let seedCounter = 0;
function seed(number, user, { projected = false } = {}) {
  const entrant = { id: `entrant-${user}`, usersList: [{ id: `user-${user}`, gamerTag: user }] };
  const eventEntrant = { id: `ee-${user}`, name: user, entrant, seed: number };
  return {
    id: `seed-${++seedCounter}`,
    seed: number,
    bracketIndex: 0,
    ...(projected ? { projectedEventEntrant: eventEntrant } : { eventEntrant }),
  };
}

function bracket(id, name, index, wave, seeds) {
  return { id, name, index, wave, seedsList: seeds };
}

function event(id, name, brackets) {
  return { id, name, phasesList: [{ id: `${id}-pools`, name: 'Pools', bracketsList: brackets }] };
}

test('reports a user whose brackets in two events share a wave and suggests a swap', () => {
  const melee = event('melee', 'Melee Singles', [
    bracket('m-a1', 'Pool A1', 0, WAVE_A, [seed(1, 'Mango'), seed(8, 'Axe')]),
    bracket('m-a2', 'Pool A2', 1, WAVE_B, [seed(2, 'Zain'), seed(7, 'Plup')]),
  ]);
  const ultimate = event('ult', 'Ultimate Singles', [
    bracket('u-b1', 'Pool B1', 0, WAVE_A, [seed(3, 'Mango')]),
  ]);

  const conflicts = findConflicts(buildIndex([melee, ultimate]), ['melee']);

  assert.equal(conflicts.length, 1);
  const [conflict] = conflicts;
  assert.deepEqual(conflict.users.map((u) => u.gamerTag), ['Mango']);
  assert.equal(conflict.seed.bracketName, 'Pool A1');
  assert.equal(conflict.seed.seedNumber, 1);
  assert.equal(conflict.collidingSeeds[0].eventName, 'Ultimate Singles');
  assert.equal(conflict.fix.type, 'swap');
  assert.equal(conflict.fix.move.entrantName, 'Mango');
  assert.equal(conflict.fix.with.entrantName, 'Zain', 'closest seed in a bracket on a free wave');
});

test('does not suggest a swap partner who would inherit the conflict', () => {
  const melee = event('melee', 'Melee Singles', [
    bracket('m-a1', 'Pool A1', 0, WAVE_A, [seed(1, 'Mango')]),
    bracket('m-a2', 'Pool A2', 1, WAVE_B, [seed(2, 'Zain'), seed(3, 'Plup')]),
  ]);
  const ultimate = event('ult', 'Ultimate Singles', [
    bracket('u-b1', 'Pool B1', 0, WAVE_A, [seed(1, 'Mango'), seed(2, 'Zain')]),
  ]);

  const [conflict] = findConflicts(buildIndex([melee, ultimate]), ['melee']);
  assert.equal(conflict.fix.type, 'swap');
  assert.equal(conflict.fix.with.entrantName, 'Plup', 'Zain is busy in Wave A too');
});

test('skips sibling brackets whose wave the entrant is already busy in', () => {
  const melee = event('melee', 'Melee Singles', [
    bracket('m-a1', 'Pool A1', 0, WAVE_A, [seed(1, 'Mango')]),
    bracket('m-a2', 'Pool A2', 1, WAVE_B, [seed(2, 'Zain')]),
  ]);
  const ultimate = event('ult', 'Ultimate Singles', [
    bracket('u-b1', 'Pool B1', 0, WAVE_A, [seed(1, 'Mango')]),
    bracket('u-b2', 'Pool B2', 1, WAVE_C, [seed(2, 'Zain')]),
  ]);
  const doubles = event('dbl', 'Melee Doubles', [
    bracket('d-c1', 'Pool C1', 0, WAVE_B, [seed(1, 'Mango')]),
  ]);

  const [conflict] = findConflicts(buildIndex([melee, ultimate, doubles]), ['melee']);
  assert.equal(conflict.fix.type, 'swap');
  assert.equal(conflict.fix.move.eventName, 'Ultimate Singles', 'falls back to the other side');
  assert.equal(conflict.fix.with.entrantName, 'Zain');
});

test('returns a manual note when no swap is possible', () => {
  const melee = event('melee', 'Melee Singles', [bracket('m-a1', 'Pool A1', 0, WAVE_A, [seed(1, 'Mango')])]);
  const ultimate = event('ult', 'Ultimate Singles', [bracket('u-b1', 'Pool B1', 0, WAVE_A, [seed(1, 'Mango')])]);

  const [conflict] = findConflicts(buildIndex([melee, ultimate]), ['melee']);
  assert.equal(conflict.fix.type, 'manual');
});

test('ignores brackets without a wave and projected seeds by default', () => {
  const melee = event('melee', 'Melee Singles', [bracket('m-a1', 'Pool A1', 0, WAVE_A, [seed(1, 'Mango')])]);
  const ultimate = event('ult', 'Ultimate Singles', [
    bracket('u-b1', 'Pool B1', 0, undefined, [seed(1, 'Mango')]),
    bracket('u-b2', 'Pool B2', 1, WAVE_A, [seed(2, 'Mango', { projected: true })]),
  ]);

  assert.equal(findConflicts(buildIndex([melee, ultimate]), ['melee']).length, 0);
  assert.equal(findConflicts(buildIndex([melee, ultimate], { includeProjected: true }), ['melee']).length, 1);
});

test('team entrants are reported once per seed with every affected user', () => {
  const team = {
    id: 'seed-team',
    seed: 4,
    bracketIndex: 0,
    eventEntrant: {
      id: 'ee-team',
      name: 'Mango / Zain',
      entrant: { id: 'entrant-team', usersList: [{ id: 'user-Mango', gamerTag: 'Mango' }, { id: 'user-Zain', gamerTag: 'Zain' }] },
    },
  };
  const doubles = event('dbl', 'Melee Doubles', [
    bracket('d-c1', 'Pool C1', 0, WAVE_A, [team]),
    bracket('d-c2', 'Pool C2', 1, WAVE_B, [seed(5, 'Other')]),
  ]);
  const singles = event('melee', 'Melee Singles', [bracket('m-a1', 'Pool A1', 0, WAVE_A, [seed(1, 'Mango'), seed(2, 'Zain')])]);

  const conflicts = findConflicts(buildIndex([doubles, singles]), ['dbl']);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].users.map((u) => u.gamerTag).sort(), ['Mango', 'Zain']);
  assert.equal(conflicts[0].fix.with.entrantName, 'Other');
});

test('later conflicts do not reuse a partner from an earlier swap', () => {
  const melee = event('melee', 'Melee Singles', [
    bracket('m-a1', 'Pool A1', 0, WAVE_A, [seed(1, 'Mango'), seed(4, 'Axe')]),
    bracket('m-a2', 'Pool A2', 1, WAVE_B, [seed(2, 'Zain'), seed(3, 'Plup')]),
  ]);
  const ultimate = event('ult', 'Ultimate Singles', [
    bracket('u-b1', 'Pool B1', 0, WAVE_A, [seed(1, 'Mango'), seed(2, 'Axe')]),
  ]);

  const conflicts = findConflicts(buildIndex([melee, ultimate]), ['melee']);
  assert.deepEqual(conflicts.map((c) => c.seed.entrantName), ['Mango', 'Axe']);
  assert.equal(conflicts[0].fix.with.entrantName, 'Zain');
  assert.equal(conflicts[1].fix.with.entrantName, 'Plup', 'Zain is already spoken for');
});

test('a mutual swap is reported once and referenced by the second conflict', () => {
  const melee = event('melee', 'Melee Singles', [
    bracket('m-a1', 'Pool A1', 0, WAVE_A, [seed(1, 'Mango')]),
    bracket('m-a2', 'Pool A2', 1, WAVE_B, [seed(2, 'Zain')]),
  ]);
  const ultimate = event('ult', 'Ultimate Singles', [
    bracket('u-b1', 'Pool B1', 0, WAVE_A, [seed(1, 'Mango')]),
    bracket('u-b2', 'Pool B2', 1, WAVE_B, [seed(2, 'Zain')]),
  ]);

  const conflicts = findConflicts(buildIndex([melee, ultimate]), ['melee']);
  assert.equal(conflicts.length, 2);
  assert.equal(conflicts[0].fix.type, 'swap');
  assert.equal(conflicts[0].fix.with.entrantName, 'Zain');
  assert.deepEqual(conflicts[1].fix, { type: 'resolved-by', conflictIndex: 0 });
});

test('tournament-wide scan reports each cross-event collision once', () => {
  const melee = event('melee', 'Melee Singles', [
    bracket('m-a1', 'Pool A1', 0, WAVE_A, [seed(1, 'Mango')]),
    bracket('m-a2', 'Pool A2', 1, WAVE_B, [seed(2, 'Zain')]),
  ]);
  const ultimate = event('ult', 'Ultimate Singles', [
    bracket('u-b1', 'Pool B1', 0, WAVE_A, [seed(1, 'Mango')]),
    bracket('u-b2', 'Pool B2', 1, WAVE_B, [seed(2, 'Zain')]),
  ]);

  const conflicts = findConflicts(buildIndex([melee, ultimate]), ['melee', 'ult']);
  assert.deepEqual(
    conflicts.map((c) => [c.seed.entrantName, c.seed.eventName]),
    [['Mango', 'Melee Singles'], ['Zain', 'Melee Singles']],
    'anchored on the first event, never mirrored from the second',
  );
  assert.equal(findConflicts(buildIndex([melee, ultimate]), ['ult']).length, 2);
});

test('brackets in different phases of the same event never conflict', () => {
  const melee = {
    id: 'melee',
    name: 'Melee Singles',
    phasesList: [
      { id: 'pools', name: 'Pools', bracketsList: [bracket('m-a1', 'Pool A1', 0, WAVE_A, [seed(1, 'Mango')])] },
      { id: 'top8', name: 'Top 8', bracketsList: [bracket('m-t8', 'Top 8', 0, WAVE_A, [seed(1, 'Mango')])] },
    ],
  };
  assert.equal(findConflicts(buildIndex([melee]), ['melee']).length, 0);
});
