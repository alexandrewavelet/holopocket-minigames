/* Connexions Solver — Vue app (logic in solver.js, shared UI in ../shared/js/ui.js, data in ../data/pokedex.js). */
(function () {
  'use strict';
  const { createApp, reactive, ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
  const S = ConnexionsSolver;
  const UI = HoloUI;
  const DEX = window.POKEDEX || { types: [], mons: [] };

  const STORAGE_KEY = 'connexions-solver:v1';
  const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  const TYPES = DEX.types.length ? DEX.types : ['Normal', 'Combat', 'Vol', 'Poison', 'Sol', 'Roche', 'Insecte', 'Spectre', 'Acier', 'Feu', 'Eau', 'Plante', 'Électrik', 'Psy', 'Glace', 'Dragon', 'Ténèbres', 'Fée'];
  const TYPE_COLORS = {
    Normal: ['#A8A77A', '#1a1a1a'], Feu: ['#EE8130', '#1a1a1a'], Eau: ['#6390F0', '#fff'], Plante: ['#7AC74C', '#1a1a1a'],
    Électrik: ['#F7D02C', '#1a1a1a'], Glace: ['#96D9D6', '#1a1a1a'], Combat: ['#C22E28', '#fff'], Poison: ['#A33EA1', '#fff'],
    Sol: ['#E2BF65', '#1a1a1a'], Vol: ['#A98FF3', '#1a1a1a'], Psy: ['#F95587', '#fff'], Insecte: ['#A6B91A', '#1a1a1a'],
    Roche: ['#B6A136', '#1a1a1a'], Spectre: ['#735797', '#fff'], Dragon: ['#6F35FC', '#fff'], Ténèbres: ['#705746', '#fff'],
    Acier: ['#B7B7CE', '#1a1a1a'], Fée: ['#D685AD', '#1a1a1a'],
  };
  // the grid of the HoloPocket screenshot
  const EXAMPLE = ['Papinox', 'Strassie', 'Fort-Ivoire', 'Carchacrok', 'Oyacata', 'Iguolta', 'Léboulérou', 'Chenipotte', 'Armulys', 'Sepiatroce', 'Taupikeau', 'Tranchodon', 'Blindalys', 'Latios', 'Grelaçon', 'Altaria'];
  const emptyEntry = () => ({ name: '', form: null, types: [], gen: null, lineage: '', place: null, special: false, hp300: false, id: null, sprite: null });
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const findMon = (name, form) => DEX.mons.find((m) => norm(m.n) === norm(name) && (m.f || null) === (form || null)) || DEX.mons.find((m) => norm(m.n) === norm(name));

  function validateSaved(s) {
    if (!s || !Array.isArray(s.mons) || s.mons.length !== 16) return null;
    const mons = s.mons.map((c) => {
      if (!c || typeof c !== 'object') return emptyEntry();
      return {
        name: typeof c.name === 'string' ? c.name : '',
        form: typeof c.form === 'string' ? c.form : null,
        types: Array.isArray(c.types) ? c.types.filter((t) => TYPES.includes(t)).slice(0, 2) : [],
        gen: Number.isInteger(c.gen) && c.gen >= 1 && c.gen <= 9 ? c.gen : null,
        lineage: typeof c.lineage === 'string' ? c.lineage : '',
        place: Number.isInteger(c.place) && c.place >= 0 && c.place <= 3 ? c.place : null,
        special: c.special === true,
        hp300: c.hp300 === true,
        id: Number.isInteger(c.id) ? c.id : null,
        sprite: Number.isInteger(c.sprite) ? c.sprite : null,
      };
    });
    return { mons };
  }

  const GROUP_COLORS = ['#ffd60a', '#5be38a', '#4cc9f0', '#c77dff'];

  const app = createApp({
    setup() {
      const saved = UI.loadJSON(STORAGE_KEY, validateSaved);
      const state = reactive({ mons: saved ? saved.mons : Array.from({ length: 16 }, emptyEntry) });
      const editing = ref(null);
      const manualOpen = ref(false);
      const solutionIndex = ref(0);
      const undo = ref(null);
      const nameInput = ref(null);
      const broken = reactive(new Set());
      let undoTimer = null;
      const sparks = UI.sparks(8);

      // ---------------- analysis ----------------
      const filledCount = computed(() => state.mons.filter(S.isComplete).length);
      const analysis = computed(() => S.analyze(state.mons, { limit: 200 }));
      const status = computed(() => analysis.value.status);
      const solution = computed(() => (status.value === 'solved' ? analysis.value.solutions[solutionIndex.value % analysis.value.count] : null));
      const current = computed(() => (editing.value == null ? emptyEntry() : state.mons[editing.value]));
      const entryLabel = (i) => S.entryName(state.mons[i], i);
      const countText = computed(() => {
        const a = analysis.value;
        if (a.count === 1) return 'Une seule façon de grouper';
        return `${a.truncated ? a.count + '+' : a.count} façons de grouper · solution ${(solutionIndex.value % a.count) + 1}`;
      });

      // rows of the grid: label + 4 tiles per group once solved, the 16 tiles in entry order otherwise
      const rows = computed(() => {
        const a = analysis.value;
        const tile = (i, group) => {
          const e = state.mons[i];
          return { kind: 'tile', key: 't' + i, i, entry: e, filled: S.isComplete(e), label: entryLabel(i), sprite: e.sprite, group, isolated: a.status === 'impossible' && a.isolated.includes(i), missing: a.status === 'incomplete' && filledCount.value > 0 && !S.isComplete(e) };
        };
        if (!solution.value) return state.mons.map((_, i) => tile(i, null));
        const out = [];
        solution.value.groups.forEach((g, gi) => {
          const more = g.reasons.slice(1).map((r) => r.label);
          out.push({ kind: 'label', key: 'g' + g.key, group: gi, label: g.reasons[0].label, sure: g.sure, rare: g.rare, more: more.join(' · '), moreCount: more.length });
          for (const i of g.members) out.push(tile(i, gi));
        });
        return out;
      });

      const advice = computed(() => {
        const a = analysis.value;
        switch (a.status) {
          case 'incomplete':
            return filledCount.value === 0
              ? { title: 'Recopie tes 16 Pokémon', text: 'Touche une case, tape le nom et choisis la suggestion : le Pokédex remplit types, génération, famille et cartes connues. Dès que les 16 sont là, je range la grille.', tone: 'info', key: 'empty' }
              : { title: `Encore ${16 - filledCount.value} Pokémon`, text: 'Il me faut les 16 noms pour trouver les quatre groupes. Les cases en pointillé orange sont celles qui manquent.', tone: 'info', key: 'partial-' + filledCount.value };
          case 'impossible': {
            const lone = a.isolated.map((i) => entryLabel(i));
            const text = lone.length
              ? `${lone.join(', ')} ne partage${lone.length > 1 ? 'nt' : ''} aucun point commun avec trois autres Pokémon de la grille. Vérifie ${lone.length > 1 ? 'leurs noms' : 'son nom'} (forme régionale ?) ou ajuste à la main.`
              : 'Des groupes existent, mais aucune façon de couvrir les 16 Pokémon avec quatre groupes aux points communs différents (au plus un « plus rare »). Vérifie les noms et les formes régionales.';
            return { title: 'Aucune grille ne tient', text, tone: 'error', key: 'impossible' };
          }
          default: {
            const s = solution.value;
            const sureCount = s.groups.filter((g) => g.sure).length;
            if (a.count === 1) return { title: s.guessed ? 'Quatre groupes, dont un deviné' : 'Les quatre groupes !', text: s.guessed ? 'Trois groupes ont un point commun clair ; les quatre Pokémon restants n\'ont aucun point commun utilisable (un même point commun ne sert qu\'une fois par grille), ce doit être « Dans ta collection ». Valide les trois premiers d\'abord.' : 'Valide-les dans l\'ordre ci-dessous : une ligne de couleur par groupe sur la grille.', tone: 'solved', key: 'solved-1' };
            return {
              title: `${a.truncated ? a.count + '+' : a.count} façons de grouper`,
              text: sureCount ? `${sureCount === 4 ? 'Les quatre groupes' : sureCount === 1 ? 'Une ligne est' : sureCount + ' lignes sont'} marquée${sureCount > 1 ? 's' : ''} « sûr » : ${sureCount > 1 ? 'elles sont' : 'elle est'} dans toutes les solutions, valide-${sureCount > 1 ? 'les' : 'la'} d'abord. Pour le reste, essaie cette solution, puis « Autre solution » si le jeu la refuse (4 erreurs max).` : 'Aucun groupe n\'est commun à toutes les solutions. Essaie celle-ci (la plus spécifique), puis « Autre solution » si le jeu la refuse.',
              tone: 'solved', key: `solved-${solutionIndex.value}`,
            };
          }
        }
      });

      // ---------------- styles ----------------
      const typeStyle = (t) => {
        const [bg, ink] = TYPE_COLORS[t] || ['#ddd', '#1a1a1a'];
        return { '--tc': bg, '--tink': ink };
      };
      const spriteUrl = (id) => `${SPRITES}${id}.png`;
      const summaryOf = (e) => [e.types.join('/'), e.gen ? `G${e.gen}` : '', e.lineage ? `famille ${e.lineage}` : ''].filter(Boolean).join(' · ');

      // ---------------- editor ----------------
      const suggestions = computed(() => {
        if (editing.value == null) return [];
        const q = norm(current.value.name);
        if (q.length < 2) return [];
        const starts = [];
        const contains = [];
        for (const m of DEX.mons) {
          const full = norm(m.f ? `${m.n} ${m.f}` : m.n);
          const base = norm(m.n);
          if (base.startsWith(q) || full.startsWith(q)) starts.push(m);
          else if (full.includes(q)) contains.push(m);
          if (starts.length >= 6) break;
        }
        const c = current.value;
        return starts.concat(contains).slice(0, 6).filter((m) => !(m.n === c.name && (m.f || null) === (c.form || null) && m.id === c.id));
      });
      const nextEmptyIndex = (from) => {
        for (let k = 1; k <= 16; k++) {
          const i = (from + k) % 16;
          if (!S.isComplete(state.mons[i])) return i;
        }
        return -1;
      };
      const nextEmptyLabel = computed(() => {
        if (editing.value == null) return '';
        const i = nextEmptyIndex(editing.value);
        return i < 0 || filledCount.value >= 16 ? 'Terminer ✓' : `Case ${i + 1} ▶`;
      });
      function focusName(select) {
        nextTick(() => {
          const el = nameInput.value;
          if (!el) return;
          el.focus();
          if (select) el.select();
        });
      }
      function openEditor(i) {
        editing.value = i;
        manualOpen.value = false;
        UI.revealAboveSheet('.tile.active');
        focusName(true);
      }
      function closeEditor() {
        editing.value = null;
      }
      function nextTile() {
        if (editing.value != null && editing.value < 15) openEditor(editing.value + 1);
      }
      function prevTile() {
        if (editing.value != null && editing.value > 0) openEditor(editing.value - 1);
      }
      function nextEmpty() {
        if (editing.value == null) return;
        const i = nextEmptyIndex(editing.value);
        if (i < 0) closeEditor();
        else openEditor(i);
      }
      function onNameInput(e) {
        const c = current.value;
        c.name = e.target.value;
        c.form = null;
        c.id = null;
        c.sprite = null;
      }
      function onNameEnter() {
        if (suggestions.value.length) pick(suggestions.value[0]);
        else nextEmpty();
      }
      function pick(m) {
        if (editing.value == null) return;
        Object.assign(state.mons[editing.value], S.fromPokedex(m));
        const el = document.querySelector('.tile.active');
        nextTick(() => UI.confettiAt(el, { particleCount: 10, colors: ['#4cc9f0', '#ffffff'] }));
        nextEmpty();
      }
      function toggleType(t) {
        const c = current.value;
        const i = c.types.indexOf(t);
        if (i >= 0) c.types.splice(i, 1);
        else if (c.types.length < 2) c.types.push(t);
      }
      function setGen(g) {
        current.value.gen = current.value.gen === g ? null : g;
      }
      function setPlace(p) {
        current.value.place = current.value.place === p ? null : p;
      }
      function clearTile(i) {
        Object.assign(state.mons[i], emptyEntry());
        focusName(false);
      }

      // ---------------- keyboard ----------------
      function onKey(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const target = e.target instanceof Element ? e.target : null;
        const typing = !!target && !!target.closest('input, textarea, select');
        if (editing.value != null) {
          if (e.key === 'Escape') { closeEditor(); e.preventDefault(); }
          return;
        }
        if (typing) return;
        const onControl = !!target && !!target.closest('button, summary, a');
        if ((e.key === 'Enter' || e.key === ' ') && onControl) return;
        if (e.key === 'Enter' && filledCount.value < 16) {
          const i = nextEmptyIndex(15);
          if (i >= 0) { openEditor(i); e.preventDefault(); }
        }
      }

      // ---------------- actions ----------------
      function otherSolution() {
        const n = analysis.value.count;
        if (n > 1) solutionIndex.value = (solutionIndex.value + 1) % n;
      }
      function snapshotForUndo() {
        undo.value = JSON.parse(JSON.stringify(state.mons));
        if (undoTimer) clearTimeout(undoTimer);
        undoTimer = setTimeout(() => { undo.value = null; }, 10000);
      }
      function restoreUndo() {
        if (!undo.value) return;
        state.mons = undo.value;
        undo.value = null;
        closeEditor();
      }
      const hasData = () => state.mons.some((c) => c.name || c.types.length || c.gen);
      function resetAll() {
        if (hasData()) snapshotForUndo();
        state.mons = Array.from({ length: 16 }, emptyEntry);
        openEditor(0);
      }
      function loadExample() {
        if (hasData()) snapshotForUndo();
        state.mons = EXAMPLE.map((n) => {
          const m = findMon(n, null);
          return m ? S.fromPokedex(m) : { ...emptyEntry(), name: n };
        });
        closeEditor();
      }

      // ---------------- effects ----------------
      watch(status, (s, old) => {
        if (s === 'solved' && old != null && old !== 'solved') {
          UI.celebrate(GROUP_COLORS);
          if (UI.isMobile()) nextTick(() => { const el = document.querySelector('.grid'); if (el) el.scrollIntoView({ block: 'start', behavior: UI.reducedMotion() ? 'auto' : 'smooth' }); });
        }
      });
      watch(() => state.mons, () => { solutionIndex.value = 0; }, { deep: true });
      watch(state, () => UI.saveJSON(STORAGE_KEY, { mons: state.mons }), { deep: true });

      onMounted(() => {
        window.addEventListener('keydown', onKey);
        let hash = location.hash || '';
        try { hash = decodeURIComponent(hash); } catch (e) { /* keep raw */ }
        if (hash === '#exemple' || hash === '#example') {
          loadExample();
          history.replaceState(null, '', location.pathname);
        } else if (filledCount.value === 0 && !UI.isMobile()) openEditor(0);
      });
      onUnmounted(() => window.removeEventListener('keydown', onKey));

      window.connexions = { state, loadExample, openEditor, closeEditor, pick, resetAll, otherSolution, analysis };

      return {
        TYPES, PLACES: S.PLACES, state, editing, manualOpen, undo, sparks, nameInput, broken,
        filledCount, analysis, status, solution, current, rows, advice, countText, suggestions, nextEmptyLabel,
        isComplete: S.isComplete, entryLabel, typeStyle, spriteUrl, summaryOf,
        openEditor, closeEditor, nextTile, prevTile, nextEmpty, onNameInput, onNameEnter, pick, toggleType, setGen, setPlace, clearTile,
        otherSolution, resetAll, loadExample, restoreUndo,
      };
    },
  });
  UI.install(app).mount('#app');
})();
