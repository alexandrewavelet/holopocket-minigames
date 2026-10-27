/* Voltorbe Flip Solver — Vue app (UI only; all logic lives in solver.js, shared UI in ../shared/js/ui.js). */
(function () {
  'use strict';
  const { createApp, reactive, ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
  const S = VoltorbSolver;
  const UI = HoloUI;

  const STORAGE_KEY = 'voltorbe-flip-solver:v1';
  const COLOR_CLASS = ['c-red', 'c-green', 'c-orange', 'c-blue', 'c-purple'];
  const EXAMPLE = {
    rows: [[4, 1], [8, 1], [7, 2], [3, 2], [4, 1]],
    cols: [[2, 3], [8, 1], [4, 1], [6, 1], [6, 1]],
  };
  const PENDING_DELAY = 700; // ms before a lone "1" typed in a sum field is committed

  const emptyLines = () => Array.from({ length: 5 }, () => ({ sum: null, volt: null }));
  const emptyGrid = () => Array.from({ length: 5 }, () => Array(5).fill(null));
  const linesFrom = (pairs) => pairs.map(([sum, volt]) => ({ sum, volt }));

  // Restore a saved game only if its shape is exactly what the app writes.
  function validateSaved(s) {
    const int = (v, max) => v === null || (Number.isInteger(v) && v >= 0 && v <= max);
    const isLine = (l) => !!l && typeof l === 'object' && int(l.sum, 15) && int(l.volt, 5);
    const isLines = (a) => Array.isArray(a) && a.length === 5 && a.every(isLine);
    const isGrid = (g) => Array.isArray(g) && g.length === 5 && g.every((row) => Array.isArray(row) && row.length === 5 && row.every((v) => int(v, 3)));
    if (!s || !isLines(s.rows) || !isLines(s.cols) || !isGrid(s.revealed)) return null;
    return {
      rows: s.rows.map((l) => ({ sum: l.sum, volt: l.volt })),
      cols: s.cols.map((l) => ({ sum: l.sum, volt: l.volt })),
      revealed: s.revealed.map((row) => row.slice()),
      mode: s.mode,
    };
  }

  const app = createApp({
    setup() {
      const saved = UI.loadJSON(STORAGE_KEY, validateSaved);
      const state = reactive({
        rows: saved ? saved.rows : emptyLines(),
        cols: saved ? saved.cols : emptyLines(),
        revealed: saved ? saved.revealed : emptyGrid(),
        mode: saved && saved.mode === 'step' ? 'step' : 'instant',
      });
      const active = ref(null); // { type: 'field', line, index, part } | { type: 'cell', r, c }
      const pending = ref(false); // a lone "1" is waiting for a possible second digit
      const undo = ref(null); // snapshot restorable after "Nouvelle grille"
      let pendingTimer = null;
      let undoTimer = null;
      const sparks = UI.sparks(10);

      // ---------------- derived state ----------------
      const fieldOrder = [];
      for (const line of ['row', 'col']) for (let i = 0; i < 5; i++) for (const part of ['sum', 'volt']) fieldOrder.push({ type: 'field', line, index: i, part });
      const lines = (line) => (line === 'row' ? state.rows : state.cols);
      const filledCount = computed(() => fieldOrder.filter((f) => lines(f.line)[f.index][f.part] != null).length);
      const complete = computed(() => filledCount.value === 20);
      const revealedCount = computed(() => state.revealed.flat().filter((v) => v != null).length);
      const analysis = computed(() => S.analyze({ rows: state.rows, cols: state.cols }, state.revealed));
      const status = computed(() => analysis.value.status);
      const steps = computed(() => analysis.value.steps);
      const stepper = UI.useStepper(steps, computed(() => state.mode === 'step' && !!analysis.value.cells));
      const { idx, stepMode, currentStep, atResult, highlightStep } = stepper;
      const showProbs = computed(() => !!analysis.value.cells && (!stepMode.value || idx.value >= analysis.value.enumStepIndex));
      const boardPoss = computed(() => {
        const a = analysis.value;
        if (!a.snapshots.length) return null;
        return stepMode.value ? a.snapshots[idx.value] : a.snapshots[a.snapshots.length - 1];
      });
      const stepLine = computed(() => (highlightStep.value && highlightStep.value.line) || null);
      const changedSet = computed(() => {
        const set = new Set();
        if (highlightStep.value) for (const x of highlightStep.value.cells) set.add(`${x.r},${x.c}`);
        return set;
      });
      const errorFields = computed(() => {
        const set = new Set();
        for (const e of analysis.value.errors || []) if (e.line) set.add(`${e.line}:${e.index}:${e.part || 'sum'}`);
        return set;
      });

      const cells = computed(() => {
        const a = analysis.value;
        return Array.from({ length: 5 }, (_, r) =>
          Array.from({ length: 5 }, (_, c) => {
            const revealed = state.revealed[r][c];
            const cell = a.cells ? a.cells[r][c] : null;
            const poss = boardPoss.value ? boardPoss.value[r][c] : S.FULL;
            let kind = 'unknown';
            if (revealed != null) kind = 'revealed';
            else if (cell && showProbs.value) kind = cell.kind;
            else if (poss !== S.FULL && poss !== 0) {
              if (poss === 1) kind = 'volt';
              else if (poss === 2) kind = 'one';
              else if (!(poss & 1)) kind = 'safe';
              else if (poss === 3) kind = 'dead';
              else kind = 'marked';
            }
            const certain = poss === 2 ? 1 : poss === 4 ? 2 : poss === 8 ? 3 : null;
            const marks = [0, 1, 2, 3].filter((v) => poss & (1 << v));
            const pVolt = cell ? cell.pVolt : null;
            return {
              r, c, revealed, kind, poss, certain, marks,
              label: S.cellLabel(r, c),
              pVolt,
              pGain: cell ? cell.pGain : null,
              risk: showProbs.value && (kind === 'risk' || kind === 'dead') ? Math.round(pVolt * 100) : null,
              showMarks: revealed == null && marks.length < 4 && kind !== 'one' && kind !== 'volt' && !(kind === 'safe' && certain),
              recommended: atResult.value && !!cell && a.status === 'safe' && cell.kind === 'safe',
              guess: atResult.value && !!a.bestGuess && a.bestGuess.r === r && a.bestGuess.c === c,
              inLine: !!stepLine.value && (stepLine.value.type === 'row' ? stepLine.value.index === r : stepLine.value.index === c),
              changed: changedSet.value.has(`${r},${c}`),
            };
          }),
        );
      });

      const advice = computed(() => {
        const a = analysis.value;
        if (stepMode.value) {
          const s = currentStep.value;
          const tone = s.kind === 'result' ? a.status : s.kind === 'error' ? 'error' : s.kind;
          return { title: s.title, text: s.text, tone, key: `step-${idx.value}` };
        }
        switch (a.status) {
          case 'incomplete':
            return filledCount.value === 0
              ? { title: 'Recopie ta grille', text: 'Touche un compteur sur le plateau (à droite des lignes, sous les colonnes) et saisis ses points puis son nombre de Voltorbe, exactement comme sur le jeu. Le pavé enchaîne tout seul.', tone: 'neutral', key: 'empty' }
              : { title: `Encore ${20 - filledCount.value} valeur${20 - filledCount.value > 1 ? 's' : ''} à saisir`, text: 'Je résous dès que les 10 compteurs sont complets.', tone: 'neutral', key: 'partial' };
          case 'invalid':
            return a.errors.length > 1
              ? { title: 'Hmm, ça ne colle pas', text: 'Plusieurs compteurs se contredisent :', errors: a.errors, tone: 'error', key: 'invalid' }
              : { title: 'Hmm, ça ne colle pas', text: a.errors[0].message, tone: 'error', key: 'invalid' };
          case 'impossible':
            return { title: 'Aucune grille possible', text: a.errors[0].message, tone: 'error', key: 'impossible' };
          case 'lost':
            return { title: 'Boum ! Un Voltorbe…', text: 'La grille est perdue. Touche « Nouvelle grille » pour recopier la suivante, ou « Effacer les cartes » si c\'était une erreur de saisie.', tone: 'error', key: 'lost' };
          default: {
            const last = a.steps[a.steps.length - 1];
            return { title: last.title, text: last.text, tone: a.status, key: `${a.status}-${a.total}-${revealedCount.value}` };
          }
        }
      });
      const showGuesses = computed(() => atResult.value && status.value === 'guess' && analysis.value.guesses.length > 1);

      // ---------------- input: active field / cell ----------------
      const activeIndex = computed(() => {
        const a = active.value;
        if (!a || a.type !== 'field') return -1;
        return fieldOrder.findIndex((f) => f.line === a.line && f.index === a.index && f.part === a.part);
      });
      function clearPending() {
        pending.value = false;
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      const scrollToActive = () => UI.revealAboveSheet('.field.active, .card.active');
      function activateField(line, index, part) {
        clearPending();
        active.value = { type: 'field', line, index, part };
        scrollToActive();
      }
      function activateCell(r, c) {
        clearPending();
        active.value = { type: 'cell', r, c };
        scrollToActive();
      }
      function close() {
        clearPending();
        active.value = null;
      }
      function next() {
        clearPending();
        const i = activeIndex.value;
        if (i < 0) return;
        if (i < fieldOrder.length - 1) {
          active.value = { ...fieldOrder[i + 1] };
          scrollToActive();
        } else close();
      }
      function prev() {
        clearPending();
        const i = activeIndex.value;
        if (i > 0) {
          active.value = { ...fieldOrder[i - 1] };
          scrollToActive();
        }
      }
      function firstEmptyField() {
        return fieldOrder.find((f) => lines(f.line)[f.index][f.part] == null) || null;
      }
      function setField(f, value) {
        lines(f.line)[f.index][f.part] = value;
      }
      function setCell(r, c, v) {
        const was = state.revealed[r][c];
        state.revealed[r][c] = v;
        if (v != null && v >= 2 && was !== v) nextTick(() => UI.confettiAt(document.querySelectorAll('.card')[r * 5 + c], { particleCount: v === 3 ? 28 : 14, colors: ['#ffd60a', '#ffb703', '#ffffff'] }));
      }
      // Keypad press (also used by the keyboard handler)
      function press(value) {
        const a = active.value;
        if (!a) return;
        if (a.type === 'field') {
          setField(a, value);
          next();
        } else {
          setCell(a.r, a.c, value);
          close();
        }
      }
      function clearActive() {
        const a = active.value;
        if (!a) return;
        if (a.type === 'field') setField(a, null);
        else {
          setCell(a.r, a.c, null);
          close();
        }
      }
      // Typing a digit into the active field. Sums are 0–15, so a lone "1"
      // waits briefly for a second digit (10–15) before committing.
      function typeDigit(d) {
        const a = active.value;
        if (!a || a.type !== 'field') return;
        if (a.part === 'volt') {
          if (d <= 5) press(d);
          return;
        }
        if (pending.value) {
          if (d <= 5) press(10 + d);
          else {
            clearPending();
            next();
            typeDigit(d);
          }
          return;
        }
        if (d === 1) {
          setField(a, 1);
          pending.value = true;
          pendingTimer = setTimeout(() => {
            if (pending.value) next();
          }, PENDING_DELAY);
          return;
        }
        press(d);
      }
      // Single keyboard handler: the keypad owns the keys while a counter or a
      // card is active; otherwise plain buttons keep their native Enter/Space
      // and the arrows drive the step-by-step mode.
      function onKey(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const target = e.target instanceof Element ? e.target : null;
        const onControl = !!target && !!target.closest('button, summary, a, input, textarea, select');
        const ownedControl = !!target && !!target.closest('.sheet, .field, .card');
        const activation = e.key === 'Enter' || e.key === ' ';
        const a = active.value;
        if (!a) {
          if (activation && onControl) return; // let the focused button do its job
          if (e.key === 'Enter' && !complete.value) {
            const f = firstEmptyField();
            if (f) {
              activateField(f.line, f.index, f.part);
              e.preventDefault();
            }
            return;
          }
          stepper.onKey(e);
          return;
        }
        if (activation && onControl && !ownedControl) return; // e.g. "Nouvelle grille" while the keypad is open
        switch (e.key) {
          case 'Escape':
            close();
            return;
          case 'Tab':
          case 'Enter':
          case ' ':
          case 'ArrowRight':
          case 'ArrowDown':
            e.preventDefault();
            if (a.type === 'field') {
              if (e.shiftKey && e.key === 'Tab') prev();
              else next();
            } else close();
            return;
          case 'ArrowLeft':
          case 'ArrowUp':
            e.preventDefault();
            if (a.type === 'field') prev();
            return;
          case 'Backspace':
          case 'Delete':
            e.preventDefault();
            clearPending();
            clearActive();
            return;
          default:
            break;
        }
        if (a.type === 'cell') {
          if (e.key === '1' || e.key === '2' || e.key === '3') press(Number(e.key));
          else if (e.key === '0' || e.key.toLowerCase() === 'v') press(0);
          return;
        }
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          typeDigit(Number(e.key));
        }
      }

      // ---------------- keypad view model ----------------
      const keypadKind = computed(() => (active.value ? (active.value.type === 'cell' ? 'cell' : active.value.part) : 'sum'));
      const keypadTitle = computed(() => {
        const a = active.value;
        if (!a) return '';
        if (a.type === 'cell') return `Carte ${S.cellLabel(a.r, a.c)} : valeur retournée`;
        return `${S.lineLabel({ type: a.line, index: a.index })} · ${a.part === 'sum' ? 'points' : 'Voltorbe'}`;
      });
      const keypadHint = computed(() => {
        const a = active.value;
        if (!a) return '';
        if (a.type === 'cell') return 'Saisis ce que la carte a révélé dans le jeu.';
        return a.part === 'sum' ? 'Le total de points affiché en haut du compteur.' : 'Le nombre de Voltorbe affiché en bas du compteur.';
      });
      const keys = computed(() => {
        const a = active.value;
        if (!a) return [];
        if (a.type === 'cell') {
          return [
            { label: '1', value: 1, cls: 'v1' },
            { label: '2', value: 2, cls: 'v2' },
            { label: '3', value: 3, cls: 'v3' },
            { label: 'Voltorbe', value: 0, cls: 'volt', icon: true },
            { label: state.revealed[a.r][a.c] != null ? 'Remettre face cachée' : 'Annuler', cls: 'clear', action: clearActive },
          ];
        }
        const line = lines(a.line)[a.index];
        const out = [];
        if (a.part === 'sum') {
          for (let v = 0; v <= 15; v++) {
            let disabled = false;
            if (line.volt != null) {
              const nonVolt = 5 - line.volt;
              disabled = v < nonVolt || v > 3 * nonVolt;
            }
            out.push({ label: String(v), value: v, cls: '', disabled });
          }
        } else {
          for (let v = 0; v <= 5; v++) {
            let disabled = false;
            if (line.sum != null) {
              const nonVolt = 5 - v;
              disabled = line.sum < nonVolt || line.sum > 3 * nonVolt;
            }
            out.push({ label: String(v), value: v, cls: v === 0 ? '' : 'volt', icon: v > 0, disabled });
          }
        }
        return out;
      });

      // ---------------- board helpers ----------------
      const colorClass = (i) => COLOR_CLASS[i];
      function fieldText(line, index, part) {
        const v = lines(line)[index][part];
        if (v == null) return '–';
        return part === 'sum' ? String(v).padStart(2, '0') : String(v);
      }
      function fieldClass(line, index, part) {
        const a = active.value;
        const v = lines(line)[index][part];
        const isActive = !!a && a.type === 'field' && a.line === line && a.index === index && a.part === part;
        return { empty: v == null, active: isActive, pending: pending.value && isActive, error: errorFields.value.has(`${line}:${index}:${part}`) };
      }
      const isActiveCell = (r, c) => !!active.value && active.value.type === 'cell' && active.value.r === r && active.value.c === c;
      function cardClass(cell) {
        return [cell.kind, { revealed: cell.revealed != null, active: isActiveCell(cell.r, cell.c), recommended: cell.recommended, guess: cell.guess, 'in-line': cell.inLine, changed: cell.changed }];
      }
      function cardAria(cell) {
        if (cell.revealed != null) return `Carte ${cell.label}, retournée : ${cell.revealed === 0 ? 'Voltorbe' : cell.revealed}`;
        const parts = [`Carte ${cell.label}`];
        if (cell.kind === 'safe') parts.push('sûre');
        else if (cell.kind === 'volt') parts.push('Voltorbe certain');
        else if (cell.kind === 'one') parts.push('vaut 1, inutile');
        else if (cell.risk != null) parts.push(`${cell.risk} % de risque`);
        if (cell.recommended) parts.push('à retourner');
        if (cell.guess) parts.push('meilleur pari');
        return parts.join(', ');
      }
      const pct = (p) => `${Math.round(p * 100)} %`;
      const riskColor = (p) => `hsl(${Math.round(120 * (1 - Math.min(1, p * 1.6)))} 80% 60%)`;
      const stepIcons = { noVoltLeft: '🛡️', allVolts: '💣', allOnes: '1️⃣', allThrees: '3️⃣', bounds: '📏', mustBeSafe: '🔒', safe: '⚡', guess: '🎲' };

      // ---------------- actions ----------------
      function setMode(m) {
        state.mode = m;
        stepper.reset();
      }
      function snapshotForUndo() {
        undo.value = JSON.parse(JSON.stringify({ rows: state.rows, cols: state.cols, revealed: state.revealed }));
        if (undoTimer) clearTimeout(undoTimer);
        undoTimer = setTimeout(() => { undo.value = null; }, 10000);
      }
      function restoreUndo() {
        if (!undo.value) return;
        Object.assign(state, undo.value);
        undo.value = null;
        close();
      }
      function resetAll() {
        if (filledCount.value || revealedCount.value) snapshotForUndo();
        state.rows = emptyLines();
        state.cols = emptyLines();
        state.revealed = emptyGrid();
        activateField('row', 0, 'sum');
      }
      function resetCards() {
        state.revealed = emptyGrid();
        close();
      }
      function loadExample() {
        if (filledCount.value || revealedCount.value) snapshotForUndo();
        state.rows = linesFrom(EXAMPLE.rows);
        state.cols = linesFrom(EXAMPLE.cols);
        state.revealed = emptyGrid();
        close();
      }

      // ---------------- effects ----------------
      watch(status, (s, old) => {
        if (s === 'done' && old !== 'done' && old != null) UI.celebrate();
        // The keypad just closed on the 20th counter: on a phone the verdict sits below the board.
        if (old === 'incomplete' && (s === 'safe' || s === 'guess' || s === 'done') && UI.isMobile()) {
          nextTick(() => {
            const el = document.querySelector('.advice');
            if (el) el.scrollIntoView({ block: 'nearest', behavior: UI.reducedMotion() ? 'auto' : 'smooth' });
          });
        }
      });
      watch(() => [state.rows, state.cols, state.revealed], () => stepper.reset(), { deep: true });
      watch(state, () => UI.saveJSON(STORAGE_KEY, { rows: state.rows, cols: state.cols, revealed: state.revealed, mode: state.mode }), { deep: true });

      onMounted(() => {
        window.addEventListener('keydown', onKey);
        let hash = location.hash || '';
        try { hash = decodeURIComponent(hash); } catch (e) { /* keep raw */ }
        if (hash === '#exemple' || hash === '#example') {
          loadExample();
          if (hash === '#example') setMode('step');
          history.replaceState(null, '', location.pathname);
        } else if (filledCount.value === 0 && !UI.isMobile()) activateField('row', 0, 'sum');
      });
      onUnmounted(() => window.removeEventListener('keydown', onKey));

      // Small public hook for the browser console (and screenshots).
      window.voltorbe = { state, activateField, activateCell, close, press, setMode, loadExample, resetAll, stepNext: stepper.next, stepLast: stepper.last, stepFirst: stepper.first, analysis };

      return {
        COLS: S.COLS,
        state, active, undo, sparks, stepper,
        filledCount, complete, revealedCount, analysis, status, steps, stepIndex: idx, stepMode, stepLine, cells, advice, showGuesses, stepIcons,
        activeIndex, keypadKind, keypadTitle, keypadHint, keys,
        activateField, activateCell, close, next, prev, press, clearActive,
        colorClass, fieldText, fieldClass, isActiveCell, cardClass, cardAria, pct, riskColor,
        setMode, resetAll, resetCards, loadExample, restoreUndo,
      };
    },
  });
  UI.install(app).mount('#app');
})();
