# HoloPocket Minigames — solveurs

Trois solveurs pour les mini-jeux de [HoloPocket](https://holopocket.app) : recopie la grille, le coffre ou la page du jour, lis le coup parfait, et comprends-le en mode **pas à pas**.

**En ligne : https://alexandrewavelet.github.io/holopocket-minigames/**

| Mini-jeu | Ce que fait le solveur |
| --- | --- |
| **Voltorbe Flip** (`voltorbe-flip/`) | Cartes sûres, risque de Voltorbe en % sur chaque carte, meilleur pari. Règles humaines explicables puis énumération exacte des grilles compatibles. |
| **Le Coffre** (`coffre/`) | Mastermind à 4 énergies : essai conseillé (minimise le pire cas, façon Knuth), carnet de ce qui est certain, code final avant le 8ᵉ essai. Énergies du jeu configurables. |
| **Les Voisins** (`voisins/`) | 9 cartes sur une page 3×3, deux voisines partagent un type, une génération ou une lignée. Saisie par autocomplétion du nom (Pokédex embarqué), disposition valide + ordre de pose en 9 coups. |

Pages statiques, aucune dépendance à installer : ouvre `index.html` dans un navigateur (ça marche hors-ligne et sur téléphone). Sur chaque solveur, `#exemple` charge un exemple ; `#example` le charge en mode pas à pas.

## Structure

```
index.html, home.css, home.js   page d'accueil
shared/css/base.css             tokens, bulle d'explication, liste d'étapes, bottom sheets, animations
shared/js/ui.js                 helpers (persistance, confetti) + composants Vue partagés + useStepper
voltorbe-flip/ coffre/ voisins/ un dossier par jeu : index.html, app.js (Vue), solver.js (logique pure), style.css
data/pokedex.js                 Pokédex FR (types, génération, lignée) généré par scripts/build-pokedex.js
vendor/                         Vue 3 et canvas-confetti vendorisés (pas de build, pas de réseau)
test/                           tests des trois solveurs (node --test)
```

Chaque `solver.js` est sans DOM, exposé en global dans le navigateur et en CommonJS pour les tests. Chaque solveur produit une liste d'« étapes » (titre, explication, cellules/lignes concernées) que l'UI rejoue en mode pas à pas.

## Développement

```
npm test                         # node --test test/
node scripts/build-pokedex.js    # régénère data/pokedex.js depuis les CSV PokéAPI
python3 -m http.server 8080      # optionnel, pour servir le dossier
```

Les tests couvrent les règles de déduction, l'énumération (invariants sur des grilles aléatoires : la vraie grille est toujours possible, les marginales respectent les totaux, aucune règle n'élimine une valeur réellement possible), le scoring Mastermind avec répétitions, les recommandations, et la validité des dispositions trouvées pour Les Voisins.

Déploiement : push sur `main` → GitHub Pages (racine du dépôt). L'ancienne adresse `voltorbe-flip-solver` redirige vers `holopocket-minigames/voltorbe-flip/`.

Projet perso, non affilié à HoloPocket ni à The Pokémon Company. Données Pokédex : [PokéAPI](https://pokeapi.co).
