const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../voisins/solver.js');

const card = (name, types, gen, lineage) => ({ name, form: null, types, gen, lineage });
// The nine cards of the HoloPocket screenshot
const SCREENSHOT = [
  card('Lippoutou', ['Glace', 'Psy'], 1, 'Lippouti'),
  card('Zapétrel', ['Électrik', 'Vol'], 9, 'Zapétrel'),
  card('Cadoizo', ['Glace', 'Vol'], 2, 'Cadoizo'),
  card('Chongjian', ['Ténèbres', 'Plante'], 9, 'Chongjian'),
  card('Qwilfish de Hisui', ['Ténèbres', 'Poison'], 8, 'Qwilfish'),
  card('Nirondelle', ['Normal', 'Vol'], 3, 'Nirondelle'),
  card('Baojian', ['Ténèbres', 'Glace'], 9, 'Baojian'),
  card('Bekaglaçon', ['Glace'], 8, 'Bekaglaçon'),
  card('Hexadron', ['Combat'], 8, 'Hexadron'),
];
const NEIGHBORS = [[0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8], [0, 3], [1, 4], [2, 5], [3, 6], [4, 7], [5, 8]];
function layoutIsValid(cards, layout) {
  return NEIGHBORS.every(([a, b]) => S.shared(cards[layout[a]], cards[layout[b]]).length > 0);
}

// ---------- shared ----------
test('shared: a common type is a reason', () => {
  const r = S.shared(card('A', ['Glace', 'Psy'], 1, 'a'), card('B', ['Vol', 'Glace'], 2, 'b'));
  assert.deepEqual(r, [{ kind: 'type', value: 'Glace' }]);
});

test('shared: same generation is a reason', () => {
  const r = S.shared(card('A', ['Feu'], 8, 'a'), card('B', ['Eau'], 8, 'b'));
  assert.deepEqual(r, [{ kind: 'gen', value: 'Gén. 8' }]);
});

test('shared: same lineage is a reason, compared without case or accents', () => {
  const r = S.shared(card('A', ['Feu'], 1, 'Évoli'), card('B', ['Eau'], 2, 'evoli '));
  assert.deepEqual(r, [{ kind: 'lineage', value: 'lignée Évoli' }]);
});

test('shared: nothing in common gives no reason; empty lineages never match', () => {
  assert.deepEqual(S.shared(card('A', ['Feu'], 1, ''), card('B', ['Eau'], 2, '')), []);
});

test('shared: several reasons are all listed (types first, then generation)', () => {
  const r = S.shared(card('A', ['Ténèbres', 'Plante'], 9, 'a'), card('B', ['Ténèbres', 'Glace'], 9, 'b'));
  assert.deepEqual(r, [{ kind: 'type', value: 'Ténèbres' }, { kind: 'gen', value: 'Gén. 9' }]);
});

// ---------- analyze ----------
test('analyze: cards without a type or a generation make the input incomplete', () => {
  const cards = SCREENSHOT.map((c) => ({ ...c }));
  cards[4] = card('', [], null, '');
  const a = S.analyze(cards);
  assert.equal(a.status, 'incomplete');
  assert.deepEqual(a.missing, [4]);
});

test('analyze: the screenshot cards have a valid layout', () => {
  const a = S.analyze(SCREENSHOT);
  assert.equal(a.status, 'solved');
  assert.ok(a.count >= 1);
  assert.equal(a.layout.length, 9);
  assert.deepEqual([...a.layout].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(layoutIsValid(SCREENSHOT, a.layout));
});

test('analyze: every stored solution is valid and distinct', () => {
  const a = S.analyze(SCREENSHOT);
  const seen = new Set();
  for (const sol of a.solutions) {
    assert.ok(layoutIsValid(SCREENSHOT, sol));
    const key = sol.join(',');
    assert.ok(!seen.has(key));
    seen.add(key);
  }
});

test('analyze: the first solution puts the most constrained card in a corner', () => {
  const a = S.analyze(SCREENSHOT);
  const degree = a.graph.degree;
  const minDeg = Math.min(...degree);
  const corners = [0, 2, 6, 8];
  assert.ok(corners.some((cell) => degree[a.layout[cell]] === minDeg));
});

test('analyze: a card that matches nothing makes the page impossible', () => {
  const cards = SCREENSHOT.map((c) => ({ ...c }));
  cards[8] = card('Solo', ['Dragon'], 5, 'Solo');
  const a = S.analyze(cards);
  assert.equal(a.status, 'impossible');
  assert.deepEqual(a.isolated, [8]);
  assert.equal(a.steps[a.steps.length - 1].kind, 'error');
});

test('analyze: a card with a single partner is also impossible (a cell has at least 2 neighbours)', () => {
  const cards = SCREENSHOT.map((c) => ({ ...c }));
  cards[8] = card('Duo', ['Combat'], 5, 'Duo'); // only Hexadron? no: Hexadron is replaced; Combat matches nobody else
  cards[7] = card('Buddy', ['Combat'], 6, 'Buddy'); // Duo ↔ Buddy only
  const a = S.analyze(cards);
  assert.equal(a.status, 'impossible');
});

test('analyze: nine cards of the same generation give 9! layouts, capped list of solutions', () => {
  const cards = Array.from({ length: 9 }, (_, i) => card(`C${i}`, ['Normal'], 1, `L${i}`));
  const a = S.analyze(cards, { limit: 50 });
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 362880);
  assert.equal(a.solutions.length, 50);
});

test('analyze: solutionIndex picks another stored layout', () => {
  const a0 = S.analyze(SCREENSHOT, { solutionIndex: 0 });
  const a1 = S.analyze(SCREENSHOT, { solutionIndex: 1 });
  assert.ok(a0.count > 1);
  assert.notDeepEqual(a0.layout, a1.layout);
  assert.ok(layoutIsValid(SCREENSHOT, a1.layout));
});

// ---------- steps ----------
test('steps: links, constraints, one placement per cell, then the result', () => {
  const a = S.analyze(SCREENSHOT);
  const kinds = a.steps.map((s) => s.rule);
  assert.equal(kinds[0], 'links');
  assert.ok(kinds.includes('corners') || kinds.includes('center'));
  const places = a.steps.filter((s) => s.rule === 'place');
  assert.equal(places.length, 9);
  assert.deepEqual(places.map((s) => s.cell).sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(a.steps[a.steps.length - 1].kind, 'result');
  for (const s of a.steps) {
    assert.ok(s.title.length > 0);
    assert.ok(s.text.length > 0);
  }
});

test('steps: a placement explains the shared attribute with already placed neighbours', () => {
  const a = S.analyze(SCREENSHOT);
  const places = a.steps.filter((s) => s.rule === 'place');
  // cell 1 is next to cell 0, placed before it in row-major order
  const second = places.find((s) => s.cell === 1);
  assert.ok(second.links.length >= 1);
  assert.equal(second.links[0].cell, 0);
  assert.ok(second.links[0].reasons.length >= 1);
});
