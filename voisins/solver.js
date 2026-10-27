/*
 * Les Voisins solver — pure logic, no DOM.
 * Nine cards on a 3×3 binder page; two orthogonal neighbours must share a type,
 * their generation or their evolution line. Exposed as `VoisinsSolver` in the
 * browser and as a CommonJS module for tests.
 *
 * card = { name, form, types: string[], gen: number|null, lineage: string|null }
 * layout = array of 9 card indexes, row-major (cell 0 = top-left … cell 8 = bottom-right)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoisinsSolver = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const ADJ = [[1, 3], [0, 2, 4], [1, 5], [0, 4, 6], [1, 3, 5, 7], [2, 4, 8], [3, 7], [4, 6, 8], [5, 7]];
  const CORNERS = [0, 2, 6, 8];
  const cellKind = (cell) => (cell === 4 ? 'centre' : CORNERS.includes(cell) ? 'coin' : 'bord');
  const CELL_WORDS = ['en haut à gauche', 'en haut au milieu', 'en haut à droite', 'au milieu à gauche', 'au centre', 'au milieu à droite', 'en bas à gauche', 'en bas au milieu', 'en bas à droite'];

  const norm = (s) => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const cardName = (card, i) => {
    const n = (card.name || '').trim();
    if (!n) return `Carte ${i + 1}`;
    return card.form ? `${n} ${card.form}` : n;
  };
  const listFr = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}` : items.join(''));

  // Reasons two cards may sit next to each other (empty = they may not).
  function shared(a, b) {
    const reasons = [];
    for (const t of a.types || []) if ((b.types || []).includes(t)) reasons.push({ kind: 'type', value: t });
    if (a.gen != null && a.gen !== '' && b.gen != null && b.gen !== '' && Number(a.gen) === Number(b.gen)) reasons.push({ kind: 'gen', value: `Gén. ${Number(a.gen)}` });
    const la = norm(a.lineage);
    if (la && la === norm(b.lineage)) reasons.push({ kind: 'lineage', value: `lignée ${String(a.lineage).trim()}` });
    return reasons;
  }
  const reasonText = (reasons) =>
    listFr(reasons.map((r) => (r.kind === 'type' ? `le type ${r.value}` : r.kind === 'gen' ? `la ${r.value.replace('Gén.', 'génération')}` : `la ${r.value}`)));
  const isComplete = (card) => Array.isArray(card.types) && card.types.length > 0 && card.gen != null && card.gen !== '' && Number.isInteger(Number(card.gen));

  function buildGraph(cards) {
    const reasons = CELLS.map((i) => CELLS.map((j) => (i === j ? [] : shared(cards[i], cards[j]))));
    const degree = CELLS.map((i) => reasons[i].filter((r) => r.length > 0).length);
    const partners = CELLS.map((i) => CELLS.filter((j) => reasons[i][j].length > 0));
    return { reasons, degree, partners };
  }

  // Depth-first fill of the 9 cells in row-major order; each cell only needs to
  // agree with its left and top neighbours, already placed. Cards are tried
  // most-constrained first so the first solution reads naturally.
  function enumerate(graph, limit) {
    const order = CELLS.slice().sort((a, b) => graph.degree[a] - graph.degree[b] || a - b);
    const compat = (i, j) => graph.reasons[i][j].length > 0;
    const layout = new Array(9).fill(-1);
    const used = new Array(9).fill(false);
    const solutions = [];
    let count = 0;
    (function rec(cell) {
      if (cell === 9) {
        count++;
        if (solutions.length < limit) solutions.push(layout.slice());
        return;
      }
      for (const i of order) {
        if (used[i]) continue;
        if (cell % 3 > 0 && !compat(layout[cell - 1], i)) continue;
        if (cell >= 3 && !compat(layout[cell - 3], i)) continue;
        used[i] = true;
        layout[cell] = i;
        rec(cell + 1);
        used[i] = false;
        layout[cell] = -1;
      }
    })(0);
    return { count, solutions };
  }

  function analyze(cards, opts) {
    const limit = (opts && opts.limit) || 100;
    const solutionIndex = (opts && opts.solutionIndex) || 0;
    const base = { status: null, missing: [], graph: null, count: 0, solutions: [], layout: null, steps: [], isolated: [], centerCandidates: [] };
    if (!Array.isArray(cards) || cards.length !== 9) return { ...base, status: 'incomplete', missing: CELLS };
    const missing = CELLS.filter((i) => !isComplete(cards[i]));
    if (missing.length) return { ...base, status: 'incomplete', missing };

    const graph = buildGraph(cards);
    const name = (i) => cardName(cards[i], i);
    const steps = [];

    // --- 1. who can sit next to whom ---
    const byDegree = CELLS.slice().sort((a, b) => graph.degree[a] - graph.degree[b] || a - b);
    const tight = byDegree.filter((i) => graph.degree[i] <= 2);
    const top = byDegree[byDegree.length - 1];
    const describe = (i) => `${name(i)} (${graph.degree[i]} : ${listFr(graph.partners[i].map(name)) || 'aucune'})`;
    steps.push({
      kind: 'rule',
      rule: 'links',
      title: 'Points communs entre les cartes',
      text: `Deux cartes peuvent être voisines si elles partagent un type, une génération ou une lignée. ${
        tight.length ? `Les plus contraintes : ${listFr(tight.map(describe))}. ` : ''
      }La mieux connectée : ${name(top)} avec ${graph.degree[top]} partenaires.`,
      links: CELLS.map((i) => ({ card: i, partners: graph.partners[i].map((j) => ({ card: j, reasons: graph.reasons[i][j] })) })),
      cards: CELLS,
    });

    // --- 2. constraints from the number of partners ---
    const isolated = CELLS.filter((i) => graph.degree[i] < 2);
    if (isolated.length) {
      const who = isolated.map((i) => `${name(i)} (${graph.degree[i] === 0 ? 'aucun partenaire' : `un seul partenaire : ${name(graph.partners[i][0])}`})`);
      steps.push({
        kind: 'error',
        rule: 'isolated',
        title: 'Aucune disposition possible',
        text: `Chaque case de la page touche au moins 2 autres cases, donc chaque carte a besoin d'au moins 2 partenaires. ${listFr(who)} ${isolated.length > 1 ? "n'en ont pas assez" : "n'en a pas assez"} : vérifie ${isolated.length > 1 ? 'leurs' : 'ses'} types, génération et lignée.`,
        cards: isolated,
      });
      return { ...base, status: 'impossible', graph, steps, isolated };
    }
    const cornerCards = CELLS.filter((i) => graph.degree[i] === 2);
    if (cornerCards.length) {
      steps.push({
        kind: 'rule',
        rule: 'corners',
        title: `${cornerCards.length > 1 ? 'Cartes forcées dans un coin' : 'Carte forcée dans un coin'}`,
        text: listFr(cornerCards.map((i) => `${name(i)} n'a que 2 partenaires (${listFr(graph.partners[i].map(name))}) : elle doit occuper un coin, entre ces deux cartes`)) + '.',
        cards: cornerCards,
      });
    }
    const centerCandidates = CELLS.filter((i) => graph.degree[i] >= 4);
    const edgeOnly = CELLS.filter((i) => graph.degree[i] === 3);
    if (!centerCandidates.length) {
      steps.push({
        kind: 'error',
        rule: 'center',
        title: 'Aucune carte pour le centre',
        text: "La case centrale touche 4 cartes : il faut une carte avec au moins 4 partenaires, et aucune n'en a autant. Vérifie la saisie.",
        cards: CELLS,
      });
      return { ...base, status: 'impossible', graph, steps, isolated, centerCandidates };
    }
    steps.push({
      kind: 'rule',
      rule: 'center',
      title: 'Qui peut aller au centre ?',
      text: `La case centrale touche 4 cartes : ${centerCandidates.length === 1 ? `seule ${name(centerCandidates[0])} a` : `seules ${listFr(centerCandidates.map(name))} ont`} au moins 4 partenaires.${
        edgeOnly.length ? ` ${listFr(edgeOnly.map(name))} (3 partenaires) ${edgeOnly.length > 1 ? 'iront' : 'ira'} sur un bord ou dans un coin.` : ''
      }`,
      cards: centerCandidates,
    });

    // --- 3. search ---
    const { count, solutions } = enumerate(graph, limit);
    if (!count) {
      steps.push({
        kind: 'error',
        rule: 'nosolution',
        title: 'Aucune disposition possible',
        text: "Chaque carte a bien des partenaires, mais impossible d'enchaîner les 9 cartes sur la page en respectant tous les voisinages. Vérifie la saisie.",
        cards: CELLS,
      });
      return { ...base, status: 'impossible', graph, steps, isolated, centerCandidates };
    }
    const layout = solutions[Math.min(solutionIndex, solutions.length - 1)];

    // --- 4. placements, cell by cell ---
    for (const cell of CELLS) {
      const i = layout[cell];
      const links = ADJ[cell]
        .filter((n) => n < cell)
        .map((n) => ({ cell: n, card: layout[n], reasons: graph.reasons[i][layout[n]] }));
      const kind = cellKind(cell);
      let text;
      if (cell === 0) {
        text = `Je commence par ${name(i)} (${graph.degree[i]} partenaires${graph.degree[i] === Math.min(...graph.degree) ? ', la plus contrainte' : ''}) dans le coin ${CELL_WORDS[0]}.`;
      } else {
        text = `${name(i)} va ${CELL_WORDS[cell]} (case ${cell + 1}, ${kind}) : ${listFr(links.map((l) => `${reasonText(l.reasons)} avec ${name(l.card)} (case ${l.cell + 1})`))}.`;
      }
      steps.push({ kind: 'rule', rule: 'place', title: `Case ${cell + 1} : ${name(i)}`, text, cell, card: i, cellKind: kind, links, cards: [i] });
    }

    steps.push({
      kind: 'result',
      rule: 'solved',
      title: count > 1 ? `Disposition trouvée (${count.toLocaleString('fr-FR')} possibles)` : 'Disposition trouvée',
      text: `Pose les cartes dans l'ordre des cases 1 à 9 : ${layout.map((i, cell) => `${cell + 1}. ${name(i)}`).join(' · ')}. Chaque carte partage un point commun avec ses voisines : 9 coups suffisent.`,
      cards: CELLS,
    });

    return { ...base, status: 'solved', missing: [], graph, count, solutions, layout, steps, isolated, centerCandidates };
  }

  return { CELLS, ADJ, CORNERS, cellKind, shared, isComplete, buildGraph, enumerate, analyze, cardName, reasonText };
});
