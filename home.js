/* Home page: floating particles + 3D tilt / holographic shimmer following the pointer. */
(function () {
  'use strict';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // particles: bolts, coins and cards drifting up
  const host = document.getElementById('particles');
  if (host && !reduced) {
    const kinds = [['#bolt', '#ffd60a'], ['#coin', '#f5b301'], ['#card-ico', '#5be38a']];
    for (let i = 0; i < 14; i++) {
      const [sym, color] = kinds[i % kinds.length];
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      el.innerHTML = `<use href="${sym}"/>`;
      el.style.left = `${(i * 71) % 100}%`;
      el.style.color = color;
      el.style.setProperty('--dur', `${9 + ((i * 37) % 8)}s`);
      el.style.setProperty('--delay', `${-((i * 53) % 11)}s`);
      el.style.transform = `scale(${0.7 + ((i * 13) % 6) / 10})`;
      host.appendChild(el);
    }
  }

  // tilt: only for pointers that can hover (no tilt on touch)
  if (reduced || !window.matchMedia('(hover: hover)').matches) return;
  const MAX = 7;
  for (const card of document.querySelectorAll('[data-tilt]')) {
    const holo = card.querySelector('.holo');
    let frame = null;
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        card.style.transform = `rotateX(${(-py * MAX).toFixed(2)}deg) rotateY(${(px * MAX).toFixed(2)}deg) translateY(-4px)`;
        if (holo) {
          holo.style.setProperty('--hx', `${(px * 30).toFixed(1)}%`);
          holo.style.setProperty('--hy', `${(py * 30).toFixed(1)}%`);
        }
      });
    });
    card.addEventListener('pointerleave', () => {
      if (frame) cancelAnimationFrame(frame);
      card.style.transform = '';
      if (holo) {
        holo.style.removeProperty('--hx');
        holo.style.removeProperty('--hy');
      }
    });
  }
})();
