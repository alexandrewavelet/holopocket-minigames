/*
 * Voltorb Flip solver — pure logic, no DOM.
 * Exposed as `VoltorbSolver` in the browser and as a CommonJS module for tests.
 *
 * Conventions:
 *   - card values: 0 = Voltorb, 1, 2, 3
 *   - a "poss" is a 4-bit mask of still-possible values (bit v = value v)
 *   - constraints = { rows: [{sum, volt}×5], cols: [{sum, volt}×5] }, null when not typed yet
 *   - revealed = 5×5 of null | 0..3
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoltorbSolver = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const N = 5;
  const FULL = 0b1111;
  const VOLT = 0;
  const bit = (v) => 1 << v;
  const COLS = ['A', 'B', 'C', 'D', 'E'];
  const COLORS = ['rouge', 'verte', 'orange', 'bleue', 'violette'];

  const popcount = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
  const single = (m) => (m === 1 ? 0 : m === 2 ? 1 : m === 4 ? 2 : m === 8 ? 3 : -1);
  const minNV = (m) => (m & 2 ? 1 : m & 4 ? 2 : m & 8 ? 3 : 0); // lowest non-Voltorb value still possible
  const maxNV = (m) => (m & 8 ? 3 : m & 4 ? 2 : m & 2 ? 1 : 0);
  const grid = (fn) => Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => fn(r, c)));
  const copy = (g) => g.map((row) => row.slice());
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  const lineWord = (line) => (line.type === 'row' ? 'ligne' : 'colonne');
  const lineLabel = (line) =>
    line.type === 'row'
      ? `Ligne ${line.index + 1} (${COLORS[line.index]})`
      : `Colonne ${COLS[line.index]} (${COLORS[line.index]})`;
  const cellLabel = (r, c) => `${COLS[c]}${r + 1}`;
  const labels = (cells) => {
    const names = cells.map((x) => cellLabel(x.r, x.c));
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names.join('');
  };
  const pct = (p) => `${Math.round(p * 100)} %`;
  const cards = (n) => `${n} carte${n > 1 ? 's' : ''}`;

  // ------------------------------------------------------------------
  // All ways to fill one line of 5 cards given its sum, Voltorb count and
  // already-revealed cards. Pruned depth-first search.
  // ------------------------------------------------------------------
  function lineCandidates(lineSum, lineVolt, fixed) {
    const out = [];
    const cur = new Array(N);
    (function rec(i, s, v) {
      if (i === N) {
        if (s === lineSum && v === lineVolt) out.push(cur.slice());
        return;
      }
      const remaining = N - i - 1;
      for (let val = 0; val <= 3; val++) {
        if (fixed[i] != null && fixed[i] !== val) continue;
        const ns = s + val;
        const nv = v + (val === VOLT ? 1 : 0);
        if (nv > lineVolt || ns > lineSum) continue;
        const remVolt = lineVolt - nv;
        if (remVolt > remaining) continue;
        const remNon = remaining - remVolt;
        const remSum = lineSum - ns;
        if (remSum < remNon || remSum > 3 * remNon) continue;
        cur[i] = val;
        rec(i + 1, ns, nv);
      }
    })(0, 0, 0);
    return out;
  }

  // ------------------------------------------------------------------
  // Sanity checks on the typed constraints (before any solving).
  // ------------------------------------------------------------------
  function validate(cons) {
    const errors = [];
    let complete = true;
    const totals = { rows: { sum: 0, volt: 0 }, cols: { sum: 0, volt: 0 } };
    for (const type of ['rows', 'cols']) {
      const lineType = type === 'rows' ? 'row' : 'col';
      cons[type].forEach((line, index) => {
        if (line.sum == null || line.volt == null) {
          complete = false;
          return;
        }
        totals[type].sum += line.sum;
        totals[type].volt += line.volt;
        const nonVolt = N - line.volt;
        const min = nonVolt;
        const max = 3 * nonVolt;
        if (line.sum < min || line.sum > max) {
          errors.push({
            line: lineType,
            index,
            part: 'sum',
            message: `${lineLabel({ type: lineType, index })} : ${line.sum} points avec ${line.volt} Voltorbe, impossible (entre ${min} et ${max}).`,
          });
        }
      });
    }
    if (complete) {
      if (totals.rows.sum !== totals.cols.sum) {
        errors.push({
          line: null,
          index: null,
          part: 'sum',
          message: `Les lignes totalisent ${totals.rows.sum} points, les colonnes ${totals.cols.sum} : une somme est mal saisie.`,
        });
      }
      if (totals.rows.volt !== totals.cols.volt) {
        errors.push({
          line: null,
          index: null,
          part: 'volt',
          message: `Les lignes annoncent ${totals.rows.volt} Voltorbe, les colonnes ${totals.cols.volt} : un compte est mal saisi.`,
        });
      }
    }
    return { ok: errors.length === 0, complete, errors };
  }

  // ------------------------------------------------------------------
  // Exact enumeration of every grid compatible with the constraints.
  // Dynamic programming row by row; the state is the partial column
  // totals (sum + Voltorb count per column). Forward pass counts ways to
  // reach each state, backward pass counts completions, the product gives
  // exact per-card marginals.
  // ------------------------------------------------------------------
  function enumerate(cons, revealed) {
    const counts = grid(() => [0, 0, 0, 0]);
    const empty = () => ({ total: 0, counts, probs: grid(() => [0, 0, 0, 0]) });
    const rowCands = cons.rows.map((line, r) => lineCandidates(line.sum, line.volt, revealed[r]));
    if (rowCands.some((c) => c.length === 0)) return empty();
    const colSum = cons.cols.map((l) => l.sum);
    const colVolt = cons.cols.map((l) => l.volt);

    const encode = (sums, volts) => {
      let ks = 0;
      let kv = 0;
      for (let c = 0; c < N; c++) {
        ks = ks * 16 + sums[c];
        kv = kv * 8 + volts[c];
      }
      return ks * 32768 + kv;
    };

    // Apply one row candidate to a state; null when a column can no longer be satisfied.
    function advance(state, cand, r) {
      const left = N - 1 - r; // rows still to place after this one
      const sums = new Array(N);
      const volts = new Array(N);
      for (let c = 0; c < N; c++) {
        const s = state.sums[c] + cand[c];
        const v = state.volts[c] + (cand[c] === VOLT ? 1 : 0);
        if (s > colSum[c] || v > colVolt[c]) return null;
        const remVolt = colVolt[c] - v;
        if (remVolt > left) return null;
        const remNon = left - remVolt;
        const remSum = colSum[c] - s;
        if (remSum < remNon || remSum > 3 * remNon) return null;
        sums[c] = s;
        volts[c] = v;
      }
      return { sums, volts, key: encode(sums, volts) };
    }

    const layers = [new Map([[0, { sums: [0, 0, 0, 0, 0], volts: [0, 0, 0, 0, 0], count: 1 }]])];
    for (let r = 0; r < N; r++) {
      const next = new Map();
      for (const st of layers[r].values()) {
        for (const cand of rowCands[r]) {
          const ns = advance(st, cand, r);
          if (!ns) continue;
          const ex = next.get(ns.key);
          if (ex) ex.count += st.count;
          else next.set(ns.key, { sums: ns.sums, volts: ns.volts, count: st.count });
        }
      }
      layers.push(next);
    }
    let total = 0;
    for (const st of layers[N].values()) total += st.count;
    if (total === 0) return empty();

    let back = new Map();
    for (const key of layers[N].keys()) back.set(key, 1);
    for (let r = N - 1; r >= 0; r--) {
      const prev = new Map();
      for (const [key, st] of layers[r]) {
        let ways = 0;
        for (const cand of rowCands[r]) {
          const ns = advance(st, cand, r);
          if (!ns) continue;
          const b = back.get(ns.key);
          if (!b) continue;
          ways += b;
          const w = st.count * b;
          for (let c = 0; c < N; c++) counts[r][c][cand[c]] += w;
        }
        if (ways) prev.set(key, ways);
      }
      back = prev;
    }
    const probs = grid((r, c) => counts[r][c].map((x) => x / total));
    return { total, counts, probs };
  }

  // ------------------------------------------------------------------
  // Human-style deductions, line by line, recorded as explainable steps.
  // Sound but incomplete: enumerate() is the ground truth.
  // ------------------------------------------------------------------
  function deduce(cons, revealed) {
    const poss = grid((r, c) => (revealed[r][c] == null ? FULL : bit(revealed[r][c])));
    const steps = [];
    const snapshots = [];
    let contradiction = false;

    const lines = [];
    for (let i = 0; i < N; i++) lines.push({ type: 'row', index: i, sum: cons.rows[i].sum, volt: cons.rows[i].volt });
    for (let i = 0; i < N; i++) lines.push({ type: 'col', index: i, sum: cons.cols[i].sum, volt: cons.cols[i].volt });
    const cellsOf = (line) =>
      Array.from({ length: N }, (_, i) => (line.type === 'row' ? { r: line.index, c: i } : { r: i, c: line.index }));
    const get = (x) => poss[x.r][x.c];
    const ref = (line) => ({ type: line.type, index: line.index });

    const record = (step) => {
      steps.push(step);
      snapshots.push(copy(poss));
    };
    const fail = (line, text) => {
      contradiction = true;
      record({
        kind: 'error',
        rule: 'contradiction',
        line: ref(line),
        cells: [],
        title: `${lineLabel(line)} : contradiction`,
        text: `${text} Vérifie la saisie de cette ${lineWord(line)}.`,
      });
    };
    const narrow = (cells, maskOf) => {
      const changes = [];
      for (const x of cells) {
        const before = get(x);
        const after = before & maskOf(x);
        if (after !== before) {
          poss[x.r][x.c] = after;
          changes.push({ r: x.r, c: x.c, before, after });
        }
      }
      return changes;
    };
    const stats = (line) => {
      let knownVolt = 0;
      let knownSum = 0;
      const unknown = [];
      for (const x of cellsOf(line)) {
        const m = get(x);
        if (popcount(m) === 1) {
          const v = single(m);
          if (v === VOLT) knownVolt++;
          else knownSum += v;
        } else unknown.push(x);
      }
      return { knownVolt, knownSum, unknown, remVolt: line.volt - knownVolt, remSum: line.sum - knownSum };
    };

    let changed = true;
    let guard = 0;
    while (changed && !contradiction && guard++ < 200) {
      changed = false;
      for (const line of lines) {
        if (contradiction) break;
        if (cellsOf(line).some((x) => get(x) === 0)) {
          fail(line, "Une carte n'a plus aucune valeur possible.");
          break;
        }
        let s = stats(line);
        if (s.remVolt < 0) {
          fail(line, `${s.knownVolt} Voltorbe sont déjà localisés alors que la ${lineWord(line)} n'en annonce que ${line.volt}.`);
          break;
        }
        if (s.remSum < 0) {
          fail(line, `Les cartes connues totalisent déjà ${s.knownSum} points, plus que les ${line.sum} annoncés.`);
          break;
        }
        if (s.remVolt > s.unknown.length) {
          fail(line, `Il reste ${s.remVolt} Voltorbe à placer mais seulement ${cards(s.unknown.length)} inconnue(s).`);
          break;
        }
        if (s.unknown.length === 0) {
          if (s.remSum !== 0) fail(line, `Toutes les cartes sont connues mais elles totalisent ${s.knownSum} au lieu de ${line.sum}.`);
          continue;
        }

        // --- Rule: no Voltorb left → every unknown card is safe ---
        if (s.remVolt === 0) {
          const ch = narrow(s.unknown, () => ~bit(VOLT));
          if (ch.length) {
            changed = true;
            record({
              kind: 'rule',
              rule: 'noVoltLeft',
              line: ref(line),
              cells: ch,
              title: `${lineLabel(line)} : aucun Voltorbe restant`,
              text:
                s.knownVolt === 0
                  ? `Cette ${lineWord(line)} annonce 0 Voltorbe : ${ch.length === 1 ? 'sa carte inconnue est sûre' : `ses ${cards(ch.length)} inconnues sont sûres`}.`
                  : `Cette ${lineWord(line)} annonce ${line.volt} Voltorbe et ${s.knownVolt === 1 ? 'il est déjà localisé' : 'ils sont déjà localisés'} : ${ch.length === 1 ? `la carte restante (${labels(ch)}) est sûre` : `les ${cards(ch.length)} restantes (${labels(ch)}) sont sûres`}.`,
            });
          }
        } else {
          // --- Rule: as many Voltorb left as cards able to hold one → they all are ---
          const canBeVolt = s.unknown.filter((x) => get(x) & bit(VOLT));
          if (canBeVolt.length < s.remVolt) {
            fail(line, `Il reste ${s.remVolt} Voltorbe à placer mais seulement ${cards(canBeVolt.length)} peut/peuvent encore en être.`);
            break;
          }
          if (canBeVolt.length === s.remVolt) {
            const ch = narrow(canBeVolt, () => bit(VOLT));
            if (ch.length) {
              changed = true;
              const others = s.unknown.filter((x) => !(get(x) & bit(VOLT)) && !ch.some((y) => y.r === x.r && y.c === x.c));
              record({
                kind: 'rule',
                rule: 'allVolts',
                line: ref(line),
                cells: ch,
                title: `${lineLabel(line)} : Voltorbe localisé${s.remVolt > 1 ? 's' : ''}`,
                text: `Il reste ${s.remVolt} Voltorbe à placer et ${
                  canBeVolt.length === s.unknown.length
                    ? `seulement ${cards(s.unknown.length)} inconnue${s.unknown.length > 1 ? 's' : ''}`
                    : `seulement ${cards(canBeVolt.length)} qui ${canBeVolt.length > 1 ? 'peuvent' : 'peut'} encore en être`
                } : ${labels(ch)} ${ch.length > 1 ? 'sont forcément des Voltorbe' : 'est forcément un Voltorbe'}.${
                  others.length ? ` Les autres cartes de la ${lineWord(line)} (${labels(others)}) sont donc sûres.` : ''
                }`,
              });
            }
          }
        }

        // --- Rule: a card cannot be a Voltorb when, without it, the other
        //     cards could not reach the remaining sum ---
        s = stats(line);
        let n = s.unknown.length;
        if (n === 0) continue;
        let m = n - s.remVolt; // non-Voltorb cards among the unknown ones
        if (m === 0) {
          if (s.remSum !== 0) fail(line, `Les ${cards(n)} inconnues sont des Voltorbe mais il reste ${s.remSum} points à placer.`);
          continue;
        }
        {
          const masks = s.unknown.map(get);
          const ch = [];
          let reach = 0;
          s.unknown.forEach((x, i) => {
            if (!(masks[i] & bit(VOLT))) return;
            const maxes = masks.filter((_, j) => j !== i).map(maxNV).sort((a, b) => b - a);
            const top = sum(maxes.slice(0, m));
            if (top < s.remSum) {
              poss[x.r][x.c] = masks[i] & ~bit(VOLT);
              ch.push({ r: x.r, c: x.c, before: masks[i], after: poss[x.r][x.c] });
              reach = Math.max(reach, top);
            }
          });
          if (ch.length) {
            changed = true;
            record({
              kind: 'rule',
              rule: 'mustBeSafe',
              line: ref(line),
              cells: ch,
              title: `${lineLabel(line)} : ${ch.length > 1 ? 'cartes indispensables' : 'carte indispensable'} à la somme`,
              text: `Il reste ${s.remSum} points à trouver. Si ${ch.length > 1 ? `l'une de ces cartes (${labels(ch)})` : labels(ch)} était un Voltorbe, les autres cartes ne pourraient totaliser que ${reach} points au mieux : ${
                ch.length > 1 ? `ces ${cards(ch.length)} sont sûres` : 'cette carte est sûre'
              }.`,
            });
          }
        }

        // --- Rule: bounds on the non-Voltorb values from the remaining sum,
        //     computed from the state before this step so the explanation
        //     matches what the player sees ---
        s = stats(line);
        n = s.unknown.length;
        m = n - s.remVolt;
        if (n === 0 || m === 0) continue;
        const masks = s.unknown.map(get);
        const changes = [];
        const groups = new Map();
        let refined = false;
        for (let i = 0; i < s.unknown.length && !contradiction; i++) {
          const x = s.unknown[i];
          const otherMasks = masks.filter((_, j) => j !== i);
          const maxes = otherMasks.map(maxNV).sort((a, b) => b - a);
          const mins = otherMasks.map(minNV).sort((a, b) => a - b);
          const sumTop = sum(maxes.slice(0, m - 1));
          const sumBottom = sum(mins.slice(0, m - 1));
          const lo = s.remSum - sumTop;
          const hi = s.remSum - sumBottom;
          let allowed = 0;
          for (let v = 1; v <= 3; v++) if (v >= lo && v <= hi) allowed |= bit(v);
          const before = masks[i];
          const after = (before & bit(VOLT)) | (before & allowed);
          if (after === 0) {
            fail(line, `Avec ${s.remSum} points restants pour ${cards(m)} non-Voltorbe, ${cellLabel(x.r, x.c)} n'a plus aucune valeur possible.`);
            break;
          }
          if (after !== before) {
            if (sumTop !== 3 * (m - 1) || sumBottom !== m - 1) refined = true;
            poss[x.r][x.c] = after;
            const change = { r: x.r, c: x.c, before, after };
            changes.push(change);
            const key = `${lo}-${hi}`;
            if (!groups.has(key)) groups.set(key, { lo: Math.max(lo, 1), hi: Math.min(hi, 3), cells: [] });
            groups.get(key).cells.push(change);
          }
        }
        if (contradiction) break;
        if (!changes.length) continue;
        changed = true;

        const everyOne = changes.every((ch) => (ch.after & ~bit(VOLT)) === bit(1));
        const everyThree = changes.every((ch) => (ch.after & ~bit(VOLT)) === bit(3));
        const lead = `Il reste ${s.remSum} point${s.remSum > 1 ? 's' : ''} pour ${cards(m)} non-Voltorbe${
          n > m ? ` parmi ${n} inconnues` : ''
        }.`;
        let rule = 'bounds';
        let title;
        let text;
        if (everyOne && !refined) {
          rule = 'allOnes';
          title = `${lineLabel(line)} : que des 1`;
          text = `${lead} Chacune vaut exactement 1 : ${
            n === m ? 'ces cartes sont sûres mais ne rapportent rien' : `rien à gagner sur cette ${lineWord(line)}, seulement des Voltorbe à éviter`
          }.`;
        } else if (everyThree && !refined) {
          rule = 'allThrees';
          title = `${lineLabel(line)} : que des 3`;
          text = `${lead} Chacune vaut forcément 3.`;
        } else {
          title = `${lineLabel(line)} : bornes sur les valeurs`;
          const parts = [];
          for (const g of groups.values()) {
            const removed = [];
            for (let v = 1; v <= 3; v++) if (g.cells.some((ch) => ch.before & bit(v) && !(ch.after & bit(v)))) removed.push(v);
            const who = labels(g.cells);
            const verb = g.cells.length > 1 ? 'valent' : 'vaut';
            const onlyVolt = g.cells.every((ch) => ch.after === bit(VOLT));
            let why;
            if (onlyVolt) why = `aucune valeur entre 1 et 3 ne convient pour ${who} → ${g.cells.length > 1 ? 'ce sont forcément des Voltorbe' : "c'est forcément un Voltorbe"}`;
            else if (refined) why = `les autres cartes étant déjà bornées, ${who} ${verb} ${g.lo === g.hi ? `forcément ${g.lo}` : `entre ${g.lo} et ${g.hi}`} → pas de ${removed.join(' ni de ')}`;
            else if (g.lo >= 2 && g.hi >= 3) why = `même si ${m - 1 > 1 ? `les ${m - 1} autres valent` : "l'autre vaut"} 3, ${who} ${verb} au moins ${g.lo} → pas de ${removed.join(' ni de ')}`;
            else if (g.hi <= 2 && g.lo <= 1) why = `même si ${m - 1 > 1 ? `les ${m - 1} autres valent` : "l'autre vaut"} 1, ${who} ${verb} au plus ${g.hi} → pas de ${removed.join(' ni de ')}`;
            else why = `${who} ${verb} ${g.lo === g.hi ? `forcément ${g.lo}` : `entre ${g.lo} et ${g.hi}`} → pas de ${removed.join(' ni de ')}`;
            parts.push(why);
          }
          const joined = parts.join(' ; ');
          text = `${lead} ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
        }
        record({ kind: 'rule', rule, line: ref(line), cells: changes, title, text });
      }
    }
    return { steps, snapshots, poss, contradiction };
  }

  // ------------------------------------------------------------------
  // Everything the UI needs: validation, deduction steps, exact
  // probabilities, cell classification and the recommendation.
  // ------------------------------------------------------------------
  function analyze(cons, revealed) {
    const base = {
      status: null,
      errors: [],
      steps: [],
      snapshots: [],
      enumStepIndex: -1,
      total: 0,
      cells: null,
      safeCells: [],
      deadCells: [],
      bestGuess: null,
      guesses: [],
    };
    const v = validate(cons);
    if (!v.complete) return { ...base, status: 'incomplete' };
    if (!v.ok) return { ...base, status: 'invalid', errors: v.errors };
    if (revealed.some((row) => row.some((x) => x === VOLT))) return { ...base, status: 'lost' };

    const d = deduce(cons, revealed);
    if (d.contradiction) {
      const last = d.steps[d.steps.length - 1];
      return { ...base, status: 'impossible', steps: d.steps, snapshots: d.snapshots, errors: [{ line: last.line.type, index: last.line.index, part: null, message: last.text }] };
    }
    const e = enumerate(cons, revealed);
    if (e.total === 0) {
      const step = {
        kind: 'error',
        rule: 'contradiction',
        line: null,
        cells: [],
        title: 'Aucune grille possible',
        text: "Chaque ligne est cohérente prise seule, mais aucune grille ne satisfait toutes les contraintes à la fois : une valeur saisie est fausse.",
      };
      return { ...base, status: 'impossible', steps: [...d.steps, step], snapshots: [...d.snapshots, copy(d.poss)], errors: [{ line: null, index: null, part: null, message: step.text }] };
    }

    const possEnum = grid((r, c) => {
      let m = 0;
      for (let val = 0; val <= 3; val++) if (e.counts[r][c][val] > 0) m |= bit(val);
      return m;
    });
    const narrowed = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (possEnum[r][c] !== d.poss[r][c]) narrowed.push({ r, c, before: d.poss[r][c], after: possEnum[r][c] });
      }
    }
    const steps = d.steps.slice();
    const snapshots = d.snapshots.slice();

    const safeFound = narrowed.filter((x) => x.before & bit(VOLT) && !(x.after & bit(VOLT)));
    const voltFound = narrowed.filter((x) => x.after === bit(VOLT));
    let enumText;
    if (e.total === 1) {
      enumText = `${steps.length ? 'Les règles simples ne vont pas plus loin, alors j' : 'J'}'ai énuméré toutes les grilles compatibles : une seule existe, tout est déterminé !`;
    } else {
      enumText = `${steps.length ? 'Les règles simples ne vont pas plus loin, alors j' : 'J'}'ai énuméré toutes les grilles compatibles avec les contraintes : ${e.total.toLocaleString('fr-FR')} grilles possibles. Le risque de chaque carte est la part de ces grilles où elle est un Voltorbe.`;
      if (narrowed.length) {
        const bits = [];
        if (safeFound.length) bits.push(`${labels(safeFound)} ${safeFound.length > 1 ? "ne sont jamais des Voltorbe" : "n'est jamais un Voltorbe"}`);
        if (voltFound.length) bits.push(`${labels(voltFound)} ${voltFound.length > 1 ? 'en sont toujours' : 'en est toujours un'}`);
        const rest = narrowed.length - safeFound.length - voltFound.length;
        if (rest > 0) bits.push(`${cards(rest)} perd${rest > 1 ? 'ent' : ''} encore des valeurs possibles`);
        enumText += ` Cela affine ce que les règles n'avaient pas vu : ${bits.join(' ; ')}.`;
      }
    }
    steps.push({
      kind: 'enum',
      rule: 'enum',
      line: null,
      cells: narrowed,
      title: e.total === 1 ? 'Énumération : grille unique' : `Énumération : ${e.total.toLocaleString('fr-FR')} grilles possibles`,
      text: enumText,
    });
    snapshots.push(possEnum);

    const cells = grid((r, c) => {
      const p = e.probs[r][c];
      const pVolt = p[0];
      const pGain = p[2] + p[3];
      let kind;
      if (revealed[r][c] != null) kind = 'revealed';
      else if (pVolt === 0 && pGain > 0) kind = 'safe';
      else if (pVolt === 0) kind = 'one';
      else if (pVolt === 1) kind = 'volt';
      else if (pGain === 0) kind = 'dead';
      else kind = 'risk';
      return { r, c, revealed: revealed[r][c], pVolt, p1: p[1], p2: p[2], p3: p[3], pGain, poss: possEnum[r][c], kind, label: cellLabel(r, c) };
    });
    const flat = cells.flat();
    const safeCells = flat.filter((x) => x.kind === 'safe').sort((a, b) => b.pGain - a.pGain);
    const deadCells = flat.filter((x) => x.kind === 'dead');
    const guesses = flat.filter((x) => x.kind === 'risk').sort((a, b) => a.pVolt - b.pVolt || b.pGain - a.pGain);
    const remainingGain = flat.some((x) => x.revealed == null && x.pGain > 0);

    let status;
    let bestGuess = null;
    let result;
    if (!remainingGain) {
      status = 'done';
      result = {
        title: 'Niveau terminé !',
        text: "Tous les 2 et les 3 sont retournés : il ne reste que des 1 et des Voltorbe. Le jeu passe au niveau suivant.",
      };
    } else if (safeCells.length) {
      status = 'safe';
      result = {
        title: `${cards(safeCells.length)} sûre${safeCells.length > 1 ? 's' : ''} à retourner`,
        text: `${labels(safeCells)} ${safeCells.length > 1 ? 'ne peuvent pas être des Voltorbe' : 'ne peut pas être un Voltorbe'}${
          safeCells.every((x) => popcount(x.poss) === 1)
            ? ` et ${safeCells.length > 1 ? 'valent' : 'vaut'} ${safeCells.map((x) => single(x.poss)).join(' et ')} à coup sûr`
            : ` et ${safeCells.length > 1 ? 'peuvent' : 'peut'} valoir 2 ou 3`
        } : retourne-${safeCells.length > 1 ? 'les' : 'la'} sans aucun risque, puis saisis ${safeCells.length > 1 ? 'leurs valeurs' : 'sa valeur'} ici pour affiner la suite.`,
      };
    } else {
      status = 'guess';
      bestGuess = guesses[0];
      const risky = bestGuess.pVolt >= 0.25;
      result = {
        title: `Pas de carte sûre : meilleur pari ${bestGuess.label}`,
        text: `Aucune carte n'est garantie. ${bestGuess.label} a le risque le plus faible : ${pct(bestGuess.pVolt)} de Voltorbe, ${pct(bestGuess.pGain)} de chances de valoir 2 ou 3.${
          risky ? " Le risque est élevé : si tu tiens à tes jetons, c'est le moment de « S'arrêter là »." : ' Le risque reste raisonnable.'
        }`,
      };
    }
    steps.push({ kind: 'result', rule: status, line: null, cells: [], title: result.title, text: result.text });
    snapshots.push(possEnum);

    return {
      ...base,
      status,
      steps,
      snapshots,
      enumStepIndex: steps.length - 2,
      total: e.total,
      probs: e.probs,
      cells,
      safeCells,
      deadCells,
      bestGuess,
      guesses: guesses.slice(0, 3),
    };
  }

  return { N, FULL, VOLT, COLS, COLORS, bit, lineCandidates, validate, enumerate, deduce, analyze, cellLabel, lineLabel };
});
