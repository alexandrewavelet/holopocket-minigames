/* Cartodle Solver — Vue app (logic in solver.js, shared UI in ../shared/js/ui.js, data in ../data/cards.js). */
(function () {
  'use strict';
  const { createApp, reactive, ref, shallowRef, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
  const S = CartodleSolver;
  const UI = HoloUI;
  const DB = window.CARDS || { generated: '?', fields: ['localId', 'name', 'dex', 'type', 'stage', 'hp', 'rarity', 'set', 'illustrator', 'suffix', 'image'], series: [], sets: [], types: [], stages: [], rarities: [], illustrators: [], cards: [] };

  const STORAGE_KEY = 'cartodle-solver:v1';
  const ALL = S.decode(DB);
  const BY_ID = new Map(ALL.map((c) => [c.id, c]));
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  for (const c of ALL) {
    c.q = norm(c.name);
    c.q2 = norm(`${c.name} ${c.set.name} ${c.rarity || ''} ${c.localId}`);
  }
  const TYPE_COLORS = {
    Plante: '#7AC74C', Feu: '#EE8130', Eau: '#6390F0', Électrique: '#F7D02C', Psy: '#F95587', Combat: '#C22E28',
    Obscurité: '#705746', Métal: '#B7B7CE', Dragon: '#6F35FC', Fée: '#D685AD', Incolore: '#A8A77A',
  };
  const ICON = { eq: '✓', near: '≈', up: '↑', down: '↓', no: '✗' };
  const SHORT = { pokemon: 'Pkmn', type: 'Type', stage: 'Stade', hp: 'PV', rarity: 'Rareté', set: 'Ext.', illustrator: 'Illu.' };
  const TITLES = {
    pokemon: { eq: 'Même Pokémon', up: 'La carte mystère a un n° de Pokédex plus grand', down: 'La carte mystère a un n° de Pokédex plus petit' },
    type: { eq: 'Même type', no: 'Type différent' },
    stage: { eq: 'Même stade', no: 'Stade différent' },
    hp: { eq: 'Mêmes PV', near: 'PV à 20 près', up: 'La carte mystère a plus de PV', down: 'La carte mystère a moins de PV' },
    rarity: { eq: 'Même rareté', up: 'La carte mystère est plus rare', down: 'La carte mystère est moins rare' },
    set: { eq: 'Même extension', near: 'Même série d\'extensions', up: 'L\'extension de la carte mystère est sortie plus tard', down: 'L\'extension de la carte mystère est sortie plus tôt' },
    illustrator: { eq: 'Même illustrateur', no: 'Illustrateur différent' },
  };
  // The three rows of the screenshot (mystery: Fulgudog V · Clash des Rebelles · Rare Holo V)
  const EXAMPLE = [
    ['swsh2-181', { pokemon: 'eq', type: 'eq', stage: 'eq', hp: 'eq', rarity: 'down', set: 'eq', illustrator: 'eq' }],
    ['swsh2-68', { pokemon: 'down', type: 'eq', stage: 'eq', hp: 'up', rarity: 'up', set: 'eq', illustrator: 'no' }],
    ['swsh4-62', { pokemon: 'down', type: 'eq', stage: 'eq', hp: 'up', rarity: 'up', set: 'near', illustrator: 'no' }],
  ];
  const emptyFb = () => Object.fromEntries(S.ATTRS.map((a) => [a, null]));
  const validFb = (fb) => fb && typeof fb === 'object' && S.ATTRS.every((a) => S.STATES[a].includes(fb[a]));
  const cleanFb = (fb) => Object.fromEntries(S.ATTRS.map((a) => [a, fb[a]]));

  function validateSaved(s) {
    if (!s || typeof s !== 'object') return null;
    const guesses = Array.isArray(s.guesses) ? s.guesses.filter((g) => g && typeof g.id === 'string' && BY_ID.has(g.id) && validFb(g.fb)).map((g) => ({ id: g.id, fb: cleanFb(g.fb) })) : [];
    return { guesses, mode: s.mode, pocket: s.pocket === true };
  }

  const app = createApp({
    setup() {
      const saved = UI.loadJSON(STORAGE_KEY, validateSaved);
      const state = reactive({
        guesses: saved ? saved.guesses : [],
        mode: saved && saved.mode === 'step' ? 'step' : 'instant',
        pocket: saved ? saved.pocket : false,
      });
      const draftCard = shallowRef(null);
      const draft = reactive({ fb: emptyFb() });
      const draftFromReco = ref(false);
      const editingIndex = ref(null);
      const query = ref('');
      const showAll = ref(false);
      const undo = ref(null);
      const searchInput = ref(null);
      const broken = reactive(new Set());
      let undoTimer = null;
      const sparks = UI.sparks(8);

      // ---------------- analysis ----------------
      const pool = computed(() => S.candidates(ALL, { pocket: state.pocket }));
      const resolved = computed(() => state.guesses.map((g) => ({ card: BY_ID.get(g.id), fb: g.fb })));
      const analysis = computed(() => S.analyze({ guesses: resolved.value, pool: pool.value }));
      const status = computed(() => analysis.value.status);
      const steps = computed(() => analysis.value.steps);
      const stepper = UI.useStepper(steps, computed(() => state.mode === 'step' && state.guesses.length > 0));
      const { idx, stepMode, currentStep, atResult, highlightStep } = stepper;
      const recommendation = computed(() => analysis.value.recommendation);
      const canEnter = computed(() => ['empty', 'playing', 'solved', 'invalid'].includes(status.value) || editingIndex.value != null);
      const draftComplete = computed(() => !!draftCard.value && S.complete(draft.fb));
      const draftIsRecommendation = computed(() => !!recommendation.value && !!draftCard.value && draftCard.value.id === recommendation.value.card.id && editingIndex.value == null);
      // what the board shows in step mode: only the guesses up to the current step
      const visibleGuesses = computed(() => {
        if (!stepMode.value) return state.guesses.length;
        const s = currentStep.value;
        if (s.rule === 'start') return 0;
        if (s.guess != null) return s.guess + 1;
        return state.guesses.length;
      });
      const shownGuesses = computed(() => Math.min(visibleGuesses.value, state.guesses.length));
      const notebook = computed(() => (stepMode.value ? currentStep.value.constraints : analysis.value.constraints));
      const shownRecommendation = computed(() => (atResult.value && recommendation.value && status.value !== 'won' ? recommendation.value : null));
      const shownCandidates = computed(() => {
        const a = analysis.value;
        if (!atResult.value || a.count < 2 || a.count > 60) return [];
        return showAll.value ? a.candidates : a.candidates.slice(0, 12);
      });

      const valueOf = (card, a) => {
        switch (a) {
          case 'pokemon': return `n° ${card.dex}`;
          case 'type': return card.type || 'inconnu (réponse ignorée)';
          case 'stage': return card.stage || 'inconnu (réponse ignorée)';
          case 'hp': return `${card.hp} PV`;
          case 'rarity': return card.rarity || 'sans rareté';
          case 'set': return card.set.name;
          default: return card.illustrator || 'inconnu (réponse ignorée)';
        }
      };
      const rows = computed(() =>
        state.guesses.map((g, i) => {
          const card = BY_ID.get(g.id);
          const hot = !!highlightStep.value && highlightStep.value.guess === i;
          return {
            index: i, card, fb: g.fb,
            cls: { hidden: i >= visibleGuesses.value, editing: editingIndex.value === i, bad: status.value === 'invalid' && analysis.value.invalidAt === i, hot, won: S.isWin(g.fb, card), past: true },
            cells: S.ATTRS.map((a) => ({ attr: a, state: g.fb[a], value: valueOf(card, a) })),
          };
        }),
      );

      const advice = computed(() => {
        const a = analysis.value;
        if (stepMode.value) {
          const s = currentStep.value;
          const tone = s.kind === 'result' ? (a.status === 'won' ? 'done' : a.status === 'invalid' || a.status === 'nopool' ? 'error' : 'solved') : s.kind === 'error' ? 'error' : s.kind === 'info' ? 'info' : 'rule';
          return { title: s.title, text: s.text, tone, key: `step-${idx.value}` };
        }
        const last = a.steps[a.steps.length - 1];
        const tone = a.status === 'won' ? 'done' : a.status === 'invalid' || a.status === 'nopool' ? 'error' : a.status === 'solved' ? 'solved' : a.status === 'empty' ? 'info' : 'playing';
        return { title: last.title, text: last.text, tone, key: `${a.status}-${state.guesses.length}-${a.count}` };
      });
      const stepIcons = { start: '🃏', guess: '🔍', won: '🏆', solved: '🎯', playing: '✨', empty: '✨', invalid: '⚠️', nopool: '⚠️' };

      // ---------------- helpers ----------------
      const typeStyle = (card) => ({ '--tc': (card && TYPE_COLORS[card.type]) || '#555' });
      const thumb = (card) => (card && card.image && !broken.has(card.id) ? card.image : null);
      const yearOf = (card) => (card.set.date ? card.set.date.slice(0, 4) : '?');
      const stateTitle = (a, st) => (st ? TITLES[a][st] : 'Pas encore renseigné');

      // ---------------- search ----------------
      const suggestions = computed(() => {
        if (draftCard.value) return [];
        const q = norm(query.value);
        if (q.length < 2 && !/^\d+$/.test(q)) return [];
        const tokens = q.split(/\s+/).filter(Boolean);
        if (!tokens.length) return [];
        const [first, ...rest] = tokens;
        const numeric = /^\d+$/.test(first) ? Number(first) : null;
        const out = [];
        for (const c of ALL) {
          const hit = numeric != null ? c.dex === numeric || c.localId === first : c.q.startsWith(first);
          if (!hit) continue;
          if (rest.some((t) => !c.q2.includes(t))) continue;
          out.push(c);
        }
        out.sort((a, b) => (b.set.date || '').localeCompare(a.set.date || '') || a.name.localeCompare(b.name) || a.localId.localeCompare(b.localId, undefined, { numeric: true }));
        return out.slice(0, 8);
      });
      function focusSearch() {
        nextTick(() => { if (searchInput.value) searchInput.value.focus(); });
      }
      function pick(card) {
        draftCard.value = card;
        draftFromReco.value = false;
        draft.fb = emptyFb();
        query.value = '';
        nextTick(() => UI.confettiAt(document.querySelector('.picked .thumb'), { particleCount: 10, colors: [TYPE_COLORS[card.type] || '#8f7bff', '#ffffff'] }));
      }
      function pickFirst() {
        if (suggestions.value.length) pick(suggestions.value[0]);
      }
      function changeCard() {
        draftCard.value = null;
        draftFromReco.value = false;
        draft.fb = emptyFb();
        focusSearch();
      }

      // ---------------- answers ----------------
      function setState(a, st) {
        draft.fb[a] = draft.fb[a] === st ? null : st;
      }
      function cycleState(a) {
        const list = S.STATES[a];
        const i = list.indexOf(draft.fb[a]);
        draft.fb[a] = i < 0 ? list[0] : i === list.length - 1 ? null : list[i + 1];
      }
      function clearAnswers() {
        draft.fb = emptyFb();
      }
      function resetDraft() {
        draftCard.value = null;
        draftFromReco.value = false;
        draft.fb = emptyFb();
        query.value = '';
      }
      function submit() {
        if (!draftComplete.value) return;
        const guess = { id: draftCard.value.id, fb: cleanFb(draft.fb) };
        if (editingIndex.value != null) state.guesses.splice(editingIndex.value, 1, guess);
        else state.guesses.push(guess);
        editingIndex.value = null;
        resetDraft();
        if (UI.isMobile()) nextTick(() => { const el = document.querySelector('.advice'); if (el) el.scrollIntoView({ block: 'start', behavior: UI.reducedMotion() ? 'auto' : 'smooth' }); });
      }
      function editGuess(i) {
        if (stepMode.value) { stepper.onSelect(steps.value[i + 1], i + 1); return; }
        const g = state.guesses[i];
        editingIndex.value = i;
        draftCard.value = BY_ID.get(g.id);
        draftFromReco.value = false;
        draft.fb = cleanFb(g.fb);
        nextTick(() => { const el = document.querySelector('.entry'); if (el && UI.isMobile()) el.scrollIntoView({ block: 'start', behavior: UI.reducedMotion() ? 'auto' : 'smooth' }); });
      }
      function cancelEdit() {
        editingIndex.value = null;
        resetDraft();
      }
      function deleteGuess(i) {
        state.guesses.splice(i, 1);
        editingIndex.value = null;
        resetDraft();
      }
      function useCard(card, fromReco) {
        if (stepMode.value) setMode('instant');
        editingIndex.value = null;
        draftCard.value = card;
        draftFromReco.value = !!fromReco;
        draft.fb = emptyFb();
        query.value = '';
        nextTick(() => { const el = document.querySelector('.answers'); if (el && UI.isMobile()) el.scrollIntoView({ block: 'center', behavior: UI.reducedMotion() ? 'auto' : 'smooth' }); });
      }
      function useRecommendation() {
        if (recommendation.value) useCard(recommendation.value.card, true);
      }

      // ---------------- keyboard ----------------
      function onKey(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const target = e.target instanceof Element ? e.target : null;
        if (target && target.closest('input, textarea, select')) return;
        const onControl = !!target && !!target.closest('button, summary, a');
        if ((e.key === 'Enter' || e.key === ' ') && onControl) return;
        if (stepMode.value) { stepper.onKey(e); return; }
        if (!canEnter.value) return;
        if (e.key === '/' && !draftCard.value) { focusSearch(); e.preventDefault(); return; }
        if (!draftCard.value) return;
        if (/^[1-7]$/.test(e.key)) { cycleState(S.ATTRS[Number(e.key) - 1]); e.preventDefault(); }
        else if (e.key === 'Backspace') { changeCard(); e.preventDefault(); }
        else if (e.key === 'Enter' && draftComplete.value) { submit(); e.preventDefault(); }
        else if (e.key === 'Escape') { if (editingIndex.value != null) cancelEdit(); else changeCard(); }
      }

      // ---------------- actions ----------------
      function setMode(m) {
        state.mode = m;
        stepper.reset();
      }
      function snapshotForUndo() {
        undo.value = JSON.parse(JSON.stringify({ guesses: state.guesses }));
        if (undoTimer) clearTimeout(undoTimer);
        undoTimer = setTimeout(() => { undo.value = null; }, 10000);
      }
      function restoreUndo() {
        if (!undo.value) return;
        state.guesses = undo.value.guesses;
        undo.value = null;
      }
      function resetAll() {
        if (state.guesses.length) snapshotForUndo();
        state.guesses = [];
        editingIndex.value = null;
        resetDraft();
      }
      function loadExample() {
        if (state.guesses.length) snapshotForUndo();
        state.guesses = EXAMPLE.filter(([id]) => BY_ID.has(id)).map(([id, fb]) => ({ id, fb: { ...fb } }));
        editingIndex.value = null;
        resetDraft();
      }

      // ---------------- effects ----------------
      // the draft starts on the recommended card: the player only has to copy the seven answers
      watch([recommendation, canEnter, editingIndex, stepMode], () => {
        if (!canEnter.value || editingIndex.value != null || stepMode.value) return;
        if (draftCard.value && !draftFromReco.value) return;
        if (!recommendation.value) { if (draftFromReco.value) { draftCard.value = null; draftFromReco.value = false; } return; }
        if (draftCard.value && draftCard.value.id === recommendation.value.card.id) return;
        draftCard.value = recommendation.value.card;
        draftFromReco.value = true;
        draft.fb = emptyFb();
      }, { immediate: true });
      watch(status, (s, old) => {
        if (s === 'won' && old != null && old !== 'won') UI.celebrate(['#8f7bff', '#ffffff', '#ffd60a', '#2fbf71']);
      });
      watch(() => [state.guesses, state.pocket], () => { stepper.reset(); showAll.value = false; }, { deep: true });
      watch(state, () => UI.saveJSON(STORAGE_KEY, { guesses: state.guesses, mode: state.mode, pocket: state.pocket }), { deep: true });

      onMounted(() => {
        window.addEventListener('keydown', onKey);
        let hash = location.hash || '';
        try { hash = decodeURIComponent(hash); } catch (e) { /* keep raw */ }
        if (hash === '#exemple' || hash === '#example') {
          loadExample();
          if (hash === '#example') setMode('step');
          history.replaceState(null, '', location.pathname);
        }
      });
      onUnmounted(() => window.removeEventListener('keydown', onKey));

      window.cartodle = { state, draft, draftCard, pick, useRecommendation, submit, setMode, loadExample, resetAll, editGuess, changeCard, search: (q) => { query.value = q; }, stepNext: stepper.next, stepLast: stepper.last, analysis, ALL };

      return {
        S, ALL, DB, ATTRS: S.ATTRS, LABELS: S.LABELS, STATES: S.STATES, ICON, SHORT,
        state, draft, draftCard, draftFromReco, editingIndex, query, showAll, undo, searchInput, broken, sparks, stepper,
        pool, analysis, status, steps, stepIndex: idx, stepMode, atResult, recommendation, canEnter, draftComplete, draftIsRecommendation,
        visibleGuesses, shownGuesses, notebook, shownRecommendation, shownCandidates, rows, advice, stepIcons, suggestions,
        valueOf, typeStyle, thumb, yearOf, stateTitle,
        pick, pickFirst, changeCard, setState, clearAnswers, submit, editGuess, cancelEdit, deleteGuess, useCard, useRecommendation,
        setMode, resetAll, loadExample, restoreUndo,
      };
    },
  });
  UI.install(app).mount('#app');
})();
