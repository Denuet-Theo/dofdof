---
name: ship-change
description: How to deliver a change in this repo end to end — branching, verifying, committing, opening the PR, and what to do when the maintainer asks for more afterwards. Encodes the branch-per-PR rule that keeps commits from landing in a merged PR and disappearing. Use whenever asked to implement something that will end up as a commit or a pull request, and before pushing anything.
---

# Shipping a change in dofdof

## The rule that this skill exists for

**Once a PR is announced, that branch is closed to new work.**

The maintainer merges fast — often within a minute of the PR being announced,
then deploys and screenshots the result. So the window between "here is the PR"
and "it is in `main`" is short, and anything pushed to that branch afterwards
lands in a merged PR and is silently lost.

This has happened three times. Each recovery costs a rebase, a fresh branch and
a new PR, and each time the maintainer sees work they asked for simply not
appear.

So: a follow-up request after a PR is announced starts a **new branch off
`main`**, never a push to the announced one. Even a one-line fix. Even if the
PR is "obviously" still open — checking costs a round trip and being wrong
costs a recovery.

Do not explain a lost commit as the maintainer having "merged while I was
pushing". They merged what existed; the extra commits came after. The mistake
is on this side.

## Fixing a bug means fixing its whole class

See the top of `AGENTS.md`. Restated here because it belongs to the sequence and
not to the reading: **step 2 is not "fix the bug", it is "fix every place that
bug can happen".**

Name the class, grep the class, fix every hit, and say in the PR body which hits
you found and which you deliberately left. If a shared mechanism can make the
class unrepresentable, build the mechanism instead of patching the sites.

The maintainer has been bitten by the same class four times — three local fixes
that each left the other call sites alone, and one that cost 22 mounts. A PR
that patches a single call site of a known class will be read as the fifth
report of the same bug.

## Sequence

1. **Branch off up-to-date `main`.** `git fetch origin && git checkout -b <name> origin/main`.
   Never work on `main`. If the previous work is not yet merged and the new work
   genuinely depends on it, stack — but expect the base to be squashed away and
   plan on rebasing (see Recovery).
2. **Implement.**
3. **Verify.** `npx tsc --noEmit` and `npx eslint src`. Three `<img>` warnings in
   `ItemPriceInput`, `ItemCard` and `KamasDisplay` are pre-existing — anything
   beyond those is yours.
4. **`npm run test:e2e`, green, before step 8 — every time.** ~25 s, no
   exception for a one-line or doc-only change. If the change fixes a bug, it
   also **adds the spec that fails without the fix**, proven red then green.
   See `AGENTS.md`; the two rules there are blocking, not advisory.
5. **Verify in the browser** for anything a user sees that the suite does not
   assert — layout, wording, a screenshot to read back. See the `browser-test`
   skill for driving it by hand. Read the screenshot; do not trust an exit code.
6. **Simulate, if you touched the breeding policy.** See below — this is not
   optional and none of the steps above covers it.
7. **Commit**, one commit per idea. Split before pushing if two ideas crept into
   one — `git reset --soft HEAD~1 && git reset` then stage in parts.
8. **Push and open the PR** — with the suite's result in the body: how many
   passed, how long, and for a bug fix, that the new spec was seen red without
   the fix. A PR body that does not say it should be read as one where the
   suite never ran.
9. **Stop touching that branch.**

If the suite is red or will not run, **stop and report it**. Do not open the PR
"so it can be looked at", do not narrow the run with `--grep` until it passes,
and do not skip or delete the failing spec. A suite that is allowed to be red
once stops being a signal.

## Measure before merging a policy change

`tsc` and `eslint` cannot see a wrong recommendation, and neither can a
screenshot — the screen renders a ranked list perfectly whether the ranking is
sound or nonsense. Only playing the policy shows it.

**If the diff touches `ladder.ts`, `policy.ts`, `search.ts`, `census.ts`,
`pairing.ts` or `cloning.ts`, measure before opening the PR** and put the
numbers in the body. Three harnesses, in rising cost:

| harness | cost | what it answers |
| --- | --- | --- |
| `node scripts/policy-report.mjs` | ~1 s | does the policy still mate at all, and what share of its crossings climb no rank |
| `node scripts/check-search.mjs` | ~10 s | does the TypeScript search still replay the Rust one, plan for plan |
| `rust/target/release/replay.exe <champion>` | ~1 min | what the policy is **worth**: 200 sealed seeds, full economy, against the greedy and the myopic baselines |

`replay` is the one that decides. It prints the median score, the gen 10 held,
and the same line for two baselines that are **never played in the app** and
exist only as yardsticks. A policy change that does not move those numbers did
not change the policy; one that moves them down is a regression however good the
reasoning looked.

The old `simulatePolicy` harness is gone with `simulate.ts`, `loadout.ts` and
`next-move.ts` — it measured a heuristic the app no longer runs. Its lesson
stands and is why this section exists:

| Defect | Found by |
| --- | --- |
| Crossings that can never reach their target (#76) | simulation |
| A greedy that never climbs (#78) | simulation |
| The missing-partner blocker (#80) | simulation |
| A finite penalty draining the stable (#83) | simulation |
| A champion hoarding fertility it should spend (#227) | `replay` sweep |

#83 is the cautionary one. #82 looked local — one penalty made finite so a badge
could show — and it took the climb from **85% to 10%** of runs reaching
generation 10. `tsc` was green, `eslint` was green, the browser rendered
correctly, and it shipped. It was caught a day later, by accident, while
measuring something else.

A change to what the policy prefers is never local.

## Recovery, when commits are stranded on a merged PR's branch

`main` squashes, so the branch's commits are not ancestors of `main` even
though their content is. Check tree equality first, then replay only what is
genuinely new:

```bash
git rev-parse origin/main^{tree}          # compare against the last
git rev-parse <last-merged-commit>^{tree} # commit that did land
git rebase --onto origin/main <last-merged-commit> <branch>
```

`git` drops anything already upstream by itself and says so. If the trees match,
the replay is lossless. Then a **new branch** and a **new PR** — the old PR
cannot be reopened once its base branch is deleted.

## Migrations

`npm start` runs them via `prestart`. Anything that drops or rewrites a column
changes existing data — say so in the PR body and in the reply, because the
maintainer deploys straight to a live database with real breeding data in it.

## Commit and PR style

- Commit subject and body in **English**, imperative, lowercase conventional
  prefix (`feat(breeding):`, `fix(farm):`).
- Body explains **why**, and what was measured. Numbers beat adjectives: "4 745
  where it owes 7 253, a 35% shortfall" says more than "fixed a costing bug".
- Every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **PR bodies in French** — the maintainer reads them, the commits are for the
  log. Tables for anything with more than two figures. End with the Claude Code
  footer.
- Code comments in French, and they explain the reasoning, not the mechanics.
  Match the density of the file you are in; this codebase comments heavily and
  argues for its choices.

## Reporting back

State what was verified and how. If something was inferred rather than
reproduced, say which. The maintainer knows the game far better than this side
does and has caught several wrong inferences — surface them as inferences so he
can correct them cheaply.

## Les mots-clés de fermeture GitHub échouent en silence

Deux issues d'affilée sont restées **OPEN** après le merge de la PR qui les
corrigeait, chaque fois pour une raison différente, et chaque fois ça donnait
l'impression que le travail n'avait pas atterri :

- **#179** — le corps disait « Ferme #179 ». GitHub ne reconnaît que les mots
  anglais : `Closes` / `Fixes` / `Resolves`.
- **#181** — le corps disait ``Ferme #181 — enfin, `Closes #181`, …``. Le mot-clé
  était dans un **span de code**, et GitHub n'y lit pas les fermetures.

Les corps de PR de ce dépôt sont en français par convention, donc **le premier
piège est structurel et reviendra**. Écrire `Closes #n` en clair, hors backticks,
et **vérifier l'état de l'issue après chaque merge** plutôt que de le supposer.
