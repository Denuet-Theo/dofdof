This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Database migrations

Schema changes live as timestamped SQL files in `supabase/migrations/`, applied via the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
(already a project dependency — invoke it with `npx supabase` or the `npm run db:*` scripts
below).

One-time setup, per environment you deploy to:

```bash
npm run db:link -- --project-ref <your-project-ref>
```

To apply pending migrations to that linked project:

```bash
npm run db:push
```

To create a new migration:

```bash
npm run db:migration:new <name>
```

This creates an empty `supabase/migrations/<timestamp>_<name>.sql` file — write the schema
change there, then `npm run db:push` it. Never hand-edit a migration that has already been
pushed to a shared environment; add a new one instead.

### Migrations on startup (Render)

`npm start` runs the `prestart` hook first, which applies any pending migrations via
`scripts/run-migrations.mjs` and then refreshes the DofusDB catalog mirror via
`scripts/sync-dofusdb.mjs --if-stale`, before `next start` serves traffic. Render runs the
app as a single long-lived process, so this happens once per deploy.

#### Render service configuration

The build and start phases must stay separate. Render sets `NODE_ENV=production` at
**runtime only**, and npm treats that as `--omit=dev` — so an `npm install` in the *Start
Command* prunes the devDependencies the build installed, deleting the Supabase CLI (and
`typescript`, and `tailwindcss`) from `node_modules`.

| Setting | Value |
| --- | --- |
| Build Command | `npm install && npm run build` |
| Start Command | `npm run start` |

Do not put `npm install` or `npm run build` in the Start Command. Use `&&` rather than `;`
so a failed step actually stops the deploy instead of continuing to the next one.

#### Environment

| Variable | Value |
| --- | --- |
| `SUPABASE_DB_URL` | Direct Postgres connection string from **Project Settings → Database → Connection string → URI** |

Notes:

- Use the **direct** connection (`db.<ref>.supabase.co:5432`), not the transaction-mode
  pooler — migrations run DDL in a transaction and the pooler will not handle it correctly.
- The password must be **percent-encoded** in the URI (the CLI requires this), so a `@` in
  the password becomes `%40`.
- This is a privileged credential and is deliberately separate from the app's own
  `NEXT_PUBLIC_SUPABASE_*` vars — those are an anon key and cannot run DDL. Keep it out of
  any `NEXT_PUBLIC_` variable, which would ship it to the browser.

Behaviour:

- **Unset `SUPABASE_DB_URL` on Render** (detected via Render's `RENDER=true`) — startup is
  aborted. A deployed service that skipped its migrations would otherwise look green while
  serving a stale schema, which is the worst possible outcome.
- **Unset `SUPABASE_DB_URL` locally** — migrations are skipped with a warning and the app
  boots, so a plain local `npm start` still works.
- **Migration fails** — startup is aborted with a non-zero exit, so the deploy fails rather
  than serving requests against an unexpected schema.

The script prints exactly one `[migrate] ...` line per boot, so the startup logs always say
which of these happened. No `[migrate]` line at all means the `prestart` hook never ran —
check that the Start Command goes through npm.

Migrations run *before* the catalog sync, so a migration that adds a column is always in
place before the sync tries to fill it.

To dry-run the same step locally without starting the server:

```bash
SUPABASE_DB_URL=<uri> npm run db:migrate
```

### DofusDB catalog mirror

Item, recipe and bestiary data comes from the public `api.dofusdb.fr`. Rather than proxying
every page load, the catalog is mirrored into our own Postgres — it only changes when the game
patches, and it is small (21 738 items, 4 858 recipes, 5 134 monsters, 23 133 drop rows,
~40 MB with indexes).

```bash
npm run db:sync       # full sync (needs SUPABASE_DB_URL)
npm run db:sync:dry   # fetch + map everything, touch no database
```

A cold sync takes about 12 seconds. `scripts/sync-dofusdb.mjs` pages the API 5 requests at a
time with retry and backoff, then swaps every table in **one transaction** via a temporary
staging table: if it dies partway, the previous mirror is untouched and the fix is to re-run
it. This requires the *direct* connection, not the pooler — a `TEMP` table does not survive
transaction-mode pooling.

Monsters are swapped before drops: `dofus_drops.monster_id` carries a foreign key, and
pruning a monster that upstream dropped cascades to its drop rows. `dofus_drops` is keyed on
`(monster_id, object_id, criterions)` rather than the first two alone — 518 rows out of 12 150
share a monster and an object while differing only by the quest state that gates them.

#### Farm targets

`farm_targets()` (migration `20260802210000`) ranks monsters by expected kamas per fight, by
joining the drop mirror to `item_prices`. It is served by `/api/dofusdb/farm`; every filter is
optional and its default lives in the SQL signature.

Prospecting does **not** scale drop rates proportionally. The multiplier is
`public.prospecting_multiplier(pp) = ((pp + 233) / 333) ^ 1.413`, which equals 1 at 100 PP —
the prospecting the stored base rate corresponds to. It is an empirical fit (migration
`20260802220000`), measured in game across 5 items, 4 monsters and base rates from 7.1 % to
60 %; all nine observations land within 0.16 percentage points. The proportional formula it
replaces was off by 33.9 points RMSE, and by +51 at 333 PP.

Three properties were each tested separately and hold: the effect is multiplicative on the
base rate, it does not depend on the monster (level 1 and level 200 monsters sharing a 10 %
base read identically), and the result is capped at 100 %.

Note the fit is anchored on four prospecting values between 140 and 333 — below 140 it
extrapolates. The two constants are not separately identified (a larger offset trades against
a larger exponent), but the whole valley of solutions agrees on the curve within 0.5 points
across the measured range.

Three caveats worth knowing before trusting the ranking:

- **Quest-gated drops are excluded by default.** They surface at 100 % and dominate the ranking
  while not being farmable in a loop: 17.6 % of drop rows carry a quest criterion, and those
  account for 43.2 % of every row showing 100 %. On a 300-monster sample the default drops
  Larve Bleue from 1 826 to 870 kamas by removing one quest object. Pass `excludeQuestDrops=0`
  to put them back.

  This is the *only* interpretation the function makes of `criterions`, and it is deliberately
  narrow — it matches `Q[aofsc][=!<>]` and nothing else. The mirror still stores the raw
  expression. The blunt alternative, `unconditionalOnly=1`, drops every conditional row: it is
  opt-in because 56.7 % of rows carry a non-quest condition (`PL` player level, `PO` a cap on
  copies already owned) that stays perfectly farmable. On the same sample it shrinks the pool
  from 276 monsters to 178, where the quest filter leaves all 276 standing.
- **Resistances are bounds across grades, not per-grade values.** They differ between grades for
  54.9 % of monsters, so each element is stored as a `_min`/`_max` pair. Negative values are
  vulnerabilities, which is what the `elements` + `maxResistance` filter is for.

It writes through `SUPABASE_DB_URL` rather than a service-role key. That variable already
exists for migrations and already carries more privilege than a service-role key would, so
adding one would be a second secret to rotate for no extra capability.

#### On startup

`prestart` runs `sync-dofusdb.mjs --if-stale` after the migrations. That mode reads
`dofus_sync_state` first and classifies the mirror:

| State | Meaning | On success | If the sync fails |
| --- | --- | --- | --- |
| **fresh** | synced less than `DOFUSDB_SYNC_MAX_AGE_HOURS` ago (default 168 h / 7 days) | skips in ~50 ms, one log line | — |
| **stale** | older than that | full sync, ~10 s | **boots anyway** with a warning |
| **cold** | table empty, or migrations have not run yet | full sync, ~10 s | **aborts startup on Render** |

The asymmetry is the point. A *stale* catalog is still perfectly usable, so blocking a deploy
because DofusDB is briefly unreachable would be worse than the outage itself. A *cold*
catalog makes every catalog-backed route fail, and a deploy that goes green in that state is
the worst possible outcome — the same reasoning as the migration step above.

So the steady-state cost is one indexed query on a two-row table per boot, and a real sync
runs at most once a week. It delays the new instance binding its port by ~10 s when it does
run; Render holds the old instance until then, so this delays cutover rather than causing
downtime.

| Variable | Default | Effect |
| --- | --- | --- |
| `DOFUSDB_SYNC_MAX_AGE_HOURS` | `168` | How old the mirror may get before a boot re-syncs it |
| `DOFUSDB_SYNC_ON_BOOT` | unset | Set to `0` to skip the boot sync entirely — an escape hatch if a DofusDB outage ever wedges a deploy. Does not affect an explicit `npm run db:sync`. |

**Weapons and cosmetics are out of scope, but nothing is filtered at ingest.** Weapons appear
as *ingredients* of in-scope recipes — «&nbsp;Quintaine&nbsp;» (`resultId 19644`, an *objet de
quête*) needs «&nbsp;Fléau d'armes&nbsp;» (`typeId 7`) — and the UI maps `recipe.ingredients`
into `recipe.quantities` **by array index**, so dropping one silently shifts every later
quantity and corrupts the craft cost. Instead each row carries `super_type_id`, and exclusion
is an opt-in filter at query time. (There is no cosmetic item type in this dataset at all.)

## Élevage

L'écran `/breeding` classe les 306 couleurs de monture (66 dragodindes, 120 muldos,
120 volkornes) par **marge horaire**, en arbitrant pour chacune entre **acheter**,
**capturer** et **élever**. Chaque couleur qu'on élève ouvre son plan complet, étape par
étape, avec un suivi de la progression.

### D'où viennent les arbres de croisement

Ils ne sont **pas** dans l'API DofusDB : `breedings`, `crossings` et `mount-crossings`
répondent tous 404, et `breeds` désigne les classes de personnage. Il n'existe pas de
source officielle interrogeable.

`scripts/extract-breeding-trees.mjs` les extrait donc de `dragodinde.fr` vers
`src/lib/dofus/breeding/trees.json`, puis les enrichit depuis DofusDB (certificats,
Optimakina, filets, ressource d'extraction). Le fichier est **versionné** : la source est
un asset de build dont le nom porte un hash de contenu, donc aucune URL n'est stable, et le
script repart de la page de guide pour y lire le nom du jour.

```bash
node scripts/extract-breeding-trees.mjs
```

Il refuse d'écrire si un arbre est incohérent : toute recette doit avoir exactement deux
parents, tout parent doit exister, et aucun parent ne peut être d'une génération ≥ à son
enfant — sans quoi le graphe aurait un cycle et la récursion de coût ne terminerait pas.

**Chaque recette porte une provenance**, `site` ou `game`. Les générations 9 et 10 sont à la
fois les plus rentables et les moins fiables : DofusDB ne les couvre pas et le site avait un
trou avéré (Aigue-marine listée avec une seule recette au lieu de cinq). Les quatre couleurs
de génération 9 des muldos ont été relues en jeu et corrigées ; le reste est marqué `site` et
signalé comme tel à l'écran. Conseiller un investissement de plusieurs millions de kamas sans
distinguer « je sais » de « je crois » serait malhonnête.

**Les certificats existent pour les 306 couleurs**, dans un type d'item par famille : 97
dragodinde, 207 volkorne, 332 muldo. L'endpoint `mounts` de DofusDB, lui, ignore les
générations 9–10 des muldos — chercher la monture plutôt que son certificat laisse croire à
tort que ces couleurs n'existent pas.

Les prix vivent en base plutôt que sur l'item, parce qu'une couleur se cote à **deux
niveaux** : un bébé naît niveau 1, donc l'élevage produit du niveau 0, et le prix niveau 200
n'est atteignable qu'en payant la montée.

### Le modèle de coût

`src/lib/dofus/breeding/costs.ts` remonte le DAG par génération croissante :

```
coût(c) = min( prix niveau 0, capture, meilleure recette )
```

Quatre points valent d'être connus avant de toucher au calcul :

- **Un croisement consomme ses deux parents**, définitivement stérilisés. L'élevage n'est pas
  une machine à multiplier des montures mais à transformer deux montures bon marché en une
  monture chère.
- **Le clonage recycle**, et pas d'un facteur uniforme. Deux stériles de même génération
  rendent une fertile, d'où `copiesToObtain(u) = ⌊u/2⌋ + 1` appliqué **par couleur pendant la
  propagation des multiplicités**. Un facteur ½ global rendrait un muldo Corail-Pourpre 29
  fois trop bon marché, parce qu'un singleton de haute génération n'a personne à qui
  s'appairer.
- **Une tentative ratée consomme ses parents sans rien produire.** Les multiplicités se
  propagent donc en `1/taux`, sans quoi tout l'amont est sous-compté — d'autant plus qu'on
  monte en génération.
- **Les coûts sont bornés à zéro avant d'être réinjectés.** Un croisement dont les génétons
  dépassent la dépense affiche un coût négatif, ce qui est exact ; le propager casserait
  l'optimisation, puisque diviser un négatif par le taux de réussite rend un *mauvais* taux
  préférable et ferait choisir des parents niveau 1.

### Les constantes de jeu, et leur origine

| Mécanique | Formule | Origine |
| --- | --- | --- |
| Réussite (génération) | `30 % + 0,15 % × (niveau A + niveau B)`, 90 % au plafond | guide, **vérifié au point près en jeu** |
| XP monture | `3,795 × niveau^2,329` points de Mangeoire | 5 relevés en jeu, écart max 0,0008 % |
| Transfert de jauge | 10/20/30/40 points par 10 s selon le palier | relevé en jeu, reproduit les 17h49 de vidange |
| Génétons | 1/2/4/8/15/30/60/120/250 par génération de parent | guide |
| Extraction | 1 ressource par génération, **rien en génération 1** | guide |
| Filets | 1/2/4/8 captures, **un filet = un combat** | relevé en jeu |
| Cycle de fécondité | 10 000 + 20 000 + 5 010 + 2 × 20 000 points | relevé en jeu |

Le taux de réussite dépend du niveau des **montures**, pas de celui de l'Éleveur — lequel ne
sert qu'à débloquer les enclos.

Ce taux porte sur la **génération**, pas sur la couleur, et la nuance n'est pas académique.
Relevé en jeu, deux parents niveau 69 croisant Doré (pur) × Pourpre (issu d'Ébène-Orchidée et
Indigo-Pourpre) :

| Issue | Génération | Probabilité |
| --- | --- | --- |
| Doré-Pourpre — la combinaison visée | 2 | 40,02 % |
| Indigo-Pourpre — grand-parent | 2 | 5,34 % |
| Ébène-Orchidée — grand-parent | 2 | 5,34 % |
| Doré — parent | 1 | 27,55 % |
| Pourpre — parent | 1 | 21,75 % |

Les trois couleurs de génération 2 totalisent **50,70 %**, soit exactement
`30 % + 0,15 % × 138`. La formule est juste au point près ; ce qu'elle ne dit pas, c'est que la
génération cible peut se présenter sous **plusieurs couleurs** quand un grand-parent s'y
trouve déjà.

Le calcul n'en souffre pas, mais pour une raison qu'il faut connaître : dans un plan propre,
chaque monture est élevée selon sa recette, donc les générations décroissent strictement en
remontant l'arbre et aucun grand-parent ne peut être de la génération visée. La situation
ci-dessus vient de ce que le Pourpre est lui-même un bébé hors cible, réutilisé comme parent —
il traîne une ascendance de génération **supérieure** à la sienne. Réemployer ses ratés, c'est
donc sortir du régime que `successRate` modélise.

Trois hypothèses ne sont pas vérifiées, et toutes trois sont signalées dans le code :

- **la progression est proportionnelle aux points transférés** — tout le modèle de durée en
  dépend ;
- **les deux dernières stats montent vraiment en parallèle**, ce qui raccourcit le cycle de
  20 000 points (5 h 33 au palier Extrait). Mesurable : un cycle complet doit prendre 15 h 17
  à ce palier, pas 20 h 50 ;
- **les poids de la répartition d'un bébé hors cible** (25 % chaque parent, 12,5 % chaque
  grand-parent) — mesurés faux, voir ci-dessous, mais pas encore remplacés.

### La couleur d'un bébé hors cible

Un accouplement produit toujours un bébé ; le taux ci-dessus porte sur sa génération. Sa
**portée** est établie : le jeu ne retient qu'un niveau d'ascendance par monture, même en
génération 3, donc un croisement ne peut rendre que les parents et les grands-parents. Le
parcours de `lineageValue` s'arrête au bon endroit.

Les **poids** (25 % chaque parent, 12,5 % chaque grand-parent) restent une hypothèse. Le relevé
ci-dessus ne les contraint pas : ses parents étaient de génération 1, si bien que les
grands-parents, de génération 2, tombaient du côté de la réussite. Sa masse d'échec ne
contenait que les deux parents, à 55,9 % et 44,1 %.

Pour trancher il faut un croisement dont les grands-parents sont d'une génération
**inférieure** à la cible, donc du côté de l'échec — le cas courant dans un plan propre, et
celui que le modèle décrit.

Limite de fond mise au jour par cette mesure : la répartition dépend de la généalogie de
l'**individu**, pas de la couleur. Deux muldos Pourpre n'ont pas la même distribution selon
d'où ils viennent. Le calcul raisonne sur des couleurs et approxime la lignée d'un parent par
sa recette ; il ne collera jamais exactement.

### Le temps, et pourquoi il classe mieux que la marge

Ce qui coûte du temps n'est pas le croisement — il est instantané — mais la **préparation de
ses deux parents** : les monter au niveau retenu, puis leur faire faire un cycle de fécondité.
Un accouplement raté ayant consommé ses parents autant qu'un réussi, le temps se compte sur
les *tentatives*, pas sur les bébés obtenus.

Deux effets rendent le calcul non trivial, et les ignorer fausse tout dans le même sens :

- **Les dix places d'un enclos se préparent ensemble.** Vingt parents coûtent deux fournées,
  pas dix fois deux parents. C'est ce qui rend les grosses séries proportionnellement plus
  rapides. Vrai pour **toutes** les jauges, Mangeoire comprise : monter dix montures d'un
  niveau coûte ce que coûte d'en monter une, d'où `mangeoireCostPerMountPoint`, qui est le prix
  d'un point d'XP *sur une monture* et vaut le dixième du prix d'un point de jauge. Confondre
  les deux surfacturait la montée d'un facteur dix et poussait l'optimiseur vers des parents
  niveau 5 là où le 26 était moins cher.
- **Montée et cycle ne s'additionnent pas.** Trois des quatre étapes du cycle n'occupent qu'un
  des deux emplacements de jauge, et la Mangeoire s'y glisse gratuitement. Elle ne rallonge la
  fournée que par ce qui dépasse — d'où `cycleFreeSlotHours`.

`planDuration` en tire `enclosHours` (le total, indépendant du parc) et `wallClockHours`
(le délai réel, jamais inférieur à la chaîne des générations : la gen 5 attend la gen 4).

Le classement par défaut est **la marge par heure d'enclos**, parce que c'est l'heure d'enclos
qui est rare. Trier sur la marge brute met les hautes générations en tête par construction :
elles rapportent plus parce qu'elles demandent plus de travail, pas parce qu'elles sont
meilleures. Une couleur qu'on achète ou capture ne mobilise aucun enclos et ne concourt donc
pas pour cette ressource — à marge positive elle passe devant tout le reste.

### Le niveau des parents dépend de l'objectif

`optimalParentLevel` minimise les **kamas** et ne voit pas les heures d'enclos. Ce n'est pas un
oubli qu'on puisse corriger par un plancher : le bon niveau change avec l'objectif.

Trois des quatre étapes du cycle ne mobilisent qu'un des deux emplacements de jauge, et la
Mangeoire tient dans l'autre. Leurs 35 010 points sont donc de l'XP **gratuite en durée** —
environ le niveau 50. Monter jusque-là ne rallonge aucune fournée et augmente le taux de
réussite, donc réduit les tentatives.

Mais ça reste payant en carburant, et les tentatives ne se convertissent en heures que par
fournées de dix : `ceil(2 × tentatives / 10)`. À un exemplaire on arrondit à la même fournée
dans les deux cas, et la montée est payée pour rien. Mesuré sur un muldo gen 4 :

| Objectif | Niveau bas | Seuil (niv 50) |
| --- | --- | --- |
| 1 | **+1 229 /h** | +484 /h |
| 30 | +11 944 /h | **+14 789 /h** |

D'où deux jeux d'estimations calculés en parallèle — l'un au moins cher en kamas, l'autre
planché au seuil — que `makePlan` départage sur la marge horaire, la même mesure que le
classement. Le régime gagnant se lit sur la ligne : le niveau des parents change avec
l'objectif, et c'est voulu.

### Combien on en veut change lequel on élève

L'objectif — un exemplaire pour un succès, trente pour rentabiliser — pilote **tout le
classement**, pas seulement le plan qu'on ouvre. Ce n'est pas un confort d'affichage : les dix
places d'un enclos se préparent ensemble et le clonage exige deux stériles de même génération,
si bien qu'à trente exemplaires le coût par monture s'effondre. Sur les données de test, un
muldo gen 4 passe de 1 229 à 11 944 kamas par heure d'enclos entre 1 et 30. Figer le calcul à
un seul exemplaire rendait invisible tout l'intérêt des séries.

### Suivre un plan

`breedingPlan` liste les montures de base à se procurer puis les croisements dans l'ordre.
`breeding_projects` retient la couleur visée et la quantité, et **rien d'autre** — ni les
étapes, ni leur état. Le reste à faire se recalcule de la cible moins l'écurie.

C'est la seule façon de tenir compte de l'aléa. Un croisement échoue deux fois sur trois en
début de partie, donc une liste d'étapes cochées une à une serait fausse dès le premier échec.
En déduisant l'écurie **avant** de remonter aux parents, une fournée chanceuse allège toute
l'ascendance et une fournée malchanceuse la remet au programme, sans rien de plus.

Le coût d'un plan est un **majorant** : il crédite les génétons, qui sont certains, mais pas
les bébés hors cible, dont la valeur dépend de l'hypothèse provisoire ci-dessus. Leur nombre
est affiché pour dire de combien le coût pourrait baisser.

### Les stocks

Trois réserves, qui servent la même chose — savoir ce qu'un plan demande **en plus** — par
trois chemins différents :

| Stock | Table | Ce qu'il change |
| --- | --- | --- |
| Montures | `user_breeding_mounts` | le plan lui-même : une couleur possédée n'est plus à produire, et toute son ascendance disparaît avec elle |
| Carburants | `user_item_stock` | ce qu'il faut débourser : les points sont déjà payés |
| Kamas | `user_breeding_settings.kamas_available` | rien au plan, mais décide de ce qui est réalisable |

Les montures sont rattachées **au joueur et non au projet** : un muldo Roux sert à des dizaines
de couleurs, et le posséder allège tous les plans qui en demandent. Les rattacher à un projet
obligeait à les ressaisir à chaque changement d'objectif, et deux projets concurrents auraient
compté deux fois les mêmes bêtes.

Les carburants se comptent en **points** et non en unités : une unité d'Élixir en vaut huit
d'Extrait, et un plan ne demande ni l'un ni l'autre mais des points à transférer. La réserve
est plafonnée à ce que le plan consomme — dix mille points d'Abreuvoir ne financent rien si le
plan n'en demande mille.

Le budget est une **contrainte**, pas un arbitrage : `planFunding` suit la dépense dans l'ordre
d'exécution, génétons déduits au passage, et signale la première étape que l'argent ne couvre
plus. Ce n'est pas le total qui bloque mais le point le plus tendu — et c'est là qu'il faut
vendre ou réduire l'objectif. À 0, aucune contrainte : un budget non renseigné ne veut pas dire
qu'on n'a rien.

Le bouton **« Optimiser »** choisit la couleur la plus rentable à l'heure d'enclos *parmi
celles qu'on peut financer*. Proposer un plan en sachant qu'il bloquera ne serait pas une
recommandation.

### Ce que le palier de jauge change

Les plafonds des carburants (40 000 / 70 000 / 90 000 / 100 000) tombent **exactement** sur
les paliers de transfert. Tenir une jauge à 4 pt/s exige donc le carburant de dernier palier,
fait de ressources plus rares.

Il n'y a par conséquent pas de règle générale : le débit rapide va jusqu'à quatre fois plus
vite mais se paie plus cher au point, et `bestFuelFor` tranche selon `kamas_per_hour`. Le
transfert n'est pas une perte — les points transférés sont exactement ce qui fait progresser
les montures — donc tenir une jauge basse ne fait rien économiser, cela ralentit.

### Réglages

`user_breeding_settings` est privée par utilisateur ; `breeding_color_prices` est partagée
comme `item_prices`, donc une saisie profite à toute l'équipe. `kamas_per_hour` vaut 0 par
défaut : le temps n'est valorisé que si le joueur le décide, parce que ce qu'il vaut dépend de
ce qu'il ferait à la place.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
