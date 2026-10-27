/* HoloPocket Minigames — shared UI helpers and Vue components (global build, no bundler). */
window.HoloUI = (function () {
  'use strict';
  const { ref, computed, watch, nextTick } = Vue;

  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isMobile = () => window.matchMedia('(max-width: 899px)').matches;
  const canHover = () => window.matchMedia('(hover: hover)').matches;
  const scrollBehavior = () => (reducedMotion() ? 'auto' : 'smooth');

  // ---- persistence (localStorage may be unavailable: private mode, quota…) ----
  function loadJSON(key, validate) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return validate ? validate(value) : value;
    } catch (e) {
      return null;
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* the app works without persistence */
    }
  }

  // ---- confetti wrappers ----
  function confettiAt(el, opts) {
    if (reducedMotion() || typeof confetti !== 'function' || !el) return;
    const rect = el.getBoundingClientRect();
    confetti({
      particleCount: 18,
      spread: 60,
      startVelocity: 22,
      gravity: 1.1,
      ticks: 90,
      scalar: 0.8,
      disableForReducedMotion: true,
      ...opts,
      origin: { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight },
    });
  }
  function celebrate(colors) {
    if (reducedMotion() || typeof confetti !== 'function') return;
    const c = colors || ['#ffd60a', '#e8372c', '#ffffff', '#2fbf71'];
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: c, disableForReducedMotion: true });
    setTimeout(() => confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0 }, colors: c }), 250);
    setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1 }, colors: c }), 400);
  }

  // Decorative particles: fixed pseudo-random layout computed once.
  function sparks(n) {
    return Array.from({ length: n }, (_, i) => ({
      id: i,
      style: { left: `${(i * 97) % 100}%`, '--dur': `${8 + ((i * 37) % 7)}s`, '--delay': `${-((i * 53) % 9)}s`, transform: `scale(${0.7 + ((i * 13) % 6) / 10})` },
    }));
  }

  // Scroll an element into view on phones when a bottom sheet would hide it.
  function revealAboveSheet(selector) {
    nextTick(() => {
      const el = document.querySelector(selector);
      if (!el || !isMobile()) return;
      const sheet = document.querySelector('.sheet');
      const limit = sheet ? sheet.getBoundingClientRect().top : window.innerHeight;
      const rect = el.getBoundingClientRect();
      if (rect.bottom > limit - 12 || rect.top < 0) el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    });
  }

  // ---- step-by-step state shared by every solver ----
  // stepsRef: Ref<Step[]>; enabledRef: Ref<boolean> (user picked "Pas à pas" and there is something to explain)
  function useStepper(stepsRef, enabledRef) {
    const stepIndex = ref(0);
    const hoverStep = ref(null);
    const pinnedStep = ref(null);
    const lastIndex = computed(() => stepsRef.value.length - 1);
    // stepIndex is reset after the inputs change; clamp so a shorter step list never indexes out of range in between
    const idx = computed(() => Math.max(0, Math.min(stepIndex.value, lastIndex.value)));
    const stepMode = computed(() => !!enabledRef.value && stepsRef.value.length > 0);
    const currentStep = computed(() => (stepMode.value ? stepsRef.value[idx.value] : null));
    const atResult = computed(() => !stepMode.value || idx.value === lastIndex.value);
    const peek = computed(() => hoverStep.value || pinnedStep.value);
    const highlightStep = computed(() => currentStep.value || peek.value);
    const next = () => { if (idx.value < lastIndex.value) stepIndex.value = idx.value + 1; };
    const prev = () => { if (idx.value > 0) stepIndex.value = idx.value - 1; };
    const first = () => { stepIndex.value = 0; };
    const last = () => { stepIndex.value = lastIndex.value; };
    const reset = () => { stepIndex.value = 0; hoverStep.value = null; pinnedStep.value = null; };
    function onSelect(step, i) {
      if (stepMode.value) stepIndex.value = i;
      else pinnedStep.value = pinnedStep.value === step ? null : step;
    }
    function onHover(step) {
      if (stepMode.value || !canHover()) return;
      hoverStep.value = step;
    }
    // Keyboard navigation; returns true when the key was consumed.
    function onKey(e) {
      if (!stepMode.value) return false;
      if (e.key === 'ArrowRight' || e.key === ' ') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'End') last();
      else if (e.key === 'Home') first();
      else return false;
      e.preventDefault();
      return true;
    }
    // keep the current step visible in the (desktop, scrollable) list
    watch(idx, () => {
      if (!stepMode.value || isMobile()) return;
      nextTick(() => {
        const el = document.querySelector('.steps li.current');
        if (el) el.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
      });
    });
    return { stepIndex, idx, lastIndex, stepMode, currentStep, atResult, peek, highlightStep, next, prev, first, last, reset, onSelect, onHover, onKey };
  }

  // ---- components ----
  const AdviceBubble = {
    props: {
      advice: { type: Object, required: true }, // { title, text, tone, key, errors? }
      stepMode: Boolean,
      stepIndex: { type: Number, default: 0 },
      stepCount: { type: Number, default: 0 },
      mascotClass: { type: [String, Object, Array], default: '' },
    },
    emits: ['first', 'prev', 'next', 'last'],
    template: `
      <div class="advice">
        <div class="mascot2" :class="mascotClass"><slot name="mascot"></slot></div>
        <div class="bubble" :class="advice.tone" :key="advice.key">
          <div class="bubble-head">
            <span class="kicker" v-if="stepMode">Étape {{ stepIndex + 1 }} / {{ stepCount }}</span>
            <h2>{{ advice.title }}</h2>
          </div>
          <p v-if="advice.text">{{ advice.text }}</p>
          <ul class="err-list" v-if="advice.errors && advice.errors.length > 1">
            <li v-for="e in advice.errors" :key="e.message">{{ e.message }}</li>
          </ul>
          <slot></slot>
          <div class="stepnav" v-if="stepMode">
            <button type="button" class="btn ghost sm" @click="$emit('first')" :disabled="stepIndex === 0" title="Première étape" aria-label="Première étape">⏮</button>
            <button type="button" class="btn ghost sm" @click="$emit('prev')" :disabled="stepIndex === 0" aria-label="Étape précédente">◀<span class="lbl"> Précédent</span></button>
            <button type="button" class="btn primary sm grow" @click="$emit('next')" :disabled="stepIndex >= stepCount - 1">{{ stepIndex === stepCount - 2 ? 'Résultat' : 'Suivant' }} ▶</button>
            <button type="button" class="btn ghost sm" @click="$emit('last')" :disabled="stepIndex >= stepCount - 1" title="Aller au résultat" aria-label="Aller au résultat">⏭</button>
          </div>
        </div>
      </div>`,
  };

  const DEFAULT_ICONS = { enum: '🧮', result: '⚡', done: '🏆', error: '⚠️', contradiction: '⚠️', info: '💡' };
  const StepsList = {
    props: {
      steps: { type: Array, required: true },
      stepMode: Boolean,
      stepIndex: { type: Number, default: 0 },
      peek: { type: Object, default: null },
      icons: { type: Object, default: () => ({}) },
    },
    emits: ['select', 'hover'],
    methods: {
      icon(s) {
        return this.icons[s.rule] || this.icons[s.kind] || DEFAULT_ICONS[s.rule] || DEFAULT_ICONS[s.kind] || '•';
      },
    },
    template: `
      <div class="steps" v-if="steps.length">
        <details :open="stepMode" class="steps-box">
          <summary>
            <span>{{ stepMode ? 'Toutes les étapes' : 'Pourquoi ? Voir le raisonnement' }}</span>
            <span class="count">{{ steps.length }}</span>
          </summary>
          <ol>
            <li v-for="(s, i) in steps" :key="i"
                :class="[s.kind, { current: stepMode ? i === stepIndex : peek === s, past: stepMode && i < stepIndex }]"
                @click="$emit('select', s, i)" @mouseenter="$emit('hover', s)" @mouseleave="$emit('hover', null)">
              <span class="n">{{ i + 1 }}</span>
              <span class="ic">{{ icon(s) }}</span>
              <span class="body">
                <span class="t">{{ s.title }}</span>
                <span class="d">{{ s.text }}</span>
              </span>
            </li>
          </ol>
        </details>
      </div>`,
  };

  function install(app) {
    app.component('advice-bubble', AdviceBubble);
    app.component('steps-list', StepsList);
    return app;
  }

  return { reducedMotion, isMobile, canHover, loadJSON, saveJSON, confettiAt, celebrate, sparks, revealAboveSheet, useStepper, install };
})();
