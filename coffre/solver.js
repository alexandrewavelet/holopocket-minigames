/*
 * Le Coffre solver — Mastermind over Pokémon energies, pure logic, no DOM.
 * Exposed as `CoffreSolver` in the browser and as a CommonJS module for tests.
 *
 *   symbols: array of energy names (strings)
 *   code / guess: array of `length` symbols (repeats allowed)
 *   attempt: { guess, exact, misplaced }  — the chest's feedback
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CoffreSolver = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LENGTH = 4;
  const listFr = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}` : items.join(''));
  const fmt = (code) => code.join(' · ');

  // ---- feedback ----
  function score(guess, code) {
    let exact = 0;
    const cg = new Map();
    const cc = new Map();
    for (let i = 0; i < guess.length; i++) {
      if (guess[i] === code[i]) exact++;
      cg.set(guess[i], (cg.get(guess[i]) || 0) + 1);
      cc.set(code[i], (cc.get(code[i]) || 0) + 1);
    }
    let common = 0;
    for (const [s, n] of cg) common += Math.min(n, cc.get(s) || 0);
    return { exact, misplaced: common - exact };
  }

  // Fast path on index arrays: returns exact * (LENGTH+1) + misplaced
  function makeScorer(n, length) {
    const ca = new Int32Array(n);
    const cb = new Int32Array(n);
    return function scoreIdx(a, b) {
      let exact = 0;
      ca.fill(0);
      cb.fill(0);
      for (let i = 0; i < length; i++) {
        if (a[i] === b[i]) exact++;
        ca[a[i]]++;
        cb[b[i]]++;
      }
      let common = 0;
      for (let s = 0; s < n; s++) common += Math.min(ca[s], cb[s]);
      return exact * (length + 1) + (common - exact);
    };
  }

  function allIdx(n, length) {
    const out = [];
    const cur = new Array(length).fill(0);
    (function rec(i) {
      if (i === length) { out.push(cur.slice()); return; }
      for (let s = 0; s < n; s++) { cur[i] = s; rec(i + 1); }
    })(0);
    return out;
  }
  const allCodes = (symbols, length) => allIdx(symbols.length, length || LENGTH).map((c) => c.map((i) => symbols[i]));

  function consistent(codes, attempts) {
    return codes.filter((code) => attempts.every((a) => {
      const s = score(a.guess, code);
      return s.exact === a.exact && s.misplaced === a.misplaced;
    }));
  }

  // Facts true in every remaining code
  function certainties(codes, symbols) {
    const length = codes.length ? codes[0].length : LENGTH;
    const positions = Array.from({ length }, (_, p) => (codes.length && codes.every((c) => c[p] === codes[0][p]) ? codes[0][p] : null));
    const present = [];
    const absent = [];
    for (const s of symbols) {
      let min = Infinity;
      let max = 0;
      for (const c of codes) {
        let k = 0;
        for (const x of c) if (x === s) k++;
        if (k < min) min = k;
        if (k > max) max = k;
      }
      if (!codes.length) { min = 0; }
      if (max === 0) absent.push(s);
      else present.push({ symbol: s, min, max });
    }
    return { positions, absent, present };
  }
  function factsText(c) {
    const facts = [];
    c.positions.forEach((s, p) => { if (s) facts.push(`position ${p + 1} = ${s}`); });
    for (const p of c.present) {
      if (p.min >= 1) facts.push(p.min === p.max ? `exactement ${p.min} ${p.symbol}` : `au moins ${p.min} ${p.symbol}`);
    }
    for (const s of c.absent) facts.push(`${s} n'est pas dans le code`);
    return facts;
  }

  // Next guess: minimise the worst-case number of codes left (Knuth), prefer a
  // guess that can itself be the code, then the smallest expected remainder.
  function recommend(candidates, symbols, opts) {
    const length = (opts && opts.length) || LENGTH;
    const n = symbols.length;
    const idxOf = new Map(symbols.map((s, i) => [s, i]));
    const cand = candidates.map((c) => c.map((s) => idxOf.get(s)));
    if (cand.length === 1) return { guess: candidates[0].slice(), worst: 0, expected: 0, isCandidate: true, buckets: 1, pool: 1 };
    const total = Math.pow(n, length);
    let pool;
    if (cand.length === total) {
      // nothing known yet: only the repetition pattern of the opening matters
      pool = [[0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 1, 1], [0, 0, 1, 2], [0, 1, 2, 3]].filter((p) => Math.max(...p) < n).map((p) => p.slice(0, length));
    } else if (total * cand.length <= 2.5e6) {
      pool = allIdx(n, length);
    } else {
      const stride = Math.max(1, Math.ceil(cand.length / 600));
      pool = cand.filter((_, i) => i % stride === 0);
    }
    const scoreIdx = makeScorer(n, length);
    const candKeys = new Set(cand.map((c) => c.join(',')));
    const buckets = new Int32Array((length + 1) * (length + 1));
    let best = null;
    for (const g of pool) {
      buckets.fill(0);
      for (const c of cand) buckets[scoreIdx(g, c)]++;
      let worst = 0;
      let sq = 0;
      let nb = 0;
      for (let k = 0; k < buckets.length; k++) {
        if (!buckets[k]) continue;
        nb++;
        sq += buckets[k] * buckets[k];
        if (buckets[k] > worst) worst = buckets[k];
      }
      const isCandidate = candKeys.has(g.join(','));
      const expected = sq / cand.length;
      if (!best || worst < best.worst || (worst === best.worst && ((isCandidate && !best.isCandidate) || (isCandidate === best.isCandidate && expected < best.expected)))) {
        best = { guess: g, worst, expected, isCandidate, buckets: nb };
      }
    }
    return { guess: best.guess.map((i) => symbols[i]), worst: best.worst, expected: Math.round(best.expected * 10) / 10, isCandidate: best.isCandidate, buckets: best.buckets, pool: pool.length };
  }

  function analyze(input) {
    const symbols = input.symbols || [];
    const attempts = input.attempts || [];
    const length = input.length || LENGTH;
    const maxTries = input.maxTries || 8;
    const total = Math.pow(symbols.length, length);
    const base = { status: null, count: 0, candidates: [], recommendation: null, certainties: null, steps: [], invalidAt: null, tries: attempts.length, maxTries, total, symbols };
    if (symbols.length < 2) return { ...base, status: 'nosymbols' };

    const steps = [];
    let running = allCodes(symbols, length);
    steps.push({
      kind: 'info',
      rule: 'start',
      title: `${total.toLocaleString('fr-FR')} codes possibles au départ`,
      text: `${symbols.length} énergies sur ${length} emplacements, avec répétitions : ${symbols.length}⁴ = ${total.toLocaleString('fr-FR')} codes. Chaque retour du coffre (bien placées / ailleurs) va en éliminer la grande majorité.`,
      remaining: total,
      facts: [],
      attempt: null,
      certainties: certainties(running, symbols),
    });
    let known = certainties(running, symbols);
    let invalidAt = null;
    let won = false;
    attempts.forEach((a, k) => {
      if (invalidAt != null) return;
      const before = running.length;
      running = consistent(running, [a]);
      if (!running.length) {
        invalidAt = k;
        steps.push({
          kind: 'error',
          rule: 'attempt',
          title: `Essai ${k + 1} : ${fmt(a.guess)} → ${a.exact} bien placée${a.exact > 1 ? 's' : ''}, ${a.misplaced} ailleurs`,
          text: `Aucun code n'est compatible avec ce retour et les essais précédents : un des retours a été mal saisi (celui-ci, ou un précédent).`,
          remaining: 0,
          facts: [],
          attempt: k,
          certainties: known,
        });
        return;
      }
      const now = certainties(running, symbols);
      const seen = new Set(factsText(known));
      const facts = factsText(now).filter((f) => !seen.has(f));
      known = now;
      if (a.exact === length) won = true;
      steps.push({
        kind: 'rule',
        rule: 'attempt',
        title: `Essai ${k + 1} : ${fmt(a.guess)} → ${a.exact} bien placée${a.exact > 1 ? 's' : ''}, ${a.misplaced} ailleurs`,
        text: a.exact === length
          ? 'Tout est bien placé : le coffre est ouvert !'
          : `Ce retour élimine ${(before - running.length).toLocaleString('fr-FR')} codes : il en reste ${running.length.toLocaleString('fr-FR')}.${facts.length ? ` Désormais certain : ${listFr(facts)}.` : ''}`,
        remaining: running.length,
        facts,
        attempt: k,
        certainties: now,
      });
    });

    let status;
    if (invalidAt != null) status = 'invalid';
    else if (won) status = 'won';
    else if (running.length === 1) status = 'solved';
    else if (attempts.length >= maxTries) status = 'out';
    else if (attempts.length === 0) status = 'empty';
    else status = 'playing';

    let recommendation = null;
    if (status === 'empty' || status === 'playing' || status === 'solved') recommendation = recommend(running, symbols, { length });

    let result;
    switch (status) {
      case 'invalid':
        result = { title: 'Retours contradictoires', text: `Aucun code n'est compatible avec les ${invalidAt + 1} premiers essais. Vérifie le retour de l'essai ${invalidAt + 1} (ou d'un précédent) : touche-le pour le corriger.` };
        break;
      case 'won':
        result = { title: `Coffre ouvert en ${attempts.length} essai${attempts.length > 1 ? 's' : ''} !`, text: `Le code était ${fmt(attempts[attempts.length - 1].guess)}.` };
        break;
      case 'solved':
        result = { title: `Le code est ${fmt(recommendation.guess)}`, text: 'Un seul code reste compatible avec tous les retours : joue-le pour ouvrir le coffre.' };
        break;
      case 'out':
        result = { title: 'Plus aucun essai', text: `${maxTries} essais joués. ${running.length.toLocaleString('fr-FR')} codes restaient possibles.` };
        break;
      case 'empty':
        result = { title: `Premier essai conseillé : ${fmt(recommendation.guess)}`, text: `Sur ${total.toLocaleString('fr-FR')} codes, cet essai répartit le mieux les retours possibles : au pire il en restera ${recommendation.worst.toLocaleString('fr-FR')}. Joue-le, puis saisis ce que le coffre répond.` };
        break;
      default:
        result = {
          title: `Essai conseillé : ${fmt(recommendation.guess)}`,
          text: `${running.length.toLocaleString('fr-FR')} codes restent possibles. Ce coup les sépare au mieux : quel que soit le retour, il en restera au plus ${recommendation.worst}${recommendation.isCandidate ? ', et il peut ouvrir le coffre directement' : ''}.`,
        };
    }
    steps.push({ kind: 'result', rule: status, title: result.title, text: result.text, remaining: running.length, facts: [], attempt: null, certainties: known });

    return { ...base, status, count: running.length, candidates: running, recommendation, certainties: known, steps, invalidAt };
  }

  return { LENGTH, score, allCodes, consistent, certainties, factsText, recommend, analyze, fmt };
});
