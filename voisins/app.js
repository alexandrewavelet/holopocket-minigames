/* Les Voisins Solver — Vue app (logic in solver.js, shared UI in ../shared/js/ui.js, data in ../data/pokedex.js). */
(function () {
  'use strict';
  const { createApp, reactive, ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
  const S = VoisinsSolver;
  const UI = HoloUI;
  const DEX = window.POKEDEX || { types: [], mons: [] };

  const STORAGE_KEY = 'voisins-solver:v1';
  const TYPES = DEX.types.length ? DEX.types : ['Normal', 'Combat', 'Vol', 'Poison', 'Sol', 'Roche', 'Insecte', 'Spectre', 'Acier', 'Feu', 'Eau', 'Plante', 'Électrik', 'Psy', 'Glace', 'Dragon', 'Ténèbres', 'Fée'];
  const TYPE_COLORS = {
    Normal: ['#A8A77A', '#1a1a1a'], Feu: ['#EE8130', '#1a1a1a'], Eau: ['#6390F0', '#fff'], Plante: ['#7AC74C', '#1a1a1a'],
    Électrik: ['#F7D02C', '#1a1a1a'], Glace: ['#96D9D6', '#1a1a1a'], Combat: ['#C22E28', '#fff'], Poison: ['#A33EA1', '#fff'],
    Sol: ['#E2BF65', '#1a1a1a'], Vol: ['#A98FF3', '#1a1a1a'], Psy: ['#F95587', '#fff'], Insecte: ['#A6B91A', '#1a1a1a'],
    Roche: ['#B6A136', '#1a1a1a'], Spectre: ['#735797', '#fff'], Dragon: ['#6F35FC', '#fff'], Ténèbres: ['#705746', '#fff'],
    Acier: ['#B7B7CE', '#1a1a1a'], Fée: ['#D685AD', '#1a1a1a'],
  };
  const EXAMPLE = [
    ['Lippoutou', null, ['Glace', 'Psy'], 1, 'Lippouti'],
    ['Zapétrel', null, ['Électrik', 'Vol'], 9, 'Zapétrel'],
    ['Cadoizo', null, ['Glace', 'Vol'], 2, 'Cadoizo'],
    ['Chongjian', null, ['Ténèbres', 'Plante'], 9, 'Chongjian'],
    ['Qwilfish', 'de Hisui', ['Ténèbres', 'Poison'], 8, 'Qwilfish'],
    ['Nirondelle', null, ['Normal', 'Vol'], 3, 'Nirondelle'],
    ['Baojian', null, ['Ténèbres', 'Glace'], 9, 'Baojian'],
    ['Bekaglaçon', null, ['Glace'], 8, 'Bekaglaçon'],
    ['Hexadron', null, ['Combat'], 8, 'Hexadron'],
  ];
  const emptyCard = () => ({ name: '', form: null, types: [], gen: null, lineage: '' });
  const cardFrom = ([name, form, types, gen, lineage]) => ({ name, form, types: types.slice(), gen, lineage });
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

  function validateSaved(s) {
    if (!s || !Array.isArray(s.cards) || s.cards.length !== 9) return null;
    const cards = s.cards.map((c) => {
      if (!c || typeof c !== 'object') return emptyCard();
      return {
        name: typeof c.name === 'string' ? c.name : '',
        form: typeof c.form === 'string' ? c.form : null,
        types: Array.isArray(c.types) ? c.types.filter((t) => TYPES.includes(t)).slice(0, 2) : [],
        gen: Number.isInteger(c.gen) && c.gen >= 1 && c.gen <= 9 ? c.gen : null,
        lineage: typeof c.lineage === 'string' ? c.lineage : '',
      };
    });
    return { cards, mode: s.mode };
  }

  const app = createApp({
    setup() {
      const saved = UI.loadJSON(STORAGE_KEY, validateSaved);
      const state = reactive({
        cards: saved ? saved.cards : Array.from({ length: 9 }, emptyCard),
        mode: saved && saved.mode === 'step' ? 'step' : 'instant',
      });
      const editing = ref(null);
      const solutionIndex = ref(0);
      const undo = ref(null);
      const nameInput = ref(null);
      let undoTimer = null;
      const sparks = UI.sparks(8);

      // ---------------- analysis ----------------
      const filledCount = computed(() => state.cards.filter(S.isComplete).length);
      const analysis = computed(() => S.analyze(state.cards, { solutionIndex: solutionIndex.value, limit: 100 }));
      const status = computed(() => analysis.value.status);
      const steps = computed(() => analysis.value.steps);
      const stepper = UI.useStepper(steps, computed(() => state.mode === 'step' && status.value !== 'incomplete'));
      const { idx, stepMode, currentStep, atResult, highlightStep } = stepper;
      const cardLabel = (c, i) => S.cardName(c, i);
      const current = computed(() => (editing.value == null ? emptyCard() : state.cards[editing.value]));

      // cells shown on the page: all of them once solved, or those placed up to the current step
      const placedCells = computed(() => {
        const a = analysis.value;
        if (a.status !== 'solved') return new Set();
        if (!stepMode.value) return new Set(S.CELLS);
        const set = new Set();
        a.steps.slice(0, idx.value + 1).forEach((s) => { if (s.rule === 'place') set.add(s.cell); });
        return set;
      });
      const hotCards = computed(() => new Set(highlightStep.value && highlightStep.value.cards ? highlightStep.value.cards : []));
      const view = computed(() => {
        const a = analysis.value;
        return S.CELLS.map((cell) => {
          const placed = placedCells.value.has(cell);
          const ci = placed ? a.layout[cell] : null;
          const card = ci != null ? state.cards[ci] : null;
          const link = (other) => (placed && placedCells.value.has(other) ? a.graph.reasons[ci][a.layout[other]] : null);
          return {
            cell,
            card,
            label: card ? cardLabel(card, ci) : '',
            right: cell % 3 < 2 ? link(cell + 1) : null,
            bottom: cell < 6 ? link(cell + 3) : null,
            hot: !!highlightStep.value && highlightStep.value.rule === 'place' && highlightStep.value.cell === cell,
          };
        });
      });
      const degreeOf = (i) => {
        const a = analysis.value;
        if (!a.graph) return null;
        if (!stepMode.value) return a.status === 'impossible' ? a.graph.degree[i] : null;
        return a.graph.degree[i];
      };

      const advice = computed(() => {
        const a = analysis.value;
        if (stepMode.value) {
          const s = currentStep.value;
          const tone = s.kind === 'result' ? 'solved' : s.kind === 'error' ? 'error' : 'rule';
          return { title: s.title, text: s.text, tone, key: `step-${idx.value}-${solutionIndex.value}` };
        }
        switch (a.status) {
          case 'incomplete':
            return filledCount.value === 0
              ? { title: 'Recopie tes 9 cartes', text: 'Touche une carte du bac, tape le nom du Pokémon et laisse le Pokédex remplir types, génération et lignée. Vérifie avec la carte du jeu, puis passe à la suivante.', tone: 'neutral', key: 'empty' }
              : { title: `Encore ${9 - filledCount.value} carte${9 - filledCount.value > 1 ? 's' : ''} à saisir`, text: 'Il me faut au moins un type et la génération de chaque carte (la lignée est optionnelle). Je range la page dès que les 9 sont là.', tone: 'neutral', key: 'partial' };
          case 'impossible': {
            const last = a.steps[a.steps.length - 1];
            return { title: last.title, text: last.text, tone: 'error', key: 'impossible' };
          }
          default: {
            const last = a.steps[a.steps.length - 1];
            return { title: last.title, text: `Chaque carte partage un point commun avec ses voisines (écrit entre les cartes). Pose-les dans cet ordre : 9 coups suffisent.${a.solutions.length > 1 ? ' Touche « Autre disposition » pour en voir une autre.' : ''}`, tone: 'solved', key: `solved-${solutionIndex.value}` };
          }
        }
      });
      const stepIcons = { links: '🔗', corners: '📐', center: '🎯', place: '🃏', solved: '🏆', isolated: '⚠️', nosolution: '⚠️' };

      // ---------------- styles ----------------
      const typeStyle = (t) => {
        const [bg, ink] = TYPE_COLORS[t] || ['#ddd', '#1a1a1a'];
        return { '--tc': bg, '--tink': ink };
      };
      const cardStyle = (card) => {
        const c1 = (TYPE_COLORS[card.types[0]] || ['#888'])[0];
        const c2 = (TYPE_COLORS[card.types[1] || card.types[0]] || ['#555'])[0];
        return { '--c1': c1, '--c2': c2 };
      };
      const linkText = (reasons) => (reasons.length > 1 ? `${reasons[0].value} +${reasons.length - 1}` : reasons[0].value);
      const linkStyle = (reasons) => {
        const r = reasons[0];
        if (r.kind === 'type') {
          const [bg, ink] = TYPE_COLORS[r.value] || ['#fff7dc', '#1a1a1a'];
          return { '--pill': bg, '--pill-ink': ink };
        }
        if (r.kind === 'gen') return { '--pill': '#fff7dc', '--pill-ink': '#1a1a1a' };
        return { '--pill': '#a46ee6', '--pill-ink': '#fff' };
      };

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
        const out = starts.concat(contains).slice(0, 6);
        // the exact card already picked is not a suggestion anymore
        const c = current.value;
        return out.filter((m) => !(m.n === c.name && (m.f || null) === (c.form || null) && m.t.join() === c.types.join() && m.g === c.gen));
      });
      const lineageSuggestions = computed(() => {
        const set = new Set();
        state.cards.forEach((c, i) => { if (i !== editing.value && c.lineage) set.add(c.lineage.trim()); });
        return [...set];
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
        UI.revealAboveSheet('.tray-card.active');
        focusName(true);
      }
      function closeEditor() {
        editing.value = null;
      }
      function nextCard() {
        if (editing.value == null) return;
        if (editing.value < 8) {
          editing.value++;
          UI.revealAboveSheet('.tray-card.active');
          focusName(true);
        } else closeEditor();
      }
      function prevCard() {
        if (editing.value > 0) {
          editing.value--;
          focusName(true);
        }
      }
      function onNameInput(e) {
        current.value.name = e.target.value;
        current.value.form = null;
      }
      function onNameEnter() {
        if (suggestions.value.length) pick(suggestions.value[0]);
        else nextCard();
      }
      function pick(m) {
        const c = current.value;
        c.name = m.n;
        c.form = m.f || null;
        c.types = m.t.slice(0, 2);
        c.gen = m.g;
        c.lineage = m.l;
        const el = document.querySelector('.tray-card.active');
        nextTick(() => UI.confettiAt(el, { particleCount: 10, colors: ['#5be38a', '#ffffff'] }));
        nextCard();
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
      function clearCard(i) {
        Object.assign(state.cards[i], emptyCard());
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
        if (e.key === 'Enter' && filledCount.value < 9) {
          const i = state.cards.findIndex((c) => !S.isComplete(c));
          if (i >= 0) { openEditor(i); e.preventDefault(); }
          return;
        }
        stepper.onKey(e);
      }

      // ---------------- actions ----------------
      function setMode(m) {
        state.mode = m;
        stepper.reset();
      }
      function otherSolution() {
        const n = analysis.value.solutions.length;
        if (n > 1) solutionIndex.value = (solutionIndex.value + 1) % n;
      }
      function snapshotForUndo() {
        undo.value = JSON.parse(JSON.stringify(state.cards));
        if (undoTimer) clearTimeout(undoTimer);
        undoTimer = setTimeout(() => { undo.value = null; }, 10000);
      }
      function restoreUndo() {
        if (!undo.value) return;
        state.cards = undo.value;
        undo.value = null;
        closeEditor();
      }
      function resetAll() {
        if (state.cards.some((c) => c.name || c.types.length || c.gen || c.lineage)) snapshotForUndo();
        state.cards = Array.from({ length: 9 }, emptyCard);
        openEditor(0);
      }
      function loadExample() {
        if (state.cards.some((c) => c.name || c.types.length)) snapshotForUndo();
        state.cards = EXAMPLE.map(cardFrom);
        closeEditor();
      }

      // ---------------- effects ----------------
      watch(status, (s, old) => {
        if (s === 'solved' && old != null && old !== 'solved') {
          UI.celebrate(['#5be38a', '#ffffff', '#ffd60a', '#2fbf71']);
          if (UI.isMobile()) nextTick(() => { const el = document.querySelector('.page'); if (el) el.scrollIntoView({ block: 'start', behavior: UI.reducedMotion() ? 'auto' : 'smooth' }); });
        }
      });
      watch(() => state.cards, () => { stepper.reset(); solutionIndex.value = 0; }, { deep: true });
      watch(solutionIndex, () => stepper.reset());
      watch(state, () => UI.saveJSON(STORAGE_KEY, { cards: state.cards, mode: state.mode }), { deep: true });

      onMounted(() => {
        window.addEventListener('keydown', onKey);
        let hash = location.hash || '';
        try { hash = decodeURIComponent(hash); } catch (e) { /* keep raw */ }
        if (hash === '#exemple' || hash === '#example') {
          loadExample();
          if (hash === '#example') setMode('step');
          history.replaceState(null, '', location.pathname);
        } else if (filledCount.value === 0 && !UI.isMobile()) openEditor(0);
      });
      onUnmounted(() => window.removeEventListener('keydown', onKey));

      window.voisins = { state, openEditor, closeEditor, pick, setMode, loadExample, resetAll, otherSolution, stepNext: stepper.next, stepLast: stepper.last, analysis };

      return {
        TYPES, state, editing, undo, sparks, stepper, nameInput,
        filledCount, analysis, status, steps, stepIndex: idx, stepMode, atResult, view, hotCards, advice, stepIcons, current, suggestions, lineageSuggestions,
        isComplete: S.isComplete, cardLabel, degreeOf, typeStyle, cardStyle, linkText, linkStyle,
        openEditor, closeEditor, nextCard, prevCard, onNameInput, onNameEnter, pick, toggleType, setGen, clearCard,
        setMode, otherSolution, resetAll, loadExample, restoreUndo,
      };
    },
  });
  UI.install(app).mount('#app');
})();
