/*
 * Connexions solver — pure logic, no DOM.
 * Sixteen Pokémon, four groups of four sharing a category value (type,
 * generation, place in the family, evolution family, first letter, name length,
 * or one of the rarer card-based categories). Exposed as `ConnexionsSolver` in
 * the browser and as a CommonJS module for tests.
 *
 * entry = { name, form, types: string[], gen: number|null, lineage: string|null,
 *           place: 0|1|2|3|null (does not evolve / first / middle / last), special: bool, hp300: bool }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ConnexionsSolver = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 16;
  const GROUP = 4;
  // display order ≈ how specific (hence how likely intended) a category is
  const CATEGORIES = [
    { id: 'family', label: "Une famille d'évolution", rare: false },
    { id: 'type', label: 'Un type', rare: false },
    { id: 'gen', label: 'Une génération', rare: false },
    { id: 'place', label: 'Une place dans la famille', rare: false },
    { id: 'letter', label: 'Une première lettre', rare: false },
    { id: 'length', label: 'La longueur du nom', rare: false },
    { id: 'special', label: 'Une sorte de carte', rare: true },
    { id: 'hp300', label: '300 PV ou plus', rare: true },
    { id: 'collection', label: 'Dans ta collection', rare: true },
  ];
  const RANK = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i]));
  const RARE = new Set(CATEGORIES.filter((c) => c.rare).map((c) => c.id));
  const PLACES = { 0: ['solo', "N'évoluent pas"], 1: ['first', 'Premiers de leur famille'], 2: ['middle', 'Au milieu de leur famille'], 3: ['last', 'Dernières évolutions'] };

  const fold = (s) => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => fold(s).trim().toLowerCase();
  const letters = (name) => fold(name).replace(/[-\s.'’]/g, '').length;
  const firstLetter = (name) => fold(name).trim().charAt(0).toUpperCase();
  const elide = (name) => (/^[aeiouyh]/i.test(fold(name).trim()) ? `d'${String(name).trim()}` : `de ${String(name).trim()}`);
  const entryName = (e, i) => {
    const n = (e.name || '').trim();
    if (!n) return `Pokémon ${i + 1}`;
    return e.form ? `${n} ${e.form}` : n;
  };

  const isComplete = (e) => !!e && typeof e.name === 'string' && e.name.trim() !== '' && Array.isArray(e.types) && e.types.length > 0 && e.gen != null && e.gen !== '' && Number.isInteger(Number(e.gen));

  // Pokédex entry (data/pokedex.js) → solver entry
  function fromPokedex(m) {
    return {
      name: m.n, form: m.f || null, types: (m.t || []).slice(0, 2), gen: m.g, lineage: m.l || '',
      place: Number.isInteger(m.s) ? m.s : null, special: !!m.k, hp300: !!m.h, id: m.id, sprite: m.p || m.id,
    };
  }

  function attributes(e) {
    const out = [];
    for (const t of e.types || []) out.push({ category: 'type', value: t, label: `Type ${t}` });
    if (e.gen != null && e.gen !== '') out.push({ category: 'gen', value: String(Number(e.gen)), label: `Génération ${Number(e.gen)}` });
    if (e.place != null && PLACES[e.place]) out.push({ category: 'place', value: PLACES[e.place][0], label: PLACES[e.place][1] });
    if (e.lineage && norm(e.lineage)) out.push({ category: 'family', value: norm(e.lineage), label: `Famille ${elide(e.lineage)}` });
    const fl = firstLetter(e.name);
    if (fl) out.push({ category: 'letter', value: fl, label: `Commence par ${fl}` });
    const n = letters(e.name);
    if (n > 0 && n <= 5) out.push({ category: 'length', value: 'short', label: 'Nom court (5 lettres ou moins)' });
    else if (n >= 10) out.push({ category: 'length', value: 'long', label: 'Nom long (10 lettres ou plus)' });
    if (e.special) out.push({ category: 'special', value: 'special', label: 'Carte ex, GX, V, VMAX, VSTAR ou Méga' });
    if (e.hp300) out.push({ category: 'hp300', value: 'hp300', label: 'Une carte à 300 PV ou plus' });
    return out;
  }

  const sortReasons = (reasons) => reasons.sort((a, b) => RANK[a.category] - RANK[b.category] || String(a.value).localeCompare(String(b.value)));
  const isRare = (reasons) => reasons.every((r) => RARE.has(r.category));

  // every quartet sharing at least one attribute value, reasons merged
  function groups(entries) {
    const byKey = new Map(); // "category:value" → { attr, members }
    entries.forEach((e, i) => {
      for (const a of attributes(e)) {
        const k = `${a.category}:${a.value}`;
        if (!byKey.has(k)) byKey.set(k, { attr: a, members: [] });
        byKey.get(k).members.push(i);
      }
    });
    const found = new Map(); // "a,b,c,d" → group
    for (const { attr, members } of byKey.values()) {
      const n = members.length;
      if (n < GROUP) continue;
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
        const m = [members[a], members[b], members[c], members[d]];
        const key = m.join(',');
        if (!found.has(key)) found.set(key, { key, members: m, reasons: [], rare: true });
        found.get(key).reasons.push({ category: attr.category, value: attr.value, label: attr.label });
      }
    }
    const out = [];
    for (const g of found.values()) {
      sortReasons(g.reasons);
      g.rare = isRare(g.reasons);
      out.push(g);
    }
    return out.sort((x, y) => x.key.localeCompare(y.key, undefined, { numeric: true }));
  }

  // Exact covers of the 16 by 4 groups (at most one rare). Because "Dans ta collection" cannot be
  // computed, a Pokémon may also be "deferred" to a last quartet with nothing in common, which is
  // reported as that probable collection group (rare, so the three other groups must be ordinary).
  function enumerate(entries, allGroups, limit) {
    const n = entries.length;
    const byMember = Array.from({ length: n }, () => []);
    for (const g of allGroups) for (const m of g.members) byMember[m].push(g);
    const groupByKey = new Map(allGroups.map((g) => [g.key, g]));
    const used = new Array(n).fill(false);
    const deferred = [];
    const chosen = [];
    const full = [];
    const guessed = [];
    let truncated = false;
    const cap = () => full.length >= limit || guessed.length >= limit;
    (function rec(rareCount) {
      if (cap()) { truncated = true; return; }
      let pivot = -1;
      for (let i = 0; i < n; i++) if (!used[i]) { pivot = i; break; }
      if (pivot < 0) {
        if (deferred.length === 0) full.push({ groups: chosen.slice(), guessed: false, rareCount });
        else if (deferred.length === GROUP) {
          const key = deferred.slice().sort((a, b) => a - b).join(',');
          if (!groupByKey.has(key)) {
            guessed.push({
              groups: chosen.concat([{ key, members: key.split(',').map(Number), reasons: [{ category: 'collection', value: 'collection', label: 'Dans ta collection (probablement)' }], rare: true }]),
              guessed: true, rareCount: 1,
            });
          }
        }
        return;
      }
      for (const g of byMember[pivot]) {
        if (g.members.some((m) => used[m])) continue;
        const r = rareCount + (g.rare ? 1 : 0);
        if (r > 1) continue;
        for (const m of g.members) used[m] = true;
        chosen.push(g);
        rec(r);
        chosen.pop();
        for (const m of g.members) used[m] = false;
        if (cap()) { truncated = true; return; }
      }
      if (deferred.length < GROUP && rareCount === 0) {
        used[pivot] = true;
        deferred.push(pivot);
        rec(rareCount);
        deferred.pop();
        used[pivot] = false;
      }
    })(0);
    return { full, guessed, truncated };
  }

  const specificity = (sol) => sol.groups.reduce((s, g) => s + RANK[g.reasons[0].category], 0);

  function analyze(entries, opts) {
    const limit = (opts && opts.limit) || 200;
    const list = Array.from({ length: SIZE }, (_, i) => entries[i] || {});
    const missing = list.map((e, i) => (isComplete(e) ? -1 : i)).filter((i) => i >= 0);
    if (missing.length) return { status: 'incomplete', missing, count: 0, solutions: [], sure: [], groups: [], degree: [], isolated: [] };

    const all = groups(list);
    const degree = list.map((_, i) => all.filter((g) => g.members.includes(i)).length);
    const isolated = degree.map((d, i) => (d === 0 ? i : -1)).filter((i) => i >= 0);
    const { full, guessed, truncated } = enumerate(list, all, limit);
    // a fully explained partition always beats a guess about the player's collection
    const kept = full.length ? full.sort((a, b) => a.rareCount - b.rareCount || specificity(a) - specificity(b)) : guessed.sort((a, b) => specificity(a) - specificity(b));
    const solutions = kept.map((s) => ({ ...s, groups: s.groups.map((g) => ({ key: g.key, members: g.members.slice(), reasons: g.reasons.map((r) => ({ ...r })), rare: g.rare })) }));
    if (!solutions.length) {
      return { status: 'impossible', missing: [], count: 0, solutions: [], sure: [], groups: all, degree, isolated, truncated: false };
    }
    // groups present in every solution
    const counts = new Map();
    for (const s of solutions) for (const g of s.groups) counts.set(g.key, (counts.get(g.key) || 0) + 1);
    const sure = solutions[0].groups.filter((g) => counts.get(g.key) === solutions.length);
    const sureKeys = new Set(sure.map((g) => g.key));
    for (const s of solutions) {
      for (const g of s.groups) g.sure = sureKeys.has(g.key);
      s.groups.sort((a, b) => Number(b.sure) - Number(a.sure) || Number(a.rare) - Number(b.rare) || RANK[a.reasons[0].category] - RANK[b.reasons[0].category]);
    }
    return { status: 'solved', missing: [], count: solutions.length, solutions, sure, groups: all, degree, isolated, truncated: truncated && solutions.length >= limit };
  }

  return { SIZE, GROUP, CATEGORIES, PLACES, letters, firstLetter, entryName, isComplete, fromPokedex, attributes, groups, analyze };
});
