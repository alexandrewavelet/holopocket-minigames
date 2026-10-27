const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../connexions/solver.js');

// mon(name, types, gen, lineage, place, extra) — place: 0 solo, 1 first, 2 middle, 3 last
const mon = (name, types, gen, lineage, place, extra) => ({ name, form: null, types, gen, lineage, place, special: false, hp300: false, ...extra });
const members = (g) => g.members.slice().sort((a, b) => a - b).join(',');
const partition = (solution) => solution.groups.map(members).sort().join(' | ');

function loadPokedex() {
  const text = fs.readFileSync(path.join(__dirname, '..', 'data', 'pokedex.js'), 'utf8');
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// ---------- names ----------
test('letters counts letters only: hyphens, spaces, dots and apostrophes are ignored', () => {
  assert.equal(S.letters('Mr. Mime'), 6);
  assert.equal(S.letters('Fort-Ivoire'), 10);
  assert.equal(S.letters('Évoli'), 5);
  assert.equal(S.letters("Porygon-Z"), 8);
});

test('firstLetter folds accents and upper-cases', () => {
  assert.equal(S.firstLetter('Évoli'), 'E');
  assert.equal(S.firstLetter('carchacrok'), 'C');
  assert.equal(S.firstLetter(''), '');
});

// ---------- attributes ----------
test('attributes lists every category a Pokémon can be grouped by', () => {
  const a = S.attributes(mon('Évoli', ['Normal'], 1, 'Évoli', 1, { special: true, hp300: true }));
  const keys = a.map((x) => `${x.category}:${x.value}`);
  assert.deepEqual(keys, ['type:Normal', 'gen:1', 'place:first', 'family:evoli', 'letter:E', 'length:short', 'special:special', 'hp300:hp300']);
  assert.equal(a.find((x) => x.category === 'family').label, "Famille d'Évoli");
  assert.equal(a.find((x) => x.category === 'place').label, 'Premiers de leur famille');
  assert.equal(a.find((x) => x.category === 'length').label, 'Nom court (5 lettres ou moins)');
});

test('attributes: dual types give two type attributes, mid-length names give no length attribute', () => {
  const a = S.attributes(mon('Altaria', ['Dragon', 'Vol'], 3, 'Tylton', 3));
  assert.deepEqual(a.filter((x) => x.category === 'type').map((x) => x.value), ['Dragon', 'Vol']);
  assert.equal(a.some((x) => x.category === 'length'), false);
  assert.equal(a.find((x) => x.category === 'place').label, 'Dernières évolutions');
  assert.equal(a.find((x) => x.category === 'family').label, 'Famille de Tylton');
});

test('attributes: a Pokémon that does not evolve and a long name', () => {
  const a = S.attributes(mon('Fort-Ivoire', ['Sol', 'Combat'], 9, 'Fort-Ivoire', 0));
  assert.equal(a.find((x) => x.category === 'place').label, "N'évoluent pas");
  assert.equal(a.find((x) => x.category === 'length').label, 'Nom long (10 lettres ou plus)');
});

// ---------- groups ----------
test('groups: every 4-subset sharing an attribute, with merged reasons', () => {
  const mons = [
    mon('Aaaaaaa', ['Feu'], 1, 'a', 0), mon('Bbbbbbb', ['Feu'], 1, 'b', 0), mon('Ccccccc', ['Feu'], 1, 'c', 0), mon('Ddddddd', ['Feu'], 1, 'd', 0),
    mon('Eeeeeee', ['Eau'], 2, 'e', 1),
  ];
  const g = S.groups(mons);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].members, [0, 1, 2, 3]);
  const cats = g[0].reasons.map((r) => `${r.category}:${r.value}`).sort();
  assert.deepEqual(cats, ['gen:1', 'place:solo', 'type:Feu']);
  assert.equal(g[0].rare, false);
});

test('groups: a group explained only by rare categories is rare', () => {
  const mons = [
    mon('Aaaaaaa', ['Feu'], 1, 'a', 1, { special: true }), mon('Bbbbbbb', ['Eau'], 2, 'b', 2, { special: true }),
    mon('Ccccccc', ['Plante'], 3, 'c', 3, { special: true }), mon('Ddddddd', ['Psy'], 4, 'd', 0, { special: true }),
  ];
  const g = S.groups(mons);
  assert.equal(g.length, 1);
  assert.equal(g[0].rare, true);
  assert.deepEqual(g[0].reasons.map((r) => r.category), ['special']);
});

// ---------- analyze ----------
function synthetic() {
  // four clean groups: type Feu, generation 5, family of Zed, first letter K — no other value is shared by four
  return [
    mon('Aaaaaaa', ['Feu'], 1, 'a1', 0), mon('Bbbbbbb', ['Feu'], 2, 'b1', 1), mon('Ccccccc', ['Feu'], 3, 'c1', 2), mon('Ddddddd', ['Feu'], 4, 'd1', 3),
    mon('Eeeeeee', ['Eau'], 5, 'e1', 0), mon('Fffffff', ['Plante'], 5, 'f1', 1), mon('Ggggggg', ['Psy'], 5, 'g1', 2), mon('Hhhhhhh', ['Sol'], 5, 'h1', 3),
    mon('Iiiiiii', ['Vol'], 6, 'Zed', null), mon('Jjjjjjj', ['Roche'], 7, 'Zed', null), mon('Zedzedz', ['Glace'], 8, 'Zed', null), mon('Lllllll', ['Acier'], 9, 'Zed', null),
    mon('Kmmmmmm', ['Dragon'], 1, 'm1', null), mon('Knnnnnn', ['Fée'], 2, 'n1', null), mon('Kooooooo', ['Spectre'], 3, 'o1', null), mon('Kpppppp', ['Combat'], 4, 'p1', null),
  ];
}

test('analyze: incomplete while fewer than 16 Pokémon are filled', () => {
  const mons = synthetic();
  mons[5] = { name: '', form: null, types: [], gen: null, lineage: '', place: null, special: false, hp300: false };
  const a = S.analyze(mons);
  assert.equal(a.status, 'incomplete');
  assert.deepEqual(a.missing, [5]);
});

test('analyze: finds the unique partition and labels each group', () => {
  const a = S.analyze(synthetic());
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 1);
  assert.equal(partition(a.solutions[0]), '0,1,2,3 | 12,13,14,15 | 4,5,6,7 | 8,9,10,11');
  const labels = a.solutions[0].groups.map((g) => g.reasons[0].label);
  assert.ok(labels.includes('Type Feu'));
  assert.ok(labels.includes('Génération 5'));
  assert.ok(labels.includes('Famille de Zed'));
  assert.ok(labels.includes('Commence par K'));
  assert.equal(a.solutions[0].groups.every((g) => !g.rare), true);
  assert.equal(a.sure.length, 4);
});

test('analyze: at most one rare group per solution', () => {
  const mons = synthetic();
  // the Feu group now only shares a special card, the generation-5 group only a 300 HP card: two rare groups → no solution
  for (const i of [0, 1, 2, 3]) mons[i] = mon(mons[i].name, [['Ténèbres', 'Insecte', 'Poison', 'Normal'][i]], 1 + i, mons[i].lineage, null, { special: true });
  for (const i of [4, 5, 6, 7]) mons[i] = mon(mons[i].name, mons[i].types, 5 + i, mons[i].lineage, null, { hp300: true });
  const a = S.analyze(mons);
  assert.equal(a.status, 'impossible');
});

test('analyze: a leftover quartet with nothing in common is accepted as the "Dans ta collection" group, ranked last', () => {
  const mons = synthetic();
  // break the first-letter group: 12-15 now share nothing
  mons[13].name = 'Qnnnnnn';
  mons[14].name = 'Roooooo';
  mons[15].name = 'Spppppp';
  const a = S.analyze(mons);
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 1);
  const g = a.solutions[0].groups.find((x) => members(x) === '12,13,14,15');
  assert.ok(g);
  assert.equal(g.rare, true);
  assert.equal(g.reasons[0].category, 'collection');
  assert.equal(a.solutions[0].guessed, true);
});

test('analyze: the same value never labels two groups of a grid', () => {
  const mons = synthetic();
  // 8-15 all start with K: of the 35 ways to split them into two quartets, only one gives the two groups different labels
  for (const i of [8, 9, 10, 11]) mons[i].name = 'K' + mons[i].name;
  const a = S.analyze(mons);
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 1);
  assert.equal(partition(a.solutions[0]), '0,1,2,3 | 12,13,14,15 | 4,5,6,7 | 8,9,10,11');
  const labels = Object.fromEntries(a.solutions[0].groups.map((g) => [members(g), g.reasons[0].label]));
  assert.equal(labels['8,9,10,11'], 'Famille de Zed');
  assert.equal(labels['12,13,14,15'], 'Commence par K');
});

test('analyze: "collection" guesses are only offered when no fully explained solution exists', () => {
  const mons = synthetic();
  // 8, 9, 10 now start with K too: a K quartet could leave 11 + three K's with nothing usable in common (a guess),
  // but the fully explained family-of-Zed / first-letter-K partition exists, so it is the only answer
  for (const i of [8, 9, 10]) mons[i].name = 'K' + mons[i].name;
  const a = S.analyze(mons);
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 1);
  assert.equal(a.solutions[0].guessed, false);
  assert.equal(partition(a.solutions[0]), '0,1,2,3 | 12,13,14,15 | 4,5,6,7 | 8,9,10,11');
});

test('analyze: a group is labelled with a value no other group uses, even if a more specific one is shared', () => {
  const mons = synthetic();
  // 0-3: generation 1 and first letter Y (types all different); 4-7: generation 1 only; 12-15 become the Dragon group
  for (const i of [0, 1, 2, 3]) mons[i] = mon('Y' + mons[i].name, [['Feu', 'Eau', 'Plante', 'Psy'][i]], 1, mons[i].lineage, i);
  for (const i of [4, 5, 6, 7]) mons[i].gen = 1;
  for (const i of [12, 13, 14, 15]) mons[i].types = ['Dragon'];
  const a = S.analyze(mons);
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 1);
  const g = a.solutions[0].groups.find((x) => members(x) === '0,1,2,3');
  assert.equal(g.reasons[0].label, 'Commence par Y');
  assert.equal(g.reasons[1].label, 'Génération 1');
  assert.equal(a.solutions[0].groups.find((x) => members(x) === '4,5,6,7').reasons[0].label, 'Génération 1');
});

test('analyze: a group becomes "plus rare" when only a rare value is left for it', () => {
  const mons = synthetic();
  // 0-3: type Feu and a special card; 4-7: type Feu too, nothing else → the first group must be the card group
  for (const i of [0, 1, 2, 3]) mons[i].special = true;
  for (const i of [4, 5, 6, 7]) mons[i] = mon(mons[i].name, ['Feu'], 5 + i, mons[i].lineage, null);
  let a = S.analyze(mons);
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 1);
  const byMembers = Object.fromEntries(a.solutions[0].groups.map((g) => [members(g), g]));
  assert.equal(byMembers['0,1,2,3'].reasons[0].category, 'special');
  assert.equal(byMembers['0,1,2,3'].rare, true);
  assert.equal(byMembers['4,5,6,7'].reasons[0].label, 'Type Feu');
  assert.equal(byMembers['4,5,6,7'].rare, false);
  // that rare group plus a "collection" guess would make two rare groups: not allowed
  mons[13].name = 'Qnnnnnn';
  mons[14].name = 'Roooooo';
  mons[15].name = 'Spppppp';
  a = S.analyze(mons);
  assert.equal(a.status, 'impossible');
});

test('analyze: two values of one category may coexist (generation 5 and generation 7)', () => {
  const mons = synthetic();
  for (const i of [12, 13, 14, 15]) mons[i] = mon(['Qmmmmmm', 'Rnnnnnn', 'Soooooo', 'Tpppppp'][i - 12], mons[i].types, 7, mons[i].lineage, null);
  const a = S.analyze(mons);
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 1);
  assert.equal(a.solutions[0].guessed, false);
  const labels = a.solutions[0].groups.map((g) => g.reasons[0].label).sort();
  assert.deepEqual(labels, ['Famille de Zed', 'Génération 5', 'Génération 7', 'Type Feu']);
});

test('analyze: a quartet whose only shared value is already used by another group can be the "collection" group', () => {
  const mons = synthetic();
  // 12-15 now share type Feu like 0-3, and nothing else: two "type" groups are impossible, one Feu quartet must be the collection
  for (const i of [12, 13, 14, 15]) mons[i] = mon(['Qmmmmmm', 'Rnnnnnn', 'Soooooo', 'Tpppppp'][i - 12], ['Feu'], 5 + i, mons[i].lineage, null);
  const a = S.analyze(mons);
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 35); // any four of the eight Feu could be the collection, the other four the Feu group
  assert.equal(a.solutions.every((s) => s.guessed), true);
  for (const s of a.solutions) assert.equal(new Set(s.groups.map((g) => g.reasons[0].label)).size, 4);
  assert.equal(partition(a.solutions[0]), '0,1,2,3 | 12,13,14,15 | 4,5,6,7 | 8,9,10,11');
  const cats = a.solutions[0].groups.map((g) => g.reasons[0].category).sort();
  assert.deepEqual(cats, ['collection', 'family', 'gen', 'type']);
  const guess = a.solutions[0].groups.find((g) => g.reasons[0].category === 'collection');
  assert.equal(guess.reasons[1].label, 'Type Feu'); // what they do share is still listed
});

test('analyze: sure groups are the ones shared by every solution', () => {
  const mons = synthetic();
  // a second way to split 8-15: 8, 9, 12, 13 get long names while 10, 11, 14, 15 do not evolve
  for (const i of [8, 9, 12, 13]) mons[i].name += 'xyzxyz';
  for (const i of [10, 11, 14, 15]) mons[i].place = 0;
  const a = S.analyze(mons);
  assert.equal(a.status, 'solved');
  assert.equal(a.count, 2);
  assert.equal(a.solutions.some((s) => s.guessed), false);
  // Feu and generation-5 groups are in every solution
  assert.deepEqual(a.sure.map(members).sort(), ['0,1,2,3', '4,5,6,7']);
});

test('analyze: one Pokémon fitting no group still allows a "collection" guess around it', () => {
  const mons = synthetic();
  mons[0] = mon('Xyzzyx', ['Ténèbres'], 9, 'x1', null);
  const a = S.analyze(mons);
  assert.equal(a.status, 'solved');
  assert.equal(a.solutions[0].guessed, true);
  // its three former Feu partners lost their only shared value too
  assert.deepEqual(a.isolated, [0, 1, 2, 3]);
});

test('analyze: impossible when two groups are broken, and says which Pokémon fit nowhere', () => {
  const mons = synthetic();
  mons[0] = mon('Xyzzyx', ['Ténèbres'], 9, 'x1', null);
  mons[4] = mon('Wyzzyw', ['Insecte'], 8, 'w1', null);
  const a = S.analyze(mons);
  assert.equal(a.status, 'impossible');
  assert.ok(a.isolated.includes(0) && a.isolated.includes(4));
});

test('analyze: enumeration is capped when everything shares an attribute', () => {
  const mons = Array.from({ length: 16 }, (_, i) => mon('N' + i, ['Feu'], 1, 'l' + i, 0));
  const a = S.analyze(mons, { limit: 50 });
  assert.equal(a.status, 'solved');
  assert.equal(a.solutions.length, 50);
  assert.equal(a.truncated, true);
});

// ---------- the screenshot grid, against the real Pokédex ----------
test('screenshot grid: every name resolves and the family / dragon / gen 9 / gen 6 partition is the first solution', () => {
  const dex = loadPokedex();
  const names = ['Papinox', 'Strassie', 'Fort-Ivoire', 'Carchacrok', 'Oyacata', 'Iguolta', 'Léboulérou', 'Chenipotte', 'Armulys', 'Sepiatroce', 'Taupikeau', 'Tranchodon', 'Blindalys', 'Latios', 'Grelaçon', 'Altaria'];
  const mons = names.map((n) => {
    const m = dex.mons.find((x) => norm(x.n) === norm(n) && !x.f);
    assert.ok(m, `${n} not found in the Pokédex`);
    return S.fromPokedex(m);
  });
  const a = S.analyze(mons);
  assert.equal(a.status, 'solved');
  const first = a.solutions[0];
  assert.equal(partition(first), '0,7,8,12 | 1,5,9,14 | 2,4,6,10 | 3,11,13,15');
  const byMembers = Object.fromEntries(first.groups.map((g) => [members(g), g.reasons[0]]));
  assert.equal(byMembers['0,7,8,12'].label, 'Famille de Chenipotte');
  assert.equal(byMembers['3,11,13,15'].label, 'Type Dragon');
  // two generation groups are fine: different values of one category
  assert.equal(first.guessed, false);
  assert.equal(byMembers['1,5,9,14'].label, 'Génération 6');
  assert.equal(byMembers['2,4,6,10'].label, 'Génération 9');
  assert.equal(a.count, 3);
  // never two groups with the same label, in any solution
  for (const s of a.solutions) assert.equal(new Set(s.groups.map((g) => g.reasons[0].label)).size, 4);
});

test('fromPokedex maps a Pokédex entry to a solver entry', () => {
  const m = S.fromPokedex({ n: 'Qwilfish', f: 'de Hisui', t: ['Ténèbres', 'Poison'], g: 8, l: 'Qwilfish', id: 211, s: 1, p: 10234, k: 1 });
  assert.deepEqual(m, { name: 'Qwilfish', form: 'de Hisui', types: ['Ténèbres', 'Poison'], gen: 8, lineage: 'Qwilfish', place: 1, special: true, hp300: false, id: 211, sprite: 10234 });
});
