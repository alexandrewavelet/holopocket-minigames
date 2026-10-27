const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../voltorbe-flip/solver.js');

// ---------- helpers ----------
const NULLS = () => [null, null, null, null, null];
const emptyGrid = () => Array.from({ length: 5 }, NULLS);
const cons = (rows, cols) => ({
  rows: rows.map(([sum, volt]) => ({ sum, volt })),
  cols: cols.map(([sum, volt]) => ({ sum, volt })),
});
// Build constraints from a known 5x5 grid of values (0 = Voltorb)
function fromGrid(grid) {
  const rows = grid.map((row) => [row.reduce((a, b) => a + b, 0), row.filter((v) => v === 0).length]);
  const cols = [0, 1, 2, 3, 4].map((c) => {
    const col = grid.map((row) => row[c]);
    return [col.reduce((a, b) => a + b, 0), col.filter((v) => v === 0).length];
  });
  return cons(rows, cols);
}
// Deterministic PRNG for fuzz tests
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function randomGrid(rand) {
  const pick = () => {
    const x = rand();
    if (x < 0.25) return 0;
    if (x < 0.65) return 1;
    if (x < 0.85) return 2;
    return 3;
  };
  return Array.from({ length: 5 }, () => Array.from({ length: 5 }, pick));
}
const bit = (v) => 1 << v;
const mask = (...vals) => vals.reduce((m, v) => m | bit(v), 0);

// The grid from the HoloPocket screenshot (level 2)
const SAMPLE = cons(
  [[4, 1], [8, 1], [7, 2], [3, 2], [4, 1]],
  [[2, 3], [8, 1], [4, 1], [6, 1], [6, 1]],
);
// A grid whose first row has no Voltorb (row 1: 7 points / 0 Voltorb)
const SAFE_ROW_GRID = [
  [3, 1, 1, 1, 1],
  [0, 3, 1, 2, 2],
  [1, 2, 0, 3, 1],
  [0, 1, 1, 0, 1],
  [1, 1, 1, 1, 0],
];

// ---------- lineCandidates ----------
test('lineCandidates: sum 5 / 0 volt is only five 1s', () => {
  assert.deepEqual(S.lineCandidates(5, 0, NULLS()), [[1, 1, 1, 1, 1]]);
});

test('lineCandidates: sum 0 / 5 volts is only five Voltorbs', () => {
  assert.deepEqual(S.lineCandidates(0, 5, NULLS()), [[0, 0, 0, 0, 0]]);
});

test('lineCandidates: sum 4 / 1 volt gives the 5 placements of the Voltorb among 1s', () => {
  const out = S.lineCandidates(4, 1, NULLS());
  assert.equal(out.length, 5);
  for (const cand of out) {
    assert.equal(cand.filter((v) => v === 0).length, 1);
    assert.equal(cand.filter((v) => v === 1).length, 4);
  }
});

test('lineCandidates: sum 9 / 2 volts forces three 3s (10 placements)', () => {
  const out = S.lineCandidates(9, 2, NULLS());
  assert.equal(out.length, 10);
  for (const cand of out) assert.deepEqual([...cand].sort(), [0, 0, 3, 3, 3]);
});

test('lineCandidates: respects fixed (revealed) cells', () => {
  assert.deepEqual(S.lineCandidates(4, 1, [0, null, null, null, null]), [[0, 1, 1, 1, 1]]);
});

test('lineCandidates: contradicting fixed cell yields no candidate', () => {
  assert.deepEqual(S.lineCandidates(4, 1, [3, null, null, null, null]), []);
});

// ---------- validate ----------
test('validate: a consistent complete grid is ok and complete', () => {
  const v = S.validate(SAMPLE);
  assert.equal(v.ok, true);
  assert.equal(v.complete, true);
  assert.deepEqual(v.errors, []);
});

test('validate: a partially filled grid is ok but not complete', () => {
  const c = cons([[4, 1], [8, 1], [7, 2], [3, 2], [4, 1]], [[2, 3], [8, 1], [4, 1], [6, 1], [6, null]]);
  const v = S.validate(c);
  assert.equal(v.ok, true);
  assert.equal(v.complete, false);
});

test('validate: sum above 3 x non-Voltorb cells is an error on that line', () => {
  const c = cons([[12, 2], [8, 1], [7, 2], [3, 2], [4, 1]], [[2, 3], [8, 1], [4, 1], [6, 1], [6, 1]]);
  const v = S.validate(c);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.line === 'row' && e.index === 0));
});

test('validate: sum below non-Voltorb count is an error on that line', () => {
  const c = cons([[4, 0], [8, 1], [7, 2], [3, 2], [4, 1]], [[2, 3], [8, 1], [4, 1], [6, 1], [6, 1]]);
  const v = S.validate(c);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.line === 'row' && e.index === 0));
});

test('validate: row and column totals must match (sums)', () => {
  const c = cons([[5, 1], [8, 1], [7, 2], [3, 2], [4, 1]], [[2, 3], [8, 1], [4, 1], [6, 1], [6, 1]]);
  const v = S.validate(c);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.line === null && e.part === 'sum'));
});

test('validate: row and column totals must match (volts)', () => {
  const c = cons([[4, 1], [8, 1], [7, 2], [3, 2], [4, 1]], [[2, 3], [8, 1], [4, 1], [6, 1], [6, 2]]);
  const v = S.validate(c);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.line === null && e.part === 'volt'));
});

// ---------- enumerate ----------
test('enumerate: fully determined grid has exactly one solution', () => {
  const c = cons([[5, 0], [5, 0], [5, 0], [5, 0], [5, 0]], [[5, 0], [5, 0], [5, 0], [5, 0], [5, 0]]);
  const e = S.enumerate(c, emptyGrid());
  assert.equal(e.total, 1);
  for (let r = 0; r < 5; r++) for (let col = 0; col < 5; col++) assert.deepEqual(e.probs[r][col], [0, 1, 0, 0]);
});

test('enumerate: impossible constraints give zero solutions', () => {
  const c = cons([[5, 0], [5, 0], [5, 0], [5, 0], [5, 0]], [[5, 0], [5, 0], [5, 0], [5, 0], [6, 0]]);
  assert.equal(S.enumerate(c, emptyGrid()).total, 0);
});

test('enumerate: sample grid, column C (sum 4 / 1 volt) never holds a 2 or 3', () => {
  const e = S.enumerate(SAMPLE, emptyGrid());
  assert.ok(e.total > 0);
  for (let r = 0; r < 5; r++) {
    assert.equal(e.probs[r][2][2], 0);
    assert.equal(e.probs[r][2][3], 0);
  }
});

test('enumerate: revealed cell has probability 1 on its value', () => {
  const g = emptyGrid();
  g[1][1] = 3;
  const e = S.enumerate(SAMPLE, g);
  assert.ok(e.total > 0);
  assert.deepEqual(e.probs[1][1], [0, 0, 0, 1]);
});

test('enumerate: fuzz — true grid is always possible and marginals respect line totals', () => {
  const rand = rng(42);
  for (let i = 0; i < 150; i++) {
    const grid = randomGrid(rand);
    const c = fromGrid(grid);
    const e = S.enumerate(c, emptyGrid());
    assert.ok(e.total >= 1, `grid #${i} should have at least one solution`);
    for (let r = 0; r < 5; r++) {
      let voltSum = 0;
      let valueSum = 0;
      for (let col = 0; col < 5; col++) {
        const p = e.probs[r][col];
        assert.ok(p[grid[r][col]] > 0, `true value must be possible at ${r},${col}`);
        assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
        voltSum += p[0];
        valueSum += p[1] + 2 * p[2] + 3 * p[3];
      }
      assert.ok(Math.abs(voltSum - c.rows[r].volt) < 1e-9, `row ${r} expected volt count`);
      assert.ok(Math.abs(valueSum - c.rows[r].sum) < 1e-9, `row ${r} expected sum`);
    }
  }
});

// ---------- deduce (human-readable rules) ----------
test('deduce: a line with 0 Voltorb marks all its cells safe', () => {
  const c = fromGrid(SAFE_ROW_GRID);
  const d = S.deduce(c, emptyGrid());
  for (let col = 0; col < 5; col++) assert.equal(d.poss[0][col] & bit(0), 0);
  assert.ok(d.steps.some((s) => s.rule === 'noVoltLeft' && s.line.type === 'row' && s.line.index === 0));
});

test('deduce: sum + volts = 5 means every card is a 1 or a Voltorb', () => {
  const d = S.deduce(SAMPLE, emptyGrid());
  for (let col = 0; col < 5; col++) assert.equal(d.poss[0][col] & mask(2, 3), 0);
  assert.ok(d.steps.some((s) => s.rule === 'allOnes' && s.line.type === 'row' && s.line.index === 0));
});

test('deduce: a line whose remaining Voltorbs equal its unknown cells is all Voltorbs', () => {
  const c = cons([[0, 5], [8, 1], [7, 1], [3, 2], [4, 1]], [[1, 4], [5, 1], [5, 1], [6, 1], [5, 3]]);
  const d = S.deduce(c, emptyGrid());
  for (let col = 0; col < 5; col++) assert.equal(d.poss[0][col], bit(0));
  assert.ok(d.steps.some((s) => s.rule === 'allVolts' && s.line.type === 'row' && s.line.index === 0));
});

test('deduce: bounds rule — sum 8 with 2 volts forces every non-Voltorb card to be at least 2', () => {
  const c = cons([[8, 2], [8, 1], [7, 1], [3, 2], [4, 1]], [[5, 1], [7, 1], [6, 1], [6, 2], [6, 2]]);
  const d = S.deduce(c, emptyGrid());
  for (let col = 0; col < 5; col++) assert.equal(d.poss[0][col] & bit(1), 0, `cell 0,${col} cannot be a 1`);
  assert.ok(d.steps.some((s) => s.rule === 'bounds' && s.line.type === 'row' && s.line.index === 0));
});

test('deduce: a card is safe when the others cannot reach the remaining sum without it', () => {
  // sample grid, column B: 8 points / 1 volt, and B1, B4, B5 are already {Voltorb,1} from their rows.
  // If B2 were the Voltorb, B3 + B1 + B4 + B5 could total at most 3+1+1+1 = 6 < 8 ⇒ B2 (and B3) are safe 3s.
  const d = S.deduce(SAMPLE, emptyGrid());
  assert.equal(d.poss[1][1], bit(3));
  assert.equal(d.poss[2][1], bit(3));
  assert.ok(d.steps.some((s) => s.rule === 'mustBeSafe' && s.line.type === 'col' && s.line.index === 1));
});

test('deduce: cross-referencing a row of 1s with a safe column pins a certain 1', () => {
  // row 0: sum 4 / 1 volt → {Voltorb,1}; col 0: sum 7 / 0 volt → safe ⇒ cell (0,0) is a 1
  const c = cons([[4, 1], [8, 1], [7, 2], [3, 2], [4, 1]], [[7, 0], [8, 1], [4, 1], [6, 1], [1, 4]]);
  const d = S.deduce(c, emptyGrid());
  assert.equal(d.poss[0][0], bit(1));
});

test('deduce: revealed cards feed the remaining sum', () => {
  // row 0: sum 7 / 1 volt, a 3 already revealed → 4 points left on 3 cards ⇒ no 3 left
  const c = cons([[7, 1], [8, 1], [7, 2], [3, 2], [4, 1]], [[5, 2], [8, 1], [4, 1], [6, 1], [6, 1]]);
  const g = emptyGrid();
  g[0][0] = 3;
  const d = S.deduce(c, g);
  assert.equal(d.poss[0][0], bit(3));
  for (let col = 1; col < 5; col++) assert.equal(d.poss[0][col] & bit(3), 0);
});

test('deduce: snapshots give the board state after each step', () => {
  const d = S.deduce(SAMPLE, emptyGrid());
  assert.equal(d.snapshots.length, d.steps.length);
  assert.ok(d.steps.length > 0);
  assert.deepEqual(d.snapshots[d.snapshots.length - 1], d.poss);
  // each step's "after" masks match the snapshot of that step
  d.steps.forEach((step, i) => {
    for (const cell of step.cells) assert.equal(d.snapshots[i][cell.r][cell.c], cell.after);
  });
});

test('deduce: inconsistent revealed values raise a contradiction instead of looping', () => {
  const g = emptyGrid();
  g[0][0] = 3; // row 0 is sum 4 / 1 volt: a 3 is impossible
  const d = S.deduce(SAMPLE, g);
  assert.equal(d.contradiction, true);
});

test('deduce: fuzz — rules never eliminate a value that some solution uses (soundness)', () => {
  const rand = rng(7);
  for (let i = 0; i < 150; i++) {
    const grid = randomGrid(rand);
    const c = fromGrid(grid);
    const revealed = emptyGrid();
    // reveal a few random non-Voltorb cards, as a player would
    for (let k = 0; k < 3; k++) {
      const r = Math.floor(rand() * 5);
      const col = Math.floor(rand() * 5);
      if (grid[r][col] !== 0) revealed[r][col] = grid[r][col];
    }
    const e = S.enumerate(c, revealed);
    const d = S.deduce(c, revealed);
    assert.equal(d.contradiction, false, `grid #${i} must not contradict`);
    for (let r = 0; r < 5; r++) {
      for (let col = 0; col < 5; col++) {
        for (let v = 0; v < 4; v++) {
          if (e.probs[r][col][v] > 0) assert.ok(d.poss[r][col] & bit(v), `grid #${i} cell ${r},${col} value ${v} wrongly eliminated`);
        }
      }
    }
  }
});

// ---------- analyze (what the UI consumes) ----------
test('analyze: incomplete constraints give status incomplete', () => {
  const c = cons([[4, 1], [8, 1], [7, 2], [3, 2], [4, 1]], [[2, 3], [8, 1], [4, 1], [6, 1], [null, null]]);
  assert.equal(S.analyze(c, emptyGrid()).status, 'incomplete');
});

test('analyze: invalid constraints give status invalid with errors', () => {
  const c = cons([[12, 2], [8, 1], [7, 2], [3, 2], [4, 1]], [[2, 3], [8, 1], [4, 1], [6, 1], [6, 1]]);
  const a = S.analyze(c, emptyGrid());
  assert.equal(a.status, 'invalid');
  assert.ok(a.errors.length > 0);
});

test('analyze: consistent-looking but unsolvable grid gives status impossible', () => {
  // totals match, each line is locally fine, yet the revealed cards make it unsolvable
  const c = cons([[9, 2], [9, 2], [9, 2], [9, 2], [9, 2]], [[9, 2], [9, 2], [9, 2], [9, 2], [9, 2]]);
  const g = emptyGrid();
  g[1][3] = 3; g[2][3] = 3; g[3][3] = 3; g[4][3] = 3; // four 3s in column D: 12 points, it announces 9
  const a = S.analyze(c, g);
  assert.equal(a.status, 'impossible');
});

test('analyze: a line with 0 Voltorb yields safe cards to flip', () => {
  const c = fromGrid(SAFE_ROW_GRID);
  const a = S.analyze(c, emptyGrid());
  assert.equal(a.status, 'safe');
  assert.ok(a.safeCells.some((cell) => cell.r === 0));
  for (const cell of a.safeCells) {
    assert.equal(a.cells[cell.r][cell.c].pVolt, 0);
    assert.ok(a.cells[cell.r][cell.c].pGain > 0);
  }
});

test('analyze: safe cards that are certainly a 1 are not recommended', () => {
  // row 0: 4/1 → {V,1}; col 0: 7/0 → safe ⇒ (0,0) is a certain 1, never a recommendation
  const c = cons([[4, 1], [8, 1], [7, 2], [3, 2], [4, 1]], [[7, 0], [8, 1], [4, 1], [6, 1], [1, 4]]);
  const a = S.analyze(c, emptyGrid());
  assert.equal(a.cells[0][0].kind, 'one');
  assert.ok(!a.safeCells.some((cell) => cell.r === 0 && cell.c === 0));
});

test('analyze: with no safe card, the best guess is the lowest Voltorb risk among cards that can score', () => {
  const c = cons([[6, 1], [6, 1], [6, 1], [6, 1], [6, 1]], [[6, 1], [6, 1], [6, 1], [6, 1], [6, 1]]);
  const a = S.analyze(c, emptyGrid());
  assert.equal(a.status, 'guess');
  assert.deepEqual(a.safeCells, []);
  assert.ok(a.bestGuess);
  const best = a.cells[a.bestGuess.r][a.bestGuess.c];
  assert.ok(best.pGain > 0);
  for (let r = 0; r < 5; r++) {
    for (let col = 0; col < 5; col++) {
      const cell = a.cells[r][col];
      if (cell.pGain > 0) assert.ok(best.pVolt <= cell.pVolt + 1e-12);
    }
  }
});

test('analyze: cards that can only be a 1 or a Voltorb are flagged dead', () => {
  const a = S.analyze(SAMPLE, emptyGrid());
  assert.equal(a.cells[0][0].kind, 'dead');
  assert.ok(a.deadCells.some((cell) => cell.r === 0 && cell.c === 0));
});

test('analyze: once every 2 and 3 is revealed the level is done', () => {
  const c = cons([[6, 0], [5, 0], [5, 0], [5, 0], [5, 0]], [[6, 0], [5, 0], [5, 0], [5, 0], [5, 0]]);
  const g = emptyGrid();
  g[0][0] = 2;
  assert.equal(S.analyze(c, g).status, 'done');
});

test('analyze: a revealed Voltorb means the grid is lost', () => {
  const g = emptyGrid();
  g[0][0] = 0;
  assert.equal(S.analyze(SAMPLE, g).status, 'lost');
});

test('analyze: steps end with an enumeration step then a result step', () => {
  const a = S.analyze(SAMPLE, emptyGrid());
  const kinds = a.steps.map((s) => s.kind);
  assert.equal(kinds[kinds.length - 2], 'enum');
  assert.equal(kinds[kinds.length - 1], 'result');
  assert.equal(a.enumStepIndex, kinds.length - 2);
  assert.equal(a.snapshots.length, a.steps.length);
  assert.ok(a.total > 0);
});

test('analyze: every step carries French explanation text', () => {
  const a = S.analyze(SAMPLE, emptyGrid());
  for (const step of a.steps) {
    assert.ok(typeof step.title === 'string' && step.title.length > 0);
    assert.ok(typeof step.text === 'string' && step.text.length > 0);
  }
});
