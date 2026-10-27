const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../coffre/solver.js');

const SYMS = ['Plante', 'Feu', 'Eau', 'Électrik', 'Psy', 'Combat'];
const [G, F, W, L, P, C] = SYMS;
const att = (guess, exact, misplaced) => ({ guess, exact, misplaced });
// The six tries of the HoloPocket screenshot; the code was Eau Électrik Plante Combat
const SCREENSHOT = [
  att([G, F, W, L], 0, 3),
  att([F, W, L, P], 0, 2),
  att([W, L, P, C], 3, 0),
  att([W, L, W, C], 3, 0),
  att([W, L, L, C], 3, 0),
  att([W, L, G, C], 4, 0),
];
const CODE = [W, L, G, C];

// ---------- score ----------
test('score: identical guess and code is 4 exact', () => {
  assert.deepEqual(S.score([G, F, W, L], [G, F, W, L]), { exact: 4, misplaced: 0 });
});

test('score: repeated symbols are only counted as many times as they appear', () => {
  assert.deepEqual(S.score([G, G, F, F], [G, F, G, G]), { exact: 1, misplaced: 2 });
});

test('score: the screenshot tries all match the real code', () => {
  for (const a of SCREENSHOT) assert.deepEqual(S.score(a.guess, CODE), { exact: a.exact, misplaced: a.misplaced });
});

// ---------- codes ----------
test('allCodes: 6 symbols over 4 slots give 1296 codes, 2 symbols give 16', () => {
  assert.equal(S.allCodes(SYMS).length, 1296);
  assert.equal(S.allCodes([G, F]).length, 16);
});

test('consistent: keeps exactly the codes matching every feedback', () => {
  const codes = S.allCodes(SYMS);
  const left = S.consistent(codes, SCREENSHOT.slice(0, 1));
  assert.ok(left.length < codes.length);
  for (const code of left) assert.deepEqual(S.score([G, F, W, L], code), { exact: 0, misplaced: 3 });
  assert.ok(left.some((code) => code.join() === CODE.join()));
});

// ---------- certainties ----------
test('certainties: a fixed position, an absent symbol and a guaranteed count are reported', () => {
  const codes = [[W, L, G, C], [W, L, C, G], [W, L, W, G]];
  const c = S.certainties(codes, SYMS);
  assert.deepEqual(c.positions, [W, L, null, null]);
  assert.ok(c.absent.includes(F) && c.absent.includes(P));
  const g = c.present.find((x) => x.symbol === G);
  assert.equal(g.min, 1);
  const w = c.present.find((x) => x.symbol === W);
  assert.equal(w.min, 1);
  assert.equal(w.max, 2);
});

// ---------- recommend ----------
test('recommend: with two candidates left the guess is one of them', () => {
  const candidates = [[W, L, G, C], [W, L, C, G]];
  const r = S.recommend(candidates, SYMS);
  assert.ok(candidates.some((c) => c.join() === r.guess.join()));
  assert.equal(r.worst, 1);
});

test('recommend: the first guess of a 6-symbol game mixes symbols (worst case well under 1296)', () => {
  const codes = S.allCodes(SYMS);
  const r = S.recommend(codes, SYMS);
  assert.equal(r.guess.length, 4);
  assert.ok(new Set(r.guess).size >= 2);
  assert.ok(r.worst < 400, `worst ${r.worst}`);
});

test('recommend: never leaves the full candidate set as worst case when more than one code remains', () => {
  const candidates = S.consistent(S.allCodes(SYMS), SCREENSHOT.slice(0, 2));
  const r = S.recommend(candidates, SYMS);
  assert.ok(candidates.length > 1);
  assert.ok(r.worst < candidates.length);
});

// ---------- analyze ----------
test('analyze: no try yet is status empty with a recommended opening', () => {
  const a = S.analyze({ symbols: SYMS, attempts: [] });
  assert.equal(a.status, 'empty');
  assert.equal(a.count, 1296);
  assert.equal(a.recommendation.guess.length, 4);
});

test('analyze: the real code stays possible after every screenshot try', () => {
  for (let k = 1; k <= 5; k++) {
    const a = S.analyze({ symbols: SYMS, attempts: SCREENSHOT.slice(0, k) });
    assert.ok(a.candidates.some((c) => c.join() === CODE.join()), `after ${k} tries`);
  }
});

test('analyze: after the five first tries only the real code is left', () => {
  const a = S.analyze({ symbols: SYMS, attempts: SCREENSHOT.slice(0, 5) });
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 1);
  assert.deepEqual(a.recommendation.guess, CODE);
});

test('analyze: a 4-exact try wins', () => {
  const a = S.analyze({ symbols: SYMS, attempts: SCREENSHOT });
  assert.equal(a.status, 'won');
});

test('analyze: contradictory feedback is invalid and names the first impossible try', () => {
  const a = S.analyze({ symbols: SYMS, attempts: [att([G, G, G, G], 4, 0), att([F, F, F, F], 1, 0)] });
  assert.equal(a.status, 'invalid');
  assert.equal(a.invalidAt, 1);
});

test('analyze: the try limit is reported', () => {
  const tries = Array.from({ length: 8 }, () => att([G, F, W, L], 0, 3));
  const a = S.analyze({ symbols: SYMS, attempts: tries, maxTries: 8 });
  assert.equal(a.status, 'out');
});

test('analyze: 8 symbols stay fast enough for the UI', () => {
  const syms = [...SYMS, 'Ténèbres', 'Métal'];
  const t = Date.now();
  const a = S.analyze({ symbols: syms, attempts: [att([G, F, W, L], 1, 1)] });
  assert.ok(a.recommendation.guess.length === 4);
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t}ms`);
});

// ---------- steps ----------
test('steps: one step per try, each with the remaining count, then a result', () => {
  const a = S.analyze({ symbols: SYMS, attempts: SCREENSHOT.slice(0, 3) });
  const tries = a.steps.filter((s) => s.rule === 'attempt');
  assert.equal(tries.length, 3);
  assert.ok(tries[0].remaining > tries[1].remaining);
  for (const s of a.steps) assert.ok(s.certainties && Array.isArray(s.certainties.positions), 'each step carries the notebook state');
  assert.equal(a.steps[0].rule, 'start');
  assert.equal(a.steps[a.steps.length - 1].kind, 'result');
  for (const s of a.steps) assert.ok(s.title && s.text);
});

test('steps: newly certain facts are attached to the try that revealed them', () => {
  const a = S.analyze({ symbols: SYMS, attempts: SCREENSHOT.slice(0, 5) });
  const facts = a.steps.filter((s) => s.rule === 'attempt').flatMap((s) => s.facts);
  assert.ok(facts.length > 0);
  assert.ok(facts.some((f) => /Psy/.test(f)));
});
