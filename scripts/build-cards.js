#!/usr/bin/env node
/*
 * Builds data/cards.js from TCGdex (https://tcgdex.dev): every Pokémon card
 * published in French, with the attributes Cartodle compares — Pokédex number,
 * type, stage, HP, rarity, set (and its series / release date), illustrator.
 *
 *   node scripts/build-cards.js            # downloads (responses cached in .cache/tcgdex)
 *   node scripts/build-cards.js --fresh    # ignores the cache
 *
 * The bulk structured data comes from the GraphQL endpoint (English only, ~20
 * requests). French names come from the French REST list, and each English
 * value of type / stage / rarity is translated by reading one French card that
 * carries it (a few dozen small requests).
 */
const fs = require('fs');
const path = require('path');

const GQL = 'https://api.tcgdex.net/v2/graphql';
const REST = 'https://api.tcgdex.net/v2';
const CACHE = path.join(__dirname, '..', '.cache', 'tcgdex');
const OUT = path.join(__dirname, '..', 'data', 'cards.js');
const fresh = process.argv.includes('--fresh');

async function cached(key, fetcher) {
  const file = path.join(CACHE, key.replace(/[^a-z0-9._-]+/gi, '_') + '.json');
  if (!fresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const value = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return value;
}
async function getJSON(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }
}
async function gql(query) {
  const res = await fetch(GQL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors && !body.data) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

(async () => {
  // 1. structured data (English) for every Pokémon card, 1000 per page
  const cards = [];
  for (let page = 1; ; page++) {
    const data = await cached(`cards-en-${page}`, () =>
      gql(`{ cards(filters:{category:"Pokemon"}, pagination:{page:${page},itemsPerPage:1000}) { id name hp types stage rarity illustrator dexId suffix set { id } } }`),
    );
    const batch = (data.cards || []).filter(Boolean);
    cards.push(...batch);
    process.stdout.write(`\rcards (en): ${cards.length}`);
    if (batch.length < 1000) break;
  }
  console.log();
  const sets = (await cached('sets-en', () => gql('{ sets { id name releaseDate serie { id name } } }'))).sets;

  // 2. French names, French availability, French set / series names
  const frCards = await cached('cards-fr', () => getJSON(`${REST}/fr/cards?category=Pok%C3%A9mon`));
  const frSets = await cached('sets-fr', () => getJSON(`${REST}/fr/sets`));
  const frSeries = await cached('series-fr', () => getJSON(`${REST}/fr/series`));
  const frName = new Map(frCards.map((c) => [c.id, c]));
  const frSetName = new Map(frSets.map((s) => [s.id, s.name]));
  const frSerieName = new Map(frSeries.map((s) => [s.id, s.name]));

  // 3. translate type / stage / rarity values by looking at one French card per English value
  const samples = { types: new Map(), stage: new Map(), rarity: new Map() };
  for (const c of cards) {
    if (!frName.has(c.id)) continue;
    for (const t of c.types || []) if (!samples.types.has(t)) samples.types.set(t, c.id);
    if (c.stage && !samples.stage.has(c.stage)) samples.stage.set(c.stage, c.id);
    if (c.rarity && !samples.rarity.has(c.rarity)) samples.rarity.set(c.rarity, c.id);
  }
  const ids = new Set([...samples.types.values(), ...samples.stage.values(), ...samples.rarity.values()]);
  const frDetail = new Map();
  for (const id of ids) frDetail.set(id, await cached(`card-fr-${id}`, () => getJSON(`${REST}/fr/cards/${encodeURIComponent(id)}`)));
  const tr = { types: new Map(), stage: new Map(), rarity: new Map() };
  for (const [en, id] of samples.types) {
    const fr = frDetail.get(id);
    const i = (cards.find((c) => c.id === id).types || []).indexOf(en);
    tr.types.set(en, (fr.types || [])[i] || en);
  }
  for (const [en, id] of samples.stage) tr.stage.set(en, frDetail.get(id).stage || en);
  for (const [en, id] of samples.rarity) tr.rarity.set(en, frDetail.get(id).rarity || en);

  // 4. tables + compact rows
  const table = () => {
    const list = [];
    const index = new Map();
    return { list, idx: (v) => { if (v == null || v === '') return null; if (!index.has(v)) { index.set(v, list.length); list.push(v); } return index.get(v); } };
  };
  const T = { series: table(), sets: table(), types: table(), stages: table(), rarities: table(), illustrators: table() };
  const setRows = [];
  const setIndex = new Map();
  const setInfo = new Map(sets.map((s) => [s.id, s]));
  const setIdx = (id) => {
    if (setIndex.has(id)) return setIndex.get(id);
    const s = setInfo.get(id) || { id };
    const serie = s.serie ? T.series.idx(s.serie.id) : null;
    if (serie != null && !T.series.list[serie].name) T.series.list[serie] = { id: s.serie.id, name: frSerieName.get(s.serie.id) || s.serie.name };
    setIndex.set(id, setRows.length);
    setRows.push({ id, name: frSetName.get(id) || s.name || id, serie, date: s.releaseDate || null });
    return setIndex.get(id);
  };
  const rows = [];
  let skipped = 0;
  for (const c of cards.sort((a, b) => (setInfo.get(a.set.id)?.releaseDate || '').localeCompare(setInfo.get(b.set.id)?.releaseDate || '') || a.id.localeCompare(b.id, undefined, { numeric: true }))) {
    const fr = frName.get(c.id);
    if (!fr) { skipped++; continue; }
    const localId = c.id.slice(c.set.id.length + 1);
    rows.push([
      localId,
      fr.name,
      Array.isArray(c.dexId) && c.dexId.length ? c.dexId[0] : null,
      T.types.idx((c.types || []).map((t) => tr.types.get(t) || t)[0]),
      T.stages.idx(c.stage ? tr.stage.get(c.stage) || c.stage : null),
      Number.isFinite(c.hp) ? c.hp : null,
      T.rarities.idx(c.rarity ? tr.rarity.get(c.rarity) || c.rarity : null),
      setIdx(c.set.id),
      T.illustrators.idx(c.illustrator ? c.illustrator.trim() : null),
      c.suffix || null,
      fr.image ? 1 : 0,
    ]);
  }
  // series table: {id, name} objects (filled above)
  const series = T.series.list.map((s) => (typeof s === 'string' ? { id: s, name: frSerieName.get(s) || s } : s));
  const json = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'TCGdex',
    fields: ['localId', 'name', 'dex', 'type', 'stage', 'hp', 'rarity', 'set', 'illustrator', 'suffix', 'image'],
    series,
    sets: setRows,
    types: T.types.list,
    stages: T.stages.list,
    rarities: T.rarities.list,
    illustrators: T.illustrators.list,
    cards: rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `// Generated by scripts/build-cards.js from TCGdex — do not edit by hand.\nwindow.CARDS = ${JSON.stringify(json)};\n`);
  console.log(`${rows.length} French Pokémon cards (${skipped} without French print skipped), ${setRows.length} sets, ${json.rarities.length} rarities, ${json.illustrators.length} illustrators → ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
  console.log('rarities:', json.rarities.join(' | '));
  console.log('stages:', json.stages.join(' | '));
  console.log('types:', json.types.join(' | '));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
