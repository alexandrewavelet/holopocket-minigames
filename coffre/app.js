/* Le Coffre Solver — Vue app (logic in solver.js, shared UI in ../shared/js/ui.js). */
(function () {
  'use strict';
  const { createApp, reactive, ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
  const C = CoffreSolver;
  const UI = HoloUI;

  const STORAGE_KEY = 'coffre-solver:v1';
  const MAX_TRIES = 8;
  const ENERGIES = [
    { id: 'Plante', color: '#4caf50', ink: '#fff', icon: 'e-leaf' },
    { id: 'Feu', color: '#ff6b2b', ink: '#fff', icon: 'e-flame' },
    { id: 'Eau', color: '#3f8ee8', ink: '#fff', icon: 'e-drop' },
    { id: 'Électrik', color: '#f7d02c', ink: '#1a1a1a', icon: 'e-bolt' },
    { id: 'Psy', color: '#b24cc8', ink: '#fff', icon: 'e-eye' },
    { id: 'Combat', color: '#c47a3a', ink: '#fff', icon: 'e-fist' },
    { id: 'Obscurité', color: '#3b3b5c', ink: '#fff', icon: 'e-moon' },
    { id: 'Métal', color: '#9aa3b2', ink: '#1a1a1a', icon: 'e-gear' },
    { id: 'Fée', color: '#f48fb1', ink: '#1a1a1a', icon: 'e-star' },
  ];
  const BY_ID = Object.fromEntries(ENERGIES.map((e) => [e.id, e]));
  const DEFAULT_SET = ['Plante', 'Feu', 'Eau', 'Électrik', 'Psy', 'Combat'];
  const EXAMPLE = [
    [['Plante', 'Feu', 'Eau', 'Électrik'], 0, 3],
    [['Feu', 'Eau', 'Électrik', 'Psy'], 0, 2],
    [['Eau', 'Électrik', 'Psy', 'Combat'], 3, 0],
    [['Eau', 'Électrik', 'Eau', 'Combat'], 3, 0],
    [['Eau', 'Électrik', 'Électrik', 'Combat'], 3, 0],
  ];
  const emptyDraft = () => ({ guess: [null, null, null, null], exact: 0, misplaced: 0 });

  function validateSaved(s) {
    if (!s || typeof s !== 'object') return null;
    const enabled = Array.isArray(s.enabled) ? s.enabled.filter((id) => BY_ID[id]) : DEFAULT_SET;
    const attempts = Array.isArray(s.attempts)
      ? s.attempts.filter((a) => a && Array.isArray(a.guess) && a.guess.length === 4 && a.guess.every((g) => BY_ID[g]) && Number.isInteger(a.exact) && Number.isInteger(a.misplaced) && a.exact >= 0 && a.misplaced >= 0 && a.exact + a.misplaced <= 4)
        .map((a) => ({ guess: a.guess.slice(), exact: a.exact, misplaced: a.misplaced }))
      : [];
    return { enabled: enabled.length >= 2 ? enabled : DEFAULT_SET, attempts: attempts.slice(0, MAX_TRIES), mode: s.mode };
  }

  const app = createApp({
    setup() {
      const saved = UI.loadJSON(STORAGE_KEY, validateSaved);
      const state = reactive({
        enabled: saved ? saved.enabled : DEFAULT_SET.slice(),
        attempts: saved ? saved.attempts : [],
        mode: saved && saved.mode === 'step' ? 'step' : 'instant',
      });
      const draft = reactive(emptyDraft());
      const cursor = ref(null); // slot the next energy goes to (tap a slot to pick it)
      const draftFromReco = ref(false); // the draft still is the solver's suggestion (untouched by the player)
      const editingIndex = ref(null);
      const undo = ref(null);
      let undoTimer = null;
      const sparks = UI.sparks(8);

      // ---------------- analysis ----------------
      const analysis = computed(() => C.analyze({ symbols: state.enabled, attempts: state.attempts, maxTries: MAX_TRIES }));
      const status = computed(() => analysis.value.status);
      const steps = computed(() => analysis.value.steps);
      const stepper = UI.useStepper(steps, computed(() => state.mode === 'step' && state.attempts.length > 0));
      const { idx, stepMode, currentStep, atResult, highlightStep } = stepper;
      const enabledEnergies = computed(() => ENERGIES.filter((e) => state.enabled.includes(e.id)));
      const usedEnergies = computed(() => new Set(state.attempts.flatMap((a) => a.guess)));
      const recommendation = computed(() => analysis.value.recommendation);
      const canEnter = computed(() => ['empty', 'playing', 'solved', 'invalid'].includes(status.value) && state.attempts.length < MAX_TRIES || editingIndex.value != null);
      const draftComplete = computed(() => draft.guess.every(Boolean));
      const draftIsRecommendation = computed(() => !!recommendation.value && draft.guess.join() === recommendation.value.guess.join());
      const finalCode = computed(() => (status.value === 'won' ? state.attempts[state.attempts.length - 1].guess : status.value === 'solved' ? recommendation.value.guess : null));
      // what the board/notebook show: everything, or only up to the current step
      const visibleAttempts = computed(() => {
        if (!stepMode.value) return state.attempts.length;
        const s = currentStep.value;
        if (s.rule === 'start') return 0;
        if (s.attempt != null) return s.attempt + 1;
        return state.attempts.length;
      });
      const shownCount = computed(() => (stepMode.value ? currentStep.value.remaining : analysis.value.count));
      const notebook = computed(() => (stepMode.value ? currentStep.value.certainties : analysis.value.certainties));
      const shownRecommendation = computed(() => (atResult.value && recommendation.value && status.value !== 'won' ? recommendation.value : null));
      const shownCandidates = computed(() => (atResult.value && analysis.value.count > 1 && analysis.value.count <= 12 ? analysis.value.candidates : []));

      // the chest shows the history; the attempt being typed lives in the entry panel
      const rows = computed(() =>
        Array.from({ length: MAX_TRIES }, (_, i) => {
          const a = state.attempts[i];
          const hot = !!highlightStep.value && highlightStep.value.attempt === i;
          if (a && i < visibleAttempts.value) {
            const bad = status.value === 'invalid' && analysis.value.invalidAt === i;
            return {
              index: i, guess: a.guess, exact: a.exact, misplaced: a.misplaced,
              cls: { past: true, editing: editingIndex.value === i, bad, hot, 'won-row': a.exact === 4 },
              onClick: () => editAttempt(i),
            };
          }
          if (a) return { index: i, guess: a.guess, exact: a.exact, misplaced: a.misplaced, cls: { hidden: true } };
          return { index: i, guess: [null, null, null, null], exact: 0, misplaced: 0, cls: { future: true } };
        }),
      );

      const advice = computed(() => {
        const a = analysis.value;
        if (stepMode.value) {
          const s = currentStep.value;
          const tone = s.kind === 'result' ? (a.status === 'won' ? 'done' : a.status === 'invalid' || a.status === 'out' ? 'error' : 'solved') : s.kind === 'error' ? 'error' : s.kind === 'info' ? 'info' : 'rule';
          return { title: s.title, text: s.text, tone, key: `step-${idx.value}` };
        }
        const last = a.steps[a.steps.length - 1];
        const tone = a.status === 'won' ? 'done' : a.status === 'invalid' || a.status === 'out' ? 'error' : a.status === 'solved' ? 'solved' : a.status === 'empty' ? 'info' : 'playing';
        return { title: last.title, text: last.text, tone, key: `${a.status}-${state.attempts.length}-${a.count}` };
      });
      const stepIcons = { start: '📦', attempt: '🔑', won: '🏆', solved: '🔓', playing: '✨', empty: '✨', invalid: '⚠️', out: '⏳' };

      // ---------------- helpers ----------------
      const energyStyle = (id) => {
        const e = BY_ID[id];
        return e ? { '--ec': e.color, '--eink': e.ink } : null;
      };
      const iconOf = (id) => (BY_ID[id] ? BY_ID[id].icon : 'e-star');

      // ---------------- entry ----------------
      // The draft is pre-filled with the recommended guess: most of the time the player only types the chest's answer.
      function prefill(guess) {
        draft.guess = guess.slice();
        draft.exact = 0;
        draft.misplaced = 0;
        cursor.value = null;
        draftFromReco.value = true;
      }
      function addEnergy(id) {
        if (!canEnter.value) return;
        let target = cursor.value != null ? cursor.value : draft.guess.findIndex((g) => !g);
        if (target < 0) target = 0; // full and nothing picked: type over from the first slot
        draft.guess[target] = id;
        draftFromReco.value = false;
        const nextEmpty = draft.guess.findIndex((g, i) => !g && i > target);
        const anyEmpty = draft.guess.findIndex((g) => !g);
        cursor.value = nextEmpty >= 0 ? nextEmpty : anyEmpty >= 0 ? anyEmpty : target < 3 ? target + 1 : null;
        nextTick(() => UI.confettiAt(document.querySelectorAll('.draft-orbs .orb')[target], { particleCount: 8, colors: [BY_ID[id].color, '#ffffff'], spread: 40 }));
      }
      function tapSlot(i) {
        cursor.value = cursor.value === i ? null : i;
      }
      function removeLast() {
        draftFromReco.value = false;
        for (let i = 3; i >= 0; i--) if (draft.guess[i]) { draft.guess[i] = null; cursor.value = i; return; }
      }
      function clearDraft() {
        Object.assign(draft, emptyDraft());
        cursor.value = 0;
        draftFromReco.value = false;
      }
      function setFeedback(key, v) {
        if (v < 0 || v > 4) return;
        if (key === 'exact' && v + draft.misplaced > 4) return;
        if (key === 'misplaced' && v + draft.exact > 4) return;
        draft[key] = v;
      }
      function bump(key, d) {
        setFeedback(key, draft[key] + d);
      }
      const scrollTo = (selector, block) => nextTick(() => {
        const el = document.querySelector(selector);
        if (el && UI.isMobile()) el.scrollIntoView({ block, behavior: UI.reducedMotion() ? 'auto' : 'smooth' });
      });
      function submit() {
        if (!draftComplete.value) return;
        const attempt = { guess: draft.guess.slice(), exact: draft.exact, misplaced: draft.misplaced };
        if (editingIndex.value != null) state.attempts.splice(editingIndex.value, 1, attempt);
        else state.attempts.push(attempt);
        editingIndex.value = null;
        Object.assign(draft, emptyDraft()); // the recommendation watcher pre-fills the next attempt
        cursor.value = null;
        scrollTo('.advice', 'start');
      }
      function editAttempt(i) {
        if (stepMode.value) { stepper.onSelect(steps.value[i + 1], i + 1); return; }
        editingIndex.value = i;
        const a = state.attempts[i];
        draft.guess = a.guess.slice();
        draft.exact = a.exact;
        draft.misplaced = a.misplaced;
        cursor.value = null;
        scrollTo('.entry', 'start');
      }
      function cancelEdit() {
        editingIndex.value = null;
        if (recommendation.value) prefill(recommendation.value.guess);
        else clearDraft();
      }
      function deleteAttempt(i) {
        state.attempts.splice(i, 1);
        editingIndex.value = null;
        Object.assign(draft, emptyDraft());
        cursor.value = null;
      }
      function useRecommendation() {
        if (!recommendation.value) return;
        if (stepMode.value) setMode('instant');
        editingIndex.value = null;
        prefill(recommendation.value.guess);
        scrollTo('.feedback', 'center');
      }
      function toggleEnergy(id) {
        if (usedEnergies.value.has(id)) return;
        const i = state.enabled.indexOf(id);
        if (i >= 0) {
          if (state.enabled.length <= 2) return;
          state.enabled.splice(i, 1);
          if (draft.guess.includes(id)) Object.assign(draft, emptyDraft());
        } else state.enabled.push(id);
        state.enabled.sort((a, b) => ENERGIES.findIndex((e) => e.id === a) - ENERGIES.findIndex((e) => e.id === b));
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
        if (/^[1-9]$/.test(e.key)) {
          const en = enabledEnergies.value[Number(e.key) - 1];
          if (en) { addEnergy(en.id); e.preventDefault(); }
        } else if (e.key === 'Backspace') { removeLast(); e.preventDefault(); }
        else if (e.key === 'Enter' && draftComplete.value) { submit(); e.preventDefault(); }
        else if (e.key === 'Escape' && editingIndex.value != null) cancelEdit();
      }

      // ---------------- actions ----------------
      function setMode(m) {
        state.mode = m;
        stepper.reset();
      }
      function snapshotForUndo() {
        undo.value = JSON.parse(JSON.stringify({ enabled: state.enabled, attempts: state.attempts }));
        if (undoTimer) clearTimeout(undoTimer);
        undoTimer = setTimeout(() => { undo.value = null; }, 10000);
      }
      function restoreUndo() {
        if (!undo.value) return;
        state.enabled = undo.value.enabled;
        state.attempts = undo.value.attempts;
        undo.value = null;
        editingIndex.value = null;
        Object.assign(draft, emptyDraft());
        cursor.value = null;
      }
      function resetAll() {
        if (state.attempts.length) snapshotForUndo();
        state.attempts = [];
        editingIndex.value = null;
        Object.assign(draft, emptyDraft());
        cursor.value = null;
      }
      function loadExample() {
        if (state.attempts.length) snapshotForUndo();
        state.enabled = DEFAULT_SET.slice();
        state.attempts = EXAMPLE.map(([guess, exact, misplaced]) => ({ guess: guess.slice(), exact, misplaced }));
        editingIndex.value = null;
        Object.assign(draft, emptyDraft());
        cursor.value = null;
      }

      // ---------------- effects ----------------
      watch(status, (s, old) => {
        if (s === 'won' && old != null && old !== 'won') UI.celebrate(['#ffd60a', '#f5b301', '#ffffff', '#c9962b']);
      });
      watch(() => [state.attempts, state.enabled], () => stepper.reset(), { deep: true });
      // an empty or untouched draft takes the recommended guess as soon as there is one (new attempt, undo, example…)
      watch(recommendation, (r) => {
        if (r && editingIndex.value == null && canEnter.value && (!draft.guess.some(Boolean) || draftFromReco.value)) prefill(r.guess);
      }, { immediate: true });
      watch(state, () => UI.saveJSON(STORAGE_KEY, { enabled: state.enabled, attempts: state.attempts, mode: state.mode }), { deep: true });

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

      window.coffre = { state, draft, addEnergy, setFeedback, submit, useRecommendation, setMode, loadExample, resetAll, editAttempt, clearDraft, stepNext: stepper.next, stepLast: stepper.last, analysis };

      return {
        ENERGIES, state, draft, cursor, editingIndex, undo, sparks, stepper,
        analysis, status, steps, stepIndex: idx, stepMode, atResult, enabledEnergies, usedEnergies, recommendation, canEnter, draftComplete, draftIsRecommendation, finalCode,
        shownCount, notebook, shownRecommendation, shownCandidates, rows, advice, stepIcons,
        energyStyle, iconOf,
        addEnergy, tapSlot, clearDraft, setFeedback, bump, submit, editAttempt, cancelEdit, deleteAttempt, useRecommendation, toggleEnergy,
        setMode, resetAll, loadExample, restoreUndo,
      };
    },
  });
  UI.install(app).mount('#app');
})();
