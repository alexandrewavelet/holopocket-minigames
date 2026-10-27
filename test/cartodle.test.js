const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../cartodle/solver.js');

// ---------- a tiny synthetic database in the data/cards.js format ----------
const FIXTURE = {
  fields: ['localId', 'name', 'dex', 'type', 'stage', 'hp', 'rarity', 'set', 'illustrator', 'suffix', 'image'],
  series: [{ id: 'swsh', name: 'Épée et Bouclier' }, { id: 'sv', name: 'Écarlate et Violet' }, { id: 'tcgp', name: 'Jeu de Cartes à Collectionner Pokémon Pocket' }],
  sets: [
    { id: 'swsh2', name: 'Clash des Rebelles', serie: 0, date: '2020-05-01' },
    { id: 'swsh4', name: 'Voltage Éclatant', serie: 0, date: '2020-11-13' },
    { id: 'sv1', name: 'Écarlate et Violet', serie: 1, date: '2023-03-31' },
    { id: 'A1', name: 'Puissance Génétique', serie: 2, date: '2024-10-30' },
  ],
  types: ['Électrique', 'Eau', 'Feu'],
  stages: ['Base', 'Niveau 1', 'Niveau 2'],
  rarities: ['Commune', 'Peu Commune', 'Holo Rare V', 'Ultra Rare', 'Rare', 'Deux Diamants', 'Sans Rareté'],
  illustrators: ['aky CG Works', 'nagimiso', 'Kouki Saitou'],
  cards: [
    ['67', 'Fulgudog V', 836, 0, 0, 200, 2, 0, 0, 'V', 1], // 0 the mystery card of the screenshot
    ['181', 'Fulgudog V', 836, 0, 0, 200, 3, 0, 0, 'V', 1], // 1 same card, Ultra Rare print
    ['68', 'Toxizap', 848, 0, 0, 70, 0, 0, 1, null, 1], // 2
    ['62', 'Wattapik', 871, 0, 0, 80, 1, 1, 2, null, 1], // 3
    ['50', 'Léviator', 130, 1, 2, 170, 4, 2, 1, null, 0], // 4 rare, Écarlate et Violet
    ['12', 'Pikachu', 25, 0, 0, 60, 5, 3, 2, null, 1], // 5 Pocket card
    ['3', 'Salamèche', 4, 2, 0, 70, 6, 0, null, null, 0], // 6 no rarity, no illustrator
  ],
};
const cards = S.decode(FIXTURE);
const byLocal = (set, localId) => cards.find((c) => c.set.id === set && c.localId === localId);
const FULGU = byLocal('swsh2', '67');
const FULGU_UR = byLocal('swsh2', '181');
const TOXIZAP = byLocal('swsh2', '68');
const WATTAPIK = byLocal('swsh4', '62');
const LEVIATOR = byLocal('sv1', '50');
const PIKA_POCKET = byLocal('A1', '12');
const SALAMECHE = byLocal('swsh2', '3');

// ---------- decode ----------
test('decode: resolves every index into names, builds ids and image urls', () => {
  assert.equal(cards.length, 7);
  assert.equal(FULGU.id, 'swsh2-67');
  assert.equal(FULGU.name, 'Fulgudog V');
  assert.equal(FULGU.dex, 836);
  assert.equal(FULGU.type, 'Électrique');
  assert.equal(FULGU.stage, 'Base');
  assert.equal(FULGU.hp, 200);
  assert.equal(FULGU.rarity, 'Holo Rare V');
  assert.equal(FULGU.set.name, 'Clash des Rebelles');
  assert.equal(FULGU.set.serie.name, 'Épée et Bouclier');
  assert.equal(FULGU.set.date, '2020-05-01');
  assert.equal(FULGU.illustrator, 'aky CG Works');
  assert.equal(FULGU.image, 'https://assets.tcgdex.net/fr/swsh/swsh2/67/low.webp');
  assert.equal(LEVIATOR.image, null);
  assert.equal(SALAMECHE.illustrator, null);
  assert.equal(SALAMECHE.rarity, 'Sans Rareté');
  assert.ok(SALAMECHE.rank < S.rankOf('Commune'));
});

// ---------- rarity ranking ----------
test('rank: the usual ladder is ordered from the least to the most rare', () => {
  const ladder = ['Commune', 'Peu Commune', 'Rare', 'Holo Rare', 'Holo Rare V', 'Ultra Rare', 'Illustration spéciale rare', 'Hyper rare'];
  for (let i = 1; i < ladder.length; i++) assert.ok(S.rankOf(ladder[i - 1]) < S.rankOf(ladder[i]), `${ladder[i - 1]} < ${ladder[i]}`);
  assert.equal(S.rankOf('Holo Rare'), S.rankOf('Rare Holo'), 'two spellings of the same level share a rank');
  assert.ok(S.rankOf('Deux Diamants') === S.rankOf('Peu Commune'));
  assert.ok(S.rankOf('Sans Rareté') < S.rankOf('Commune'), 'no rarity is below everything');
  assert.equal(S.rankOf('Rareté inventée'), S.rankOf('Rare'), 'unknown names default to Rare');
});

test('isCandidate: rare or better, Pocket excluded by default', () => {
  assert.ok(S.isCandidate(FULGU));
  assert.ok(S.isCandidate(LEVIATOR));
  assert.ok(!S.isCandidate(TOXIZAP), 'commune');
  assert.ok(!S.isCandidate(WATTAPIK), 'peu commune');
  assert.ok(!S.isCandidate(SALAMECHE), 'no rarity');
  assert.ok(!S.isCandidate(PIKA_POCKET), 'Pocket off by default');
  assert.ok(!S.isCandidate(PIKA_POCKET, { pocket: true }), 'a Deux Diamants card is still below Rare');
  assert.equal(S.candidates(cards).length, 3);
});

// ---------- feedback ----------
test('feedback: identical card is eq everywhere', () => {
  assert.deepEqual(S.feedback(FULGU, FULGU), { pokemon: 'eq', type: 'eq', stage: 'eq', hp: 'eq', rarity: 'eq', set: 'eq', illustrator: 'eq' });
});

test('feedback: the screenshot rows (mystery = Fulgudog V 67)', () => {
  assert.deepEqual(S.feedback(FULGU_UR, FULGU), { pokemon: 'eq', type: 'eq', stage: 'eq', hp: 'eq', rarity: 'down', set: 'eq', illustrator: 'eq' });
  assert.deepEqual(S.feedback(TOXIZAP, FULGU), { pokemon: 'down', type: 'eq', stage: 'eq', hp: 'up', rarity: 'up', set: 'eq', illustrator: 'no' });
  assert.deepEqual(S.feedback(WATTAPIK, FULGU), { pokemon: 'down', type: 'eq', stage: 'eq', hp: 'up', rarity: 'up', set: 'near', illustrator: 'no' });
});

test('feedback: pokédex number up, hp near within 20, set up/down across series', () => {
  const fb = S.feedback(LEVIATOR, FULGU); // guess Léviator (130, 170 PV, SV 2023) vs Fulgudog (836, 200 PV, SWSH 2020)
  assert.equal(fb.pokemon, 'up');
  assert.equal(fb.hp, 'up', '30 above is beyond 20');
  assert.equal(fb.set, 'down', 'the mystery set came out earlier, in another series');
  assert.equal(fb.type, 'no');
  assert.equal(fb.stage, 'no');
  const near = S.feedback({ ...LEVIATOR, hp: 185 }, FULGU);
  assert.equal(near.hp, 'near', '15 below is within 20');
  assert.equal(S.feedback(FULGU, LEVIATOR).set, 'up');
  assert.equal(S.feedback(FULGU, LEVIATOR).pokemon, 'down');
});

test('feedback: same rarity level with a different spelling is eq; a missing illustrator never matches', () => {
  const holo = { ...LEVIATOR, rarity: 'Holo Rare', rank: S.rankOf('Holo Rare') };
  const rareHolo = { ...LEVIATOR, rarity: 'Rare Holo', rank: S.rankOf('Rare Holo') };
  assert.equal(S.feedback(holo, rareHolo).rarity, 'eq');
  assert.equal(S.feedback(SALAMECHE, SALAMECHE).illustrator, 'no');
});

// ---------- matches ----------
test('matches: a candidate is kept only when it would produce the same feedback', () => {
  assert.ok(S.matches(FULGU, TOXIZAP, S.feedback(TOXIZAP, FULGU)));
  assert.ok(!S.matches(FULGU_UR, FULGU_UR, { ...S.feedback(FULGU_UR, FULGU), rarity: 'down' }));
  assert.ok(!S.matches(LEVIATOR, TOXIZAP, S.feedback(TOXIZAP, FULGU)));
});

test('matches: tolerant readings — hp ↑ keeps cards within 20 above, rarity ≈ reads as eq', () => {
  const guess = { ...TOXIZAP, hp: 190 };
  assert.ok(S.matches(FULGU, guess, { ...S.feedback(guess, FULGU), hp: 'up' }), '200 is above 190 even if the game might say ≈');
  assert.ok(!S.matches({ ...FULGU, hp: 190 }, guess, { ...S.feedback(guess, FULGU), hp: 'up' }), 'equal hp is not above');
  assert.ok(S.matches(FULGU, FULGU, { ...S.feedback(FULGU, FULGU), rarity: 'near' }));
});

// ---------- analyze ----------
const EXAMPLE = [
  { card: FULGU_UR, fb: { pokemon: 'eq', type: 'eq', stage: 'eq', hp: 'eq', rarity: 'down', set: 'eq', illustrator: 'eq' } },
  { card: TOXIZAP, fb: { pokemon: 'down', type: 'eq', stage: 'eq', hp: 'up', rarity: 'up', set: 'eq', illustrator: 'no' } },
  { card: WATTAPIK, fb: { pokemon: 'down', type: 'eq', stage: 'eq', hp: 'up', rarity: 'up', set: 'near', illustrator: 'no' } },
];

test('analyze: with no guess, every candidate is possible and a first card is recommended', () => {
  const a = S.analyze({ guesses: [], pool: S.candidates(cards) });
  assert.equal(a.status, 'empty');
  assert.equal(a.count, 3);
  assert.ok(a.recommendation && a.recommendation.card);
  assert.equal(a.steps.length, 2, 'start + result');
});

test('analyze: the screenshot rows leave Fulgudog V 67 and exclude its Ultra Rare print', () => {
  const a = S.analyze({ guesses: EXAMPLE, pool: S.candidates(cards) });
  assert.equal(a.status, 'solved');
  assert.deepEqual(a.candidates.map((c) => c.id), ['swsh2-67']);
  assert.equal(a.recommendation.card.id, 'swsh2-67');
  assert.equal(a.steps.length, 5, 'start + 3 guesses + result');
  assert.equal(a.steps[1].remaining, 1);
  assert.ok(a.steps[2].facts.some((f) => /848/.test(f)), 'facts mention the Pokédex bound');
  assert.equal(a.constraints.find((c) => c.key === 'pokemon').value, 'Fulgudog (n° 836)', 'the Pokémon, without the card suffix');
});

test('analyze: a guess identical to the mystery card wins', () => {
  const won = { card: FULGU, fb: S.feedback(FULGU, FULGU) };
  const a = S.analyze({ guesses: [won], pool: S.candidates(cards) });
  assert.equal(a.status, 'won');
  assert.equal(a.recommendation, null);
});

test('analyze: contradictory feedback gives status invalid and names the guilty row', () => {
  const bad = { card: TOXIZAP, fb: { pokemon: 'down', type: 'eq', stage: 'eq', hp: 'down', rarity: 'up', set: 'eq', illustrator: 'no' } };
  const a = S.analyze({ guesses: [EXAMPLE[0], bad], pool: S.candidates(cards) });
  assert.equal(a.status, 'invalid');
  assert.equal(a.count, 0);
  assert.equal(a.invalidAt, 1);
});

test('analyze: constraints summarise what the candidates share', () => {
  const a = S.analyze({ guesses: [], pool: S.candidates(cards) });
  const get = (k) => a.constraints.find((c) => c.key === k);
  assert.match(get('pokemon').value, /130 – 836/);
  assert.match(get('hp').value, /170 – 200/);
  assert.ok(get('type').value.includes('Électrique') && get('type').value.includes('Eau'));
});

test('analyze: the recommendation splits the candidates best (entropy) and prefers a candidate', () => {
  const pool = S.candidates(cards);
  const a = S.analyze({ guesses: [], pool });
  assert.ok(pool.some((c) => c.id === a.recommendation.card.id));
  assert.ok(a.recommendation.buckets >= 2);
});

// ---------- the real database, once ----------
test('smoke: the real database decodes and the screenshot rows keep Fulgudog V 67 among the candidates', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'data', 'cards.js'), 'utf8');
  const db = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const all = S.decode(db);
  assert.ok(all.length > 15000);
  const find = (set, localId) => all.find((c) => c.set.id === set && c.localId === localId);
  const guesses = [
    { card: find('swsh2', '181'), fb: EXAMPLE[0].fb },
    { card: find('swsh2', '68'), fb: EXAMPLE[1].fb },
    { card: find('swsh4', '62'), fb: EXAMPLE[2].fb },
  ];
  const t0 = Date.now();
  const first = S.analyze({ guesses: [], pool: S.candidates(all) });
  const t1 = Date.now();
  const a = S.analyze({ guesses, pool: S.candidates(all) });
  const t2 = Date.now();
  assert.ok(a.candidates.some((c) => c.id === 'swsh2-67'), 'Fulgudog V 67 is still possible');
  assert.ok(!a.candidates.some((c) => c.id === 'swsh2-181'), 'the Ultra Rare print is not');
  assert.ok(a.count < 20, `only a handful of cards left (${a.count})`);
  assert.ok(first.count > 5000, 'thousands of candidates at the start');
  assert.ok(t1 - t0 < 1500, `first recommendation in ${t1 - t0} ms`);
  assert.ok(t2 - t1 < 300, `analysis after 3 guesses in ${t2 - t1} ms`);
});

test('matches: a guess without stage or type answers "no" and never excludes cards that also lack it', () => {
  const noStage = { ...TOXIZAP, stage: null, type: null };
  const fb = S.feedback(noStage, noStage);
  assert.equal(fb.stage, 'no');
  assert.equal(fb.type, 'no');
  assert.ok(S.matches(noStage, noStage, fb), 'the card itself still matches its own answers');
  assert.ok(S.matches(FULGU, noStage, { ...S.feedback(noStage, FULGU), stage: 'eq', type: 'eq' }), 'answers on an unknown attribute are ignored, whatever the game showed');
  assert.ok(S.isWin({ ...fb, pokemon: 'eq', hp: 'eq', rarity: 'eq', set: 'eq', illustrator: 'eq' }, noStage), 'all ✓ except the unknowable attributes is a win');
  assert.ok(!S.isWin({ ...fb, pokemon: 'eq', hp: 'eq', rarity: 'eq', set: 'eq', illustrator: 'eq' }, TOXIZAP), 'with a known stage, ✗ is not a win');
});

test('simulation: playing the recommendation against random secrets always ends on the secret', () => {
  const pool = S.candidates(cards).concat([{ ...LEVIATOR, id: 'x-1', stage: null, type: null }]);
  for (const secret of pool) {
    const gs = [];
    let r = S.analyze({ guesses: gs, pool });
    for (let n = 0; n < 6 && r.status !== 'won'; n++) {
      assert.ok(r.recommendation, `still a recommendation for ${secret.id} after ${n} guesses (status ${r.status})`);
      const c = r.recommendation.card;
      gs.push({ card: c, fb: S.feedback(c, secret) });
      r = S.analyze({ guesses: gs, pool });
    }
    assert.equal(r.status, 'won', `found ${secret.id}`);
  }
});
