# Voltorbe Flip Solver

Solveur pour le mini-jeu **Voltorbe Flip** (HoloPocket / Pokémon HG-SS) : recopie les compteurs de la grille, le solveur te dit quelles cartes retourner sans risque, et quel est le pari le moins risqué quand il n'y en a plus.

Page statique, aucune dépendance à installer : ouvre `index.html` dans un navigateur (ça marche aussi hors-ligne et sur téléphone).

## Utilisation

1. Pour chaque ligne puis chaque colonne, saisis ses **points** et son nombre de **Voltorbe** (le pavé enchaîne automatiquement les 20 compteurs).
2. Les cartes **⚡ dorées** sont sûres : retourne-les dans le jeu. Sinon le **🎲** indique le pari le moins risqué, avec son pourcentage.
3. Après chaque carte retournée, touche-la dans le solveur et saisis sa valeur : l'analyse se met à jour.
4. Le mode **Pas à pas** déroule le raisonnement règle par règle (ligne sans Voltorbe, ligne de 1, bornes sur les valeurs, cartes indispensables à la somme…) puis l'énumération exacte des grilles compatibles.

Raccourcis clavier : chiffres pour saisir, `Tab`/`→` suivant, `←` précédent, `⌫` effacer, `Échap` fermer ; sur une carte `1` `2` `3` ou `V`. En mode pas à pas, `←`/`→`/`Espace` pour naviguer.

`index.html#exemple` charge la grille d'exemple ; `index.html#example` la charge en mode pas à pas.

## Structure

```
index.html        page (template Vue in-DOM)
css/style.css     thème électrique, animations
js/solver.js      logique pure : règles de déduction + énumération exacte (DP sur les colonnes)
js/app.js         app Vue : saisie, pavé, pas à pas, persistance localStorage
vendor/           Vue 3 et canvas-confetti vendorisés (pas de build, pas de réseau)
test/             tests du solveur (node --test)
```

## Tests

```
npm test        # ou : node --test test/
```

Les tests couvrent les règles de déduction, l'énumération (invariants sur des grilles aléatoires : la vraie grille est toujours possible, les marginales respectent les totaux) et la cohérence règles ↔ énumération (une règle n'élimine jamais une valeur qu'une grille compatible utilise).
