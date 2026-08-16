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
