# HoloPocket Minigames — solveurs

Cinq solveurs pour les mini-jeux de [HoloPocket](https://holopocket.app) : recopie ta partie, lis le coup à jouer, et comprends-le en mode **pas à pas** (sauf Connexions, qui donne directement les groupes).

**En ligne : https://alexandrewavelet.github.io/holopocket-minigames/**

| Mini-jeu | Ce que fait le solveur |
| --- | --- |
| **Voltorbe Flip** (`voltorbe-flip/`) | Cartes sûres, risque de Voltorbe en % sur chaque carte, meilleur pari. Règles humaines explicables puis énumération exacte des grilles compatibles. |
| **Le Coffre** (`coffre/`) | Mastermind à 4 énergies : l'essai conseillé est prérempli (minimise le pire cas, façon Knuth), tu saisis la réponse du coffre en deux taps, carnet de ce qui est certain. Énergies du jeu configurables en bas de page. |
| **Les Voisins** (`voisins/`) | 9 cartes sur une page 3×3, deux voisines partagent un type, une génération ou une lignée. Saisie par autocomplétion du nom (Pokédex embarqué), disposition valide + ordre de pose en 9 coups. |
| **Cartodle** (`cartodle/`) | Wordle de cartes TCG : chaque essai compare Pokémon (n° Pokédex), type, stade, PV, rareté, extension et illustrateur. Base de 18 668 cartes françaises (TCGdex), carte conseillée à chaque tour, carnet des contraintes. |
| **Connexions** (`connexions/`) | 16 Pokémon, 4 groupes de 4 : type, génération, place dans la famille, famille d'évolution, première lettre, longueur du nom, et les groupes « plus rares » (carte ex/GX/V/VMAX/VSTAR/Méga, 300 PV ou plus). |

Pages statiques, aucune dépendance à installer : ouvre `index.html` dans un navigateur (ça marche hors-ligne et sur téléphone). Sur chaque solveur, `#exemple` charge un exemple ; `#example` le charge en mode pas à pas.

## Tester en local

```
python3 -m http.server 8080      # puis http://localhost:8080/
```

(ou double-clic sur `index.html` : tout fonctionne aussi en `file://`). Sur téléphone, sers le dossier depuis le Mac et ouvre `http://<ip-du-mac>:8080/` sur le même Wi-Fi. Les sprites et vignettes de cartes sont chargés à la demande depuis PokéAPI / TCGdex ; sans réseau, les pages restent complètes (seules les images manquent).

## Structure

```
index.html, home.css            page d'accueil
assets/                         illustrations officielles (WebP) des cartes de l'accueil, voir assets/README.md
shared/css/base.css             tokens, bulle d'explication, liste d'étapes, bottom sheets, animations
shared/js/ui.js                 helpers (persistance, confetti) + composants Vue partagés + useStepper
voltorbe-flip/ coffre/ voisins/ un dossier par jeu : index.html, app.js (Vue), solver.js (logique pure), style.css
cartodle/ connexions/
data/pokedex.js                 Pokédex FR (types, génération, lignée, place dans la famille, drapeaux TCG) — scripts/build-pokedex.js
data/cards.js                   cartes Pokémon françaises (n° Pokédex, type, stade, PV, rareté, extension, illustrateur) — scripts/build-cards.js
vendor/                         Vue 3 et canvas-confetti vendorisés (pas de build, pas de réseau)
test/                           tests des cinq solveurs (node --test)
```

Chaque `solver.js` est sans DOM, exposé en global dans le navigateur et en CommonJS pour les tests. Les solveurs à mode pas à pas produisent une liste d'« étapes » (titre, explication, cellules concernées) que l'UI rejoue.

## Développement

```
npm test                         # node --test test/
npm run build:cards              # régénère data/cards.js depuis TCGdex (réponses mises en cache dans .cache/)
npm run build:pokedex            # régénère data/pokedex.js depuis les CSV PokéAPI (lit data/cards.js pour les drapeaux TCG)
npm run build:data               # les deux, dans l'ordre
```

Les tests couvrent les règles de déduction, l'énumération (invariants sur des grilles aléatoires), le scoring Mastermind avec répétitions, les recommandations, la validité des dispositions des Voisins, la sémantique des indices Cartodle et la recherche des groupes de Connexions.

Déploiement : push sur `main` → GitHub Pages (racine du dépôt).

Projet perso, non affilié à HoloPocket ni à The Pokémon Company. Données : [PokéAPI](https://pokeapi.co) et [TCGdex](https://tcgdex.dev). Illustrations © Pokémon / Nintendo / Creatures / GAME FREAK.
