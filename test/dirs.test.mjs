import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './lib/load.mjs';

const { parseDir, opposite, isDirKey, sameDir, DIRS, shortOf } = await loadTs('src/dirs.ts');

test('DIRS has every direction once, 28 in all', () => {
  assert.equal(DIRS.length, 28);
  assert.equal(new Set(DIRS.map((d) => d.name)).size, 28);
  assert.equal(new Set(DIRS.map((d) => d.short)).size, 28);
  for (const d of DIRS) assert.equal(opposite(d.opposite), d.name, `${d.name} opposite is symmetric`);
});

test('long and short compass forms', () => {
  const cases = {
    north: ['north', 'n', 'N', ' North '], south: ['south', 's'], east: ['east', 'e'], west: ['west', 'w'],
    northeast: ['northeast', 'ne', 'north-east', 'north east', 'north_east'], northwest: ['northwest', 'nw'],
    southeast: ['southeast', 'se'], southwest: ['southwest', 'sw'],
  };
  for (const [name, raws] of Object.entries(cases)) for (const raw of raws) assert.equal(parseDir(raw)?.name, name, raw);
  assert.deepEqual([parseDir('n').dx, parseDir('n').dy, parseDir('n').dz], [0, -1, 0]);
  assert.deepEqual([parseDir('se').dx, parseDir('se').dy, parseDir('se').dz], [1, 1, 0]);
  assert.deepEqual([parseDir('w').dx, parseDir('w').dy], [-1, 0]);
});

test('up, down, in, out', () => {
  assert.equal(parseDir('up').name, 'up');
  assert.equal(parseDir('u').name, 'up');
  assert.equal(parseDir('down').name, 'down');
  assert.equal(parseDir('d').name, 'down');
  assert.equal(parseDir('up').dz, 1);
  assert.equal(parseDir('down').dz, -1);
  for (const k of ['in', 'out']) {
    const d = parseDir(k);
    assert.deepEqual([d.dx, d.dy, d.dz], [0, 0, 0], k);
  }
  assert.equal(parseDir('in').opposite, 'out');
  assert.equal(parseDir('out').opposite, 'in');
  assert.equal(parseDir('up').opposite, 'down');
});

test('compound vertical forms with spaces, hyphens, underscores and fused shorts', () => {
  const unw = parseDir('up northwest');
  assert.equal(unw.name, 'up northwest');
  assert.deepEqual([unw.dx, unw.dy, unw.dz], [-1, -1, 1]);
  assert.equal(unw.short, 'unw');
  assert.equal(unw.opposite, 'down southeast');
  for (const raw of ['unw', 'up-nw', 'up_northwest', 'u nw', 'UP   NORTHWEST']) assert.equal(parseDir(raw)?.name, 'up northwest', raw);
  const dne = parseDir('dne');
  assert.equal(dne.name, 'down northeast');
  assert.deepEqual([dne.dx, dne.dy, dne.dz], [1, -1, -1]);
  const de = parseDir('down-east');
  assert.equal(de.name, 'down east');
  assert.deepEqual([de.dx, de.dy, de.dz], [1, 0, -1]);
  assert.equal(parseDir('down south').opposite, 'up north');
  assert.equal(parseDir('unorth').name, 'up north');
});

test('rejects what is not a direction', () => {
  for (const raw of ['nort', 'enter', '', '   ', 'upup', 'uu', 'in out', 'north north', 'look', 'ud', 'nn']) {
    assert.equal(parseDir(raw), null, JSON.stringify(raw));
    assert.equal(isDirKey(raw), false, JSON.stringify(raw));
  }
  assert.equal(parseDir(undefined), null);
});

test('opposite, isDirKey, sameDir, shortOf', () => {
  assert.equal(opposite('north'), 'south');
  assert.equal(opposite('up southwest'), 'down northeast');
  assert.throws(() => opposite('nowhere'));
  assert.equal(isDirKey('ne'), true);
  assert.equal(isDirKey('up northwest'), true);
  assert.equal(sameDir('n', 'north'), true);
  assert.equal(sameDir('dne', 'down-northeast'), true);
  assert.equal(sameDir('n', 's'), false);
  assert.equal(sameDir('n', 'enter'), false);
  assert.equal(shortOf('north'), 'n');
  assert.equal(shortOf('up northwest'), 'unw');
  assert.equal(shortOf('in'), 'in');
  assert.throws(() => shortOf('sideways'));
});

test('nautical directions: fore, aft, starboard, port and their compounds', () => {
  const cases = {
    north: ['fore', 'forward', 'fwd', 'bow'], south: ['aft', 'astern', 'stern', 'Aft'], east: ['starboard', 'stbd'], west: ['port', 'portside', 'larboard'],
    northeast: ['fore starboard', 'fore-starboard'], southwest: ['aft port'],
    'up south': ['up aft', 'uaft', 'u aft'], 'down east': ['down starboard', 'dstarboard'],
  };
  for (const [name, raws] of Object.entries(cases)) for (const raw of raws) assert.equal(parseDir(raw)?.name, name, raw);
  assert.equal(sameDir('aft', 's'), true);
  assert.equal(opposite(parseDir('fore').name), 'south');
  assert.equal(parseDir('portal'), null, 'no prefix matching');
  assert.equal(parseDir('p'), null);
});

test('compound short forms: use, dsw, une, dn', () => {
  assert.equal(parseDir('use').name, 'up southeast');
  assert.equal(parseDir('dsw').name, 'down southwest');
  assert.equal(parseDir('une').name, 'up northeast');
  assert.equal(parseDir('dn').name, 'down north');
  assert.deepEqual([parseDir('use').dx, parseDir('use').dy, parseDir('use').dz], [1, 1, 1]);
  assert.equal(opposite('up southeast'), 'down northwest');
});
