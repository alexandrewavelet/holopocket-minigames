#!/usr/bin/env node
/*
 * Builds data/pokedex.js from the PokéAPI CSV tables (French names, types,
 * generation, evolution family and place in it). Default forms + regional forms only.
 * When data/cards.js exists (scripts/build-cards.js), each Pokémon also gets the
 * TCG flags used by Connexions: a special card (ex, GX, V, VMAX, VSTAR, Méga) and a card with 300 HP or more.
 *
 *   node scripts/build-pokedex.js            # downloads the CSVs
 *   node scripts/build-pokedex.js --from DIR # uses CSVs already in DIR
 *
 * Entry: { n: name, f: form suffix|null, t: types, g: generation, l: lineage (base species name),
 *          id: species id, p?: pokemon id when it differs (regional form, for sprites),
 *          s: place in the family (0 does not evolve, 1 first, 2 middle, 3 last), k?: 1 special card, h?: 1 card ≥ 300 HP }
 */
const fs = require('fs');
const path = require('path');

const RAW = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const TABLES = ['pokemon_species', 'pokemon_species_names', 'pokemon', 'pokemon_types', 'type_names', 'pokemon_forms', 'pokemon_form_names', 'version_groups'];
const FR = '5';
const REGIONS = { alola: "d'Alola", galar: 'de Galar', hisui: 'de Hisui', paldea: 'de Paldea' };
// Shipped as a script (not JSON) so the pages also work from file:// where fetch() is blocked.
const OUT = path.join(__dirname, '..', 'data', 'pokedex.js');
const CARDS = path.join(__dirname, '..', 'data', 'cards.js');
const SPECIAL_SUFFIX = new Set(['EX', 'ex', 'GX', 'TAG TEAM-GX', 'V', 'VMAX', 'VSTAR']);
const SPECIAL_STAGE = new Set(['MÉGA', 'VMAX', 'VSTAR']);

// TCG flags per Pokédex number, read from the generated card database when present
function loadCardFlags() {
  if (!fs.existsSync(CARDS)) return null;
  const text = fs.readFileSync(CARDS, 'utf8');
  const db = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const F = Object.fromEntries(db.fields.map((f, i) => [f, i]));
  const flags = new Map();
  for (const c of db.cards) {
    const dex = c[F.dex];
    if (dex == null) continue;
    const f = flags.get(dex) || { k: 0, h: 0 };
    if (SPECIAL_SUFFIX.has(c[F.suffix]) || SPECIAL_STAGE.has(db.stages[c[F.stage]])) f.k = 1;
    if (c[F.hp] >= 300) f.h = 1;
    flags.set(dex, f);
  }
  return flags;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

async function loadTables() {
  const fromIdx = process.argv.indexOf('--from');
  const dir = fromIdx > -1 ? process.argv[fromIdx + 1] : null;
  const out = {};
  for (const t of TABLES) {
    let text;
    if (dir) text = fs.readFileSync(path.join(dir, `${t}.csv`), 'utf8');
    else {
      const res = await fetch(RAW + t + '.csv');
      if (!res.ok) throw new Error(`${t}: HTTP ${res.status}`);
      text = await res.text();
    }
    out[t] = parseCsv(text);
  }
  return out;
}

(async () => {
  const T = await loadTables();
  const typeName = new Map(T.type_names.filter((r) => r.local_language_id === FR).map((r) => [r.type_id, r.name]));
  const speciesName = new Map(T.pokemon_species_names.filter((r) => r.local_language_id === FR).map((r) => [r.pokemon_species_id, r.name]));
  const species = new Map(T.pokemon_species.map((r) => [r.id, r]));
  const vgGen = new Map(T.version_groups.map((r) => [r.id, Number(r.generation_id)]));
  const formName = new Map(T.pokemon_form_names.filter((r) => r.local_language_id === FR).map((r) => [r.pokemon_form_id, r.form_name]));
  const formsByPokemon = new Map();
  for (const f of T.pokemon_forms) if (!formsByPokemon.has(f.pokemon_id)) formsByPokemon.set(f.pokemon_id, f);
  const typesByPokemon = new Map();
  for (const r of T.pokemon_types) {
    if (!typesByPokemon.has(r.pokemon_id)) typesByPokemon.set(r.pokemon_id, []);
    typesByPokemon.get(r.pokemon_id)[Number(r.slot) - 1] = typeName.get(r.type_id);
  }
  // evolution family → base species (the one that evolves from nothing)
  const chainBase = new Map();
  for (const s of T.pokemon_species) if (!s.evolves_from_species_id) chainBase.set(s.evolution_chain_id, s.id);
  // place in the family: 0 = does not evolve, 1 = first of a family, 2 = middle, 3 = last
  const hasEvolution = new Set(T.pokemon_species.map((s) => s.evolves_from_species_id).filter(Boolean));
  const placeOf = (sp) => (!sp.evolves_from_species_id ? (hasEvolution.has(sp.id) ? 1 : 0) : hasEvolution.has(sp.id) ? 2 : 3);
  const cardFlags = loadCardFlags();

  const mons = [];
  for (const p of T.pokemon) {
    const sp = species.get(p.species_id);
    if (!sp || !speciesName.has(sp.id)) continue;
    const region = Object.keys(REGIONS).find((r) => p.identifier.includes(`-${r}`));
    if (p.is_default !== '1' && !region) continue;
    // cap Pikachu, totem sizes and battle-only modes are not distinct cards
    if (/-cap|totem/.test(p.identifier)) continue;
    const form = formsByPokemon.get(p.id);
    if (form && form.is_battle_only === '1') continue;
    let suffix = null;
    let gen = Number(sp.generation_id);
    if (region) {
      const fr = form && formName.get(form.id);
      // "Forme d'Alola" → "d'Alola"
      suffix = fr && fr.toLowerCase().startsWith('forme ') ? fr.slice(6) : REGIONS[region];
      const breed = { 'combat-breed': 'Combatif', 'blaze-breed': 'Ardent', 'aqua-breed': 'Aquatique' };
      for (const [k, v] of Object.entries(breed)) if (p.identifier.endsWith(k)) suffix += ` (${v})`;
      if (form && vgGen.has(form.introduced_in_version_group_id)) gen = vgGen.get(form.introduced_in_version_group_id);
    }
    if (suffix) suffix = suffix.replace(/\u2019/g, "'");
    const mon = {
      n: speciesName.get(sp.id),
      f: suffix,
      t: (typesByPokemon.get(p.id) || []).filter(Boolean),
      g: gen,
      l: speciesName.get(chainBase.get(sp.evolution_chain_id)) || speciesName.get(sp.id),
      id: Number(sp.id),
      s: placeOf(sp),
    };
    if (Number(p.id) !== Number(sp.id)) mon.p = Number(p.id);
    const flags = cardFlags && cardFlags.get(Number(sp.id));
    if (flags && flags.k) mon.k = 1;
    if (flags && flags.h) mon.h = 1;
    mons.push(mon);
  }
  mons.sort((a, b) => a.id - b.id || (a.f ? 1 : 0) - (b.f ? 1 : 0));
  const types = [...new Set([...typeName.values()])].filter((t) => !['Inconnu', 'Obscur', 'Stellaire', '???'].includes(t));
  const json = { generated: new Date().toISOString().slice(0, 10), source: 'PokéAPI', types, mons };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `// Generated by scripts/build-pokedex.js from PokéAPI — do not edit by hand.\nwindow.POKEDEX = ${JSON.stringify(json)};\n`);
  console.log(`${mons.length} Pokémon, ${types.length} types${cardFlags ? `, TCG flags for ${mons.filter((m) => m.k || m.h).length}` : ' (no data/cards.js: TCG flags skipped)'} → ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
