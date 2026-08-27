---
name: ecurie-en-jeu
description: How to read the real stable out of the Dofus élevage screen and reconcile it with what dofdof believes — the FILTRES census method, how a mount's state actually reads, the niveau-1/fertile invariant, and the import path. Use whenever the app's mounts disagree with the game, whenever asked to fix, re-enter, re-import or audit the écurie, and before trusting `user_breeding_individuals` as ground truth.
---

# Reading the real écurie out of the game

The app's mount table drifts from the game, and it drifts silently. Steriles get
recycled in game and stay in the base; a bad fournée writes cycles onto mounts
that never entered an enclos; a bulk level gets stamped on a batch that was
recalculated. **`user_breeding_individuals` is not ground truth.** The game is.

This skill is how you get the truth out of the game without asking the breeder to
photograph two hundred rows.

## The FILTRES panel is the census, not the list

The élevage screen has a filter panel on the left that shows an **exact count per
criterion**: TYPE, GÉNÉRATION (1→10), FERTILITÉ (fertile / féconde / stérile),
SEXE, COULEURS (one line per colour), plus a NIVEAUX range and a name search.
Combining filters re-counts everything.

Ask for those counts, not for the rows. Every subtotal is checkable against the
others, so a misread does not balance — which is exactly what reading rows off a
screenshot cannot give you. Useful moves:

- `anon` in the search box isolates the unnamed mounts (they are all called
  « Anonyme » in game).
- NIVEAUX narrowed to a single value splits a large list into blocks small enough
  to read row by row.
- A FERTILITÉ filter makes the state authoritative, so you never have to guess it
  from the row.

The ➡ button at the top right of the list does **not** export. It transfers to
the inventory. There is no copy-out; plan for screenshots.

## Finish name by name — aggregates hide compensating errors

On 2026-08-16 two missed corrections cancelled each other exactly: one féconde
too many on `G1 IN F DO-IN`, one too few on `G1 IN M DO-IN`. Totals, per-colour
counts *and* per-generation counts all came back green. Only the name-by-name
comparison caught it.

So: use the aggregates to find the shape of the problem, then **always** close
with a per-name, per-state diff.

## A wrong name moves no counter at all — 2026-08-22

Worse than a compensating pair, and it took a whole evening to find: a mount can
be **correctly counted under the wrong name**. On 2026-08-22 a batch asked for
`G3 AM M AM-EB`; the breeder could not find it in game, and the census had just
declared the stable clean. It was clean, by the counts — the mount was there,
same colour, same sex, same generation, same fertility, same level. The game
carried it as `G4 AM M AM-EB`.

Two things follow, and both are worth having in mind before spending an hour:

- **No column of the FILTRES panel can see this**, and no amount of cross-filtering
  will. A name is not a facet, so the four margins stay green.
- **The app cannot deduce it either.** Its 220 stored names all matched the name
  its own rule dictates — checked one by one. The app is only ever consistent
  with itself; the game's names are outside its knowledge.

The only instrument that sees it is the **name pass** — « Vérifier les noms » at
the end of the census. It cuts the stable by name prefix against the game's
écurie **search box**: `G1`, `G2`, `G3`…, then `G3 AM`, `G3 EBAM`…, four steps at
worst. It found this one in four questions.

Its floor, and it is real: a mount whose name the app has never seen has a line
in no column. The pass then reports the surplus one cut up — « G4 — the app
holds 41, the game 42 » — and closing it means putting the two lists side by
side, which is why both are sorted by name. Do not read that as a failure of the
search; it is the honest limit of counting things you cannot name.

When a name is wrong, prefer **renaming in game** over editing the app: the
dictated name is derived from colour, sex and ancestry, so the app's copy is the
one that is right by construction. Note the trap that produced this one — the
mating panel shows **VISE GEN. 4** right next to the name to copy, and the name
carries the *carried* generation, not the targeted one.

## Reading a single mount's state

`STÉRILE` replaces the gauges and is unmistakable. **Féconde versus fertile is
not readable from the gauge icons on a screenshot** — do not try, it has already
been got wrong. Use the FERTILITÉ filter.

The level is no shortcut either. A stable can hold 29 stériles and 27 fécondes
all at niveau 48.

## Niveau 1 ⟺ fertile

When the Mangeoire is set to **niveau 1** it grants 4 experience points per
enclos, and 19 are needed to reach niveau 2. Nothing levels up in an enclos, and
a foal is born niveau 1 fertile. So on 2026-08-16 the two sets were identical —
63 mounts each side.

**A fertile above niveau 1 in the base is therefore a write bug**, and that is a
free check. The converse does not hold: niveau 48 mixes fécondes and stériles.

This depends on the Mangeoire setting. Re-verify it before relying on it; the
plan label in `breeding_timeline` says which level is in use.

## A clone comes back at niveau 1 — confirmed in game, 2026-08-20

Cloning does not hand back an experienced mount. It hands back a **new** one
carrying the sacrificed mount's colour, sex, name and genealogy: gauges reset,
**and level reset**. The breeder confirmed it in game.

This was assumed the other way round and the assumption reached code.
`recordClonings` wrote `level: mount.level` — the consumed sterile's, typically
48 — and `afterClonings` spread the same. It is not decorative: the crossing
success rate is `0.3 + 0.0015 × (levelA + levelB)`, so two such mounts announced
44.4 % where the game gives 30.3 %.

Two consequences worth keeping:

- The invariant above **holds without exception**: every route into the fertile
  state lands on niveau 1. A fertile above niveau 1 is a write bug or a mount
  bought already levelled — the audit panel lists them.
- A clone is therefore **indistinguishable from a foal** in the base: same
  state, same level, same naming, no column separating them. A cloning entered
  wrongly cannot be found after the fact by any local rule. What is left is the
  census total, which a cloning lowers by one, and a cloning journal that does
  not exist.

## Getting the truth back into the app

The breeder has **no database access**. Everything is reachable from the UI:

- « Mes stocks » gives every mount an editable `niv` field, three state buttons
  (`fertile` / `féconde` / `stérile`) and a trash icon. Prefer editing in place —
  it preserves `parent_a_id` / `parent_b_id` and the history that a
  delete-and-reimport throws away.
- `BreedingImportMounts` reloads a whole stable from the game's name list. The
  name encodes colour, sex and both parents; level and state are free
  annotations anywhere on the line: `G3 AM M DO-DO 120 féconde`.
- Unnamed mounts have no identity to preserve, so they are the one block worth
  wiping wholesale: delete them all, then re-import with `EB M anon 48 féconde ×3`
  — gen 1 only, and féconde/stérile only, since a fertile gen 1 without ancestry
  belongs to the vrac counter.

When several mounts share a name they are **interchangeable in the model** —
same colour, same sex, same parent colours. Correct the head count, never try to
identify which individual is which. The breeder cannot tell them apart either.

## Two gaps against the game that are structural, not bugs

`BulkStock` and `user_breeding_mounts` only count **fertile head counts** per
colour and sex (`males`, `females`, `cycled_males`, `cycled_females`). There is
no column for a stérile, and none for a level. So:

- the app's **stérile** count only covers tracked individuals, and will always
  sit below the game's by everything the breeder has consumed in low generations
  — gen 1 lives in the vrac;
- a vrac line has **no level**, so it can neither enter nor leave a level range.

Faced with a count that disagrees with the game, check first whether it is about
stériles or a level range: if so this is the limit, and fixing it needs a
migration of `user_breeding_mounts`, not a hunt for a counting bug.

## What the 2026-08-16 reconciliation settled

The stable was rebuilt to match the game exactly: 198 mounts, 63 fertiles, 59
fécondes, 76 stériles, 34 anonymes, 164 nommées, verified name by name. It had
been at 255 with 57 phantom gen-1 anonymes.

**The levels were deliberately left wrong.** The error ran both ways — 19 mounts
too high by ~30 levels, 19 too low by ~37 — so it does not bias the stable, it
only adds noise to individual crossings
(`targetGenerationRate = 0.3 + 0.0015 × (levelA + levelB)` in `mating.ts`: 30.3 %
for two niveau 1 against 44.4 % for two niveau 48). The enclos-exit dialog asks
for levels again on every fournée, so the ones that matter self-correct. This is
a decision, not an oversight — do not reopen it. Concretely the app says 70
mounts at niveau 1 and 64 at niveau 48 where the game says 63 and 56.

## Deux pièges de la lecture en jeu

### Les relevés ne coûtent rien tant qu'on ne clique pas ACCOUPLER

Ouvrir la fenêtre d'accouplement affiche **toutes** les issues avec leurs
probabilités et leurs génétons **sans rien dépenser** — ni monture, ni fécondité.
Seul le bouton ACCOUPLER consomme. On peut donc promener une même monture devant
autant de partenaires qu'on veut.

J'ai d'abord conseillé de ne pas acheter une gen 10 pour un relevé, croyant
l'expérience coûteuse. Elle ne l'est pas : une monture achetée pour relever se
revend derrière, donc le coût réel est la **taxe HDV**, pas le prix. Le 14/08,
trois fenêtres ont suffi à résoudre la loi du sommet à 0,005 point près.

**Comment demander un relevé** : plusieurs fenêtres avec une monture
**constante** et des partenaires variés — c'est ce qui isole la variable. Et
demander la **généalogie et les niveaux**, sans quoi la fenêtre ne se rejoue pas.

### Un nom de monture n'identifie pas une monture

`mountName` fabrique le nom depuis la **couleur, le sexe et les parents** — rien
d'individuant. Plusieurs montures partagent donc un nom : sur l'export du 17/08,
`G1 IN F DO-IN` en désignait **six**, dont deux enfermées en enclos et donc
absentes de la liste d'écurie du jeu.

J'ai demandé à l'éleveur d'ouvrir une fenêtre sur « G1 IN F DO-IN ». Il a répondu
ne pas l'avoir et en a conclu qu'une écriture avait été perdue la veille —
fausse alerte, et de ma faute.

Le nom est la seule prise que la recherche d'écurie du jeu offre, ce qui le rend
tentant à traiter comme un identifiant. Il n'en est pas un. **Demander par
forme** — couleur, sexe, généalogie, niveau — et vérifier les enclos avant de
crier à la perte de données.
