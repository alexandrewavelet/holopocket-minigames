/*
 * Cartodle solver — "Wordle" over Pokémon TCG cards, pure logic, no DOM.
 * Exposed as `CartodleSolver` in the browser and as a CommonJS module for tests.
 *
 * card (decoded): { id, localId, name, dex, type, stage, hp, rarity, rank,
 *                   set: { id, name, serie: { id, name }, date }, illustrator, suffix, image }
 * feedback: { pokemon: eq|up|down, type: eq|no, stage: eq|no, hp: eq|near|up|down,
 *             rarity: eq|up|down, set: eq|near|up|down, illustrator: eq|no }
 *   up = the mystery card has a bigger Pokédex number / more HP / is rarer / came out later.
 * guess: { card, fb }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CartodleSolver = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ATTRS = ['pokemon', 'type', 'stage', 'hp', 'rarity', 'set', 'illustrator'];
  const LABELS = { pokemon: 'Pokémon', type: 'Type', stage: 'Stade', hp: 'PV', rarity: 'Rareté', set: 'Extension', illustrator: 'Illustrateur' };
  // which answers the game can give for each attribute (and the order the UI cycles through them)
  const STATES = {
    pokemon: ['eq', 'up', 'down'],
    type: ['eq', 'no'],
    stage: ['eq', 'no'],
    hp: ['eq', 'near', 'up', 'down'],
    rarity: ['eq', 'up', 'down'],
    set: ['eq', 'near', 'up', 'down'],
    illustrator: ['eq', 'no'],
  };
  const HP_NEAR = 20;
  const POCKET = 'tcgp';
  const listFr = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}` : items.join(''));
  const plural = (n, one, many) => (n > 1 ? many : one);

  // ---- rarity ladder: least rare → rarest; names on one line are the same level ----
  const RANKS = [
    { label: 'Commune', names: ['Commune', 'Un Diamant'] },
    { label: 'Peu Commune', names: ['Peu Commune', 'Deux Diamants'] },
    { label: 'Rare', names: ['Rare', 'Trois Diamants', 'Rare Noir Blanc'] },
    { label: 'Rare Holo', names: ['Holo Rare', 'Rare Holo', 'Promo', 'Collection Classique', 'Magnifique'] },
    { label: 'Rare Holo V / Double rare', names: ['Holo Rare V', 'Double rare', 'Rare Holo LV.X', 'Rare Prime', 'LÉGENDE', 'Quatre Diamants', 'Radieux Rare', 'Pikachu Rare'] },
    { label: 'Ultra Rare', names: ['Ultra Rare', 'Holo Rare VMAX', 'Holo Rare VSTAR', 'Une Étoile', 'Mega Attack Rare'] },
    { label: 'Illustration rare', names: ['Illustration rare', 'Magnifique rare', 'Shiny rare', 'Shiny rare V', 'Shiny rare VMAX', 'Un Chromatique', 'Deux Étoiles', 'Futuristic Rare', 'RGB Rare'] },
    { label: 'Illustration spéciale rare', names: ['Illustration spéciale rare', 'Chromatique ultra rare', 'Deux Chromatiques', 'Trois Étoiles'] },
    { label: 'Hyper rare', names: ['Hyper rare', 'Méga Hyper Rare', 'Couronne'] },
  ];
  const RANK_OF = new Map();
  RANKS.forEach((r, i) => r.names.forEach((n) => RANK_OF.set(n, i)));
  const RANK_RARE = RANK_OF.get('Rare');
  const RANK_NONE = -1;
  function rankOf(name) {
    if (name == null || name === '' || name === 'Sans Rareté') return RANK_NONE;
    return RANK_OF.has(name) ? RANK_OF.get(name) : RANK_RARE;
  }
  const rankLabel = (rank) => (rank < 0 ? 'sans rareté' : RANKS[rank].label);

  // ---- database ----
  function decode(db) {
    const F = Object.fromEntries(db.fields.map((f, i) => [f, i]));
    const series = db.series.map((s) => ({ id: s.id, name: s.name }));
    const sets = db.sets.map((s, i) => ({ id: s.id, name: s.name, serie: series[s.serie] || { id: '?', name: '?' }, date: s.date || '', i }));
    return db.cards.map((row, i) => {
      const set = sets[row[F.set]];
      const rarity = row[F.rarity] == null ? null : db.rarities[row[F.rarity]];
      return {
        i,
        id: `${set.id}-${row[F.localId]}`,
        localId: row[F.localId],
        name: row[F.name],
        dex: row[F.dex],
        type: row[F.type] == null ? null : db.types[row[F.type]],
        stage: row[F.stage] == null ? null : db.stages[row[F.stage]],
        hp: row[F.hp],
        rarity,
        rank: rankOf(rarity),
        set,
        illustrator: row[F.illustrator] == null ? null : db.illustrators[row[F.illustrator]],
        suffix: row[F.suffix] || null,
        image: row[F.image] ? `https://assets.tcgdex.net/fr/${set.serie.id}/${set.id}/${row[F.localId]}/low.webp` : null,
      };
    });
  }
  const isCandidate = (card, opts) => card.rank >= RANK_RARE && (!!(opts && opts.pocket) || card.set.serie.id !== POCKET);
  const candidates = (cards, opts) => cards.filter((c) => isCandidate(c, opts));

  // ---- feedback ----
  const cmp = (a, b) => (a === b ? 'eq' : a < b ? 'up' : 'down'); // "up" = the secret is bigger
  function feedback(guess, secret) {
    const dh = secret.hp - guess.hp;
    return {
      pokemon: cmp(guess.dex, secret.dex),
      type: guess.type != null && guess.type === secret.type ? 'eq' : 'no',
      stage: guess.stage != null && guess.stage === secret.stage ? 'eq' : 'no',
      hp: dh === 0 ? 'eq' : Math.abs(dh) <= HP_NEAR ? 'near' : dh > 0 ? 'up' : 'down',
      rarity: cmp(guess.rank, secret.rank),
      set: guess.set.id === secret.set.id ? 'eq' : guess.set.serie.id === secret.set.serie.id ? 'near' : secret.set.date >= guess.set.date ? 'up' : 'down',
      illustrator: guess.illustrator != null && guess.illustrator === secret.illustrator ? 'eq' : 'no',
    };
  }
  // Tolerant reading of the game's answers: never drop the true card because of a display nuance.
  function matches(card, guess, fb) {
    switch (fb.pokemon) {
      case 'eq': if (card.dex !== guess.dex) return false; break;
      case 'up': if (!(card.dex > guess.dex)) return false; break;
      case 'down': if (!(card.dex < guess.dex)) return false; break;
      default: break;
    }
    // an attribute the database does not know for the guess cannot be checked: ignore the answer
    if (guess.type != null && (fb.type === 'eq' ? card.type !== guess.type : fb.type === 'no' ? card.type === guess.type : false)) return false;
    if (guess.stage != null && (fb.stage === 'eq' ? card.stage !== guess.stage : fb.stage === 'no' ? card.stage === guess.stage : false)) return false;
    const dh = card.hp - guess.hp;
    switch (fb.hp) {
      case 'eq': if (dh !== 0) return false; break;
      case 'near': if (dh === 0 || Math.abs(dh) > HP_NEAR) return false; break;
      case 'up': if (!(dh > 0)) return false; break;
      case 'down': if (!(dh < 0)) return false; break;
      default: break;
    }
    switch (fb.rarity) {
      case 'eq': case 'near': if (card.rank !== guess.rank) return false; break;
      case 'up': if (!(card.rank > guess.rank)) return false; break;
      case 'down': if (!(card.rank < guess.rank)) return false; break;
      default: break;
    }
    switch (fb.set) {
      case 'eq': if (card.set.id !== guess.set.id) return false; break;
      case 'near': if (card.set.id === guess.set.id || card.set.serie.id !== guess.set.serie.id) return false; break;
      case 'up': if (card.set.serie.id === guess.set.serie.id || !(card.set.date >= guess.set.date)) return false; break;
      case 'down': if (card.set.serie.id === guess.set.serie.id || !(card.set.date < guess.set.date)) return false; break;
      default: break;
    }
    if (guess.illustrator != null && (fb.illustrator === 'eq' ? card.illustrator !== guess.illustrator : fb.illustrator === 'no' ? card.illustrator === guess.illustrator : false)) return false;
    return true;
  }
  const UNKNOWABLE = { type: 'type', stage: 'stage', illustrator: 'illustrator' };
  // every answer is ✓ — except on attributes the database does not know for that card, where any answer goes
  const isWin = (fb, guess) => ATTRS.every((a) => fb[a] === 'eq' || (!!guess && UNKNOWABLE[a] && guess[UNKNOWABLE[a]] == null && !!fb[a]));
  const complete = (fb) => ATTRS.every((a) => STATES[a].includes(fb[a]));

  // feedback → small integer, for bucketing
  const KEY_BASE = ATTRS.map((a) => STATES[a].length);
  function feedbackKey(guess, secret) {
    const fb = feedback(guess, secret);
    let k = 0;
    for (let i = 0; i < ATTRS.length; i++) k = k * KEY_BASE[i] + STATES[ATTRS[i]].indexOf(fb[ATTRS[i]]);
    return k;
  }

  // ---- facts the player learns from one answer (French, for the steps) ----
  const year = (set) => (set.date ? set.date.slice(0, 4) : '?');
  function facts(guess, fb) {
    const g = guess;
    const out = [];
    const F = {
      pokemon: { eq: `même Pokémon : ${g.name.replace(/\s(V|VMAX|VSTAR|ex|EX|GX)$/i, '')} (n° ${g.dex})`, up: `n° de Pokédex plus grand que ${g.dex}`, down: `n° de Pokédex plus petit que ${g.dex}` },
      type: { eq: `type ${g.type}`, no: `pas de type ${g.type}` },
      stage: { eq: `stade ${g.stage}`, no: `pas de stade ${g.stage}` },
      hp: { eq: `${g.hp} PV`, near: `PV à 20 près de ${g.hp}`, up: `plus de ${g.hp} PV`, down: `moins de ${g.hp} PV` },
      rarity: { eq: `rareté ${rankLabel(g.rank)}`, near: `rareté ${rankLabel(g.rank)}`, up: `plus rare que ${g.rarity}`, down: `moins rare que ${g.rarity}` },
      set: { eq: `extension ${g.set.name}`, near: `série ${g.set.serie.name}, mais pas ${g.set.name}`, up: `extension sortie après ${g.set.name} (${year(g.set)}), autre série`, down: `extension sortie avant ${g.set.name} (${year(g.set)}), autre série` },
      illustrator: { eq: `illustrée par ${g.illustrator}`, no: g.illustrator ? `pas illustrée par ${g.illustrator}` : 'illustrateur inconnu' },
    };
    for (const a of ATTRS) if (F[a][fb[a]]) out.push(F[a][fb[a]]);
    return out;
  }

  // ---- what the remaining candidates have in common (the "carnet") ----
  function constraints(cands) {
    if (!cands.length) return [];
    const distinct = (f) => { const s = new Set(); for (const c of cands) s.add(f(c)); return s; };
    const minmax = (f) => { let lo = Infinity, hi = -Infinity; for (const c of cands) { const v = f(c); if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };
    const out = [];
    const dexes = distinct((c) => c.dex);
    if (dexes.size === 1) out.push({ key: 'pokemon', label: LABELS.pokemon, value: `${cands[0].name.replace(/\s(V|VMAX|VSTAR|ex|EX|GX)$/i, '')} (n° ${cands[0].dex})`, sure: true });
    else { const [lo, hi] = minmax((c) => c.dex); out.push({ key: 'pokemon', label: LABELS.pokemon, value: `n° ${lo} – ${hi} (${dexes.size} Pokémon possibles)`, sure: false }); }
    const listOrCount = (key, set, what) => {
      const vals = [...set].filter((v) => v != null);
      if (set.size === 1) out.push({ key, label: LABELS[key], value: vals[0] == null ? 'inconnu' : vals[0], sure: true });
      else if (vals.length <= 3) out.push({ key, label: LABELS[key], value: vals.join(' ou ') || 'inconnu', sure: false });
      else out.push({ key, label: LABELS[key], value: `${vals.length} ${what} possibles`, sure: false });
    };
    listOrCount('type', distinct((c) => c.type), 'types');
    listOrCount('stage', distinct((c) => c.stage), 'stades');
    const hps = distinct((c) => c.hp);
    if (hps.size === 1) out.push({ key: 'hp', label: LABELS.hp, value: `${cands[0].hp} PV`, sure: true });
    else { const [lo, hi] = minmax((c) => c.hp); out.push({ key: 'hp', label: LABELS.hp, value: `${lo} – ${hi} PV`, sure: false }); }
    const ranks = distinct((c) => c.rank);
    if (ranks.size === 1) { const names = distinct((c) => c.rarity); out.push({ key: 'rarity', label: LABELS.rarity, value: names.size === 1 ? cands[0].rarity : rankLabel(cands[0].rank), sure: true }); }
    else { const [lo, hi] = minmax((c) => c.rank); out.push({ key: 'rarity', label: LABELS.rarity, value: `de ${rankLabel(lo)} à ${rankLabel(hi)}`, sure: false }); }
    const sets = distinct((c) => c.set.id);
    const series = distinct((c) => c.set.serie.id);
    if (sets.size === 1) out.push({ key: 'set', label: LABELS.set, value: `${cands[0].set.name} (${year(cands[0].set)})`, sure: true });
    else if (series.size === 1) out.push({ key: 'set', label: LABELS.set, value: `série ${cands[0].set.serie.name}, ${sets.size} extensions possibles`, sure: false });
    else { const [lo, hi] = minmax((c) => Number(c.set.date.slice(0, 4)) || 0); out.push({ key: 'set', label: LABELS.set, value: `${sets.size} extensions possibles, de ${lo} à ${hi}`, sure: false }); }
    const ills = distinct((c) => c.illustrator);
    if (ills.size === 1) out.push({ key: 'illustrator', label: LABELS.illustrator, value: cands[0].illustrator || 'inconnu', sure: true });
    else out.push({ key: 'illustrator', label: LABELS.illustrator, value: `${ills.size} illustrateurs possibles`, sure: false });
    return out;
  }

  // ---- best next guess: the card whose answers split the candidates the most (entropy) ----
  function sample(list, max) {
    if (list.length <= max) return list;
    const step = list.length / max;
    const out = [];
    for (let i = 0; i < max; i++) out.push(list[Math.floor(i * step)]);
    return out;
  }
  function recommend(cands, opts) {
    if (!cands.length) return null;
    if (cands.length === 1) return { card: cands[0], entropy: 0, expected: 1, worst: 1, buckets: 1, isCandidate: true, evaluated: 1 };
    const maxGuesses = (opts && opts.maxGuesses) || 300;
    const maxTargets = (opts && opts.maxTargets) || 1500;
    const guesses = sample(cands, maxGuesses);
    const targets = sample(cands, maxTargets);
    const n = targets.length;
    const counts = new Map();
    let best = null;
    for (const g of guesses) {
      counts.clear();
      for (let i = 0; i < n; i++) {
        const k = feedbackKey(g, targets[i]);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      let entropy = 0;
      let worst = 0;
      let expected = 0;
      for (const c of counts.values()) {
        const p = c / n;
        entropy -= p * Math.log2(p);
        if (c > worst) worst = c;
        expected += c * c;
      }
      expected /= n;
      const score = entropy + 1e-6; // every guess here is a candidate: it can also win outright
      if (!best || score > best.score + 1e-9) best = { card: g, score, entropy, expected, worst, buckets: counts.size };
    }
    const scale = cands.length / n;
    return { card: best.card, entropy: best.entropy, expected: Math.round(best.expected * scale), worst: Math.round(best.worst * scale), buckets: best.buckets, isCandidate: true, evaluated: guesses.length };
  }

  // ---- the whole story ----
  function analyze({ guesses = [], pool = [], recommendOptions } = {}) {
    const steps = [];
    let cands = pool;
    const total = pool.length;
    steps.push({
      kind: 'info', rule: 'start', remaining: total, facts: [], constraints: constraints(cands),
      title: `${total.toLocaleString('fr-FR')} cartes possibles`,
      text: total ? 'La carte mystère est une rare ou mieux, dans une extension du jeu. Chaque essai répond sur sept attributs : on ne garde que les cartes qui auraient donné exactement ces réponses.' : 'Aucune carte dans la réserve : vérifie les réglages.',
    });
    let invalidAt = null;
    let won = false;
    guesses.forEach((g, i) => {
      const fb = g.fb;
      const before = cands.length;
      if (complete(fb)) cands = cands.filter((c) => matches(c, g.card, fb));
      const learnt = facts(g.card, fb);
      if (isWin(fb, g.card)) won = true;
      if (!cands.length && invalidAt == null) invalidAt = i;
      steps.push({
        kind: cands.length ? 'rule' : 'error', rule: 'guess', guess: i, remaining: cands.length, facts: learnt, constraints: constraints(cands),
        title: `Essai ${i + 1} : ${g.card.name} · ${g.card.set.name}`,
        text: `${learnt.length ? `On apprend : ${learnt.join(' ; ')}.` : 'Réponses incomplètes : cet essai ne filtre rien.'} ${cands.length ? `${before.toLocaleString('fr-FR')} → ${cands.length.toLocaleString('fr-FR')} carte${plural(cands.length, '', 's')} possible${plural(cands.length, '', 's')}.` : 'Plus aucune carte ne colle : une réponse a dû être mal recopiée.'}`,
      });
    });
    const cons = constraints(cands);
    let status;
    let recommendation = null;
    if (!total) status = 'nopool';
    else if (won) status = 'won';
    else if (!cands.length) status = 'invalid';
    else if (!guesses.length) status = 'empty';
    else if (cands.length === 1) status = 'solved';
    else status = 'playing';
    if (status === 'empty' || status === 'playing' || status === 'solved') recommendation = recommend(cands, recommendOptions);
    const last = { kind: 'result', rule: status, remaining: cands.length, facts: [], constraints: cons, guess: null };
    const winner = won ? guesses[guesses.length - 1].card : null;
    switch (status) {
      case 'nopool': Object.assign(last, { title: 'Aucune carte à chercher', text: 'La réserve est vide : active une série dans les réglages.' }); break;
      case 'won': Object.assign(last, { title: `Trouvée en ${guesses.length} essai${plural(guesses.length, '', 's')} !`, text: `${winner.name} · ${winner.set.name} · ${winner.rarity || 'sans rareté'} · ${winner.hp} PV. Bien joué !` }); break;
      case 'invalid': Object.assign(last, { title: 'Plus aucune carte possible', text: `Les réponses se contredisent (dès l'essai ${invalidAt + 1}). Touche un essai pour corriger ce que le jeu a affiché.` }); break;
      case 'empty': Object.assign(last, { title: `Commence par ${recommendation.card.name}`, text: `${recommendation.card.set.name} · ${recommendation.card.rarity} · ${recommendation.card.hp} PV. Cette carte coupe au mieux les ${total.toLocaleString('fr-FR')} cartes possibles : selon les sept réponses, il en restera en moyenne ${recommendation.expected.toLocaleString('fr-FR')}.` }); break;
      case 'solved': Object.assign(last, { title: `C'est ${cands[0].name} !`, text: `${cands[0].set.name} · ${cands[0].rarity} · ${cands[0].hp} PV${cands[0].illustrator ? ` · ${cands[0].illustrator}` : ''}. Une seule carte colle avec toutes les réponses : joue-la.` }); break;
      default: Object.assign(last, { title: `${cands.length.toLocaleString('fr-FR')} cartes possibles`, text: `Joue ${recommendation.card.name} (${recommendation.card.set.name}, ${recommendation.card.rarity}) : au pire il restera ${recommendation.worst.toLocaleString('fr-FR')} carte${plural(recommendation.worst, '', 's')}, en moyenne ${recommendation.expected.toLocaleString('fr-FR')}.` });
    }
    steps.push(last);
    return { status, count: cands.length, total, candidates: cands, recommendation, constraints: cons, steps, invalidAt, won };
  }

  return { ATTRS, LABELS, STATES, RANKS, HP_NEAR, POCKET, rankOf, rankLabel, decode, isCandidate, candidates, feedback, matches, isWin, complete, feedbackKey, facts, constraints, recommend, analyze };
});
