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
4. **Verify in the browser** for anything a user sees. See the `browser-test`
   skill. Read the screenshot back; do not trust an exit code.
5. **Simulate, if you touched the breeding policy.** See below — this is not
   optional and it is not covered by the two steps above.
6. **Commit**, one commit per idea. Split before pushing if two ideas crept into
   one — `git reset --soft HEAD~1 && git reset` then stage in parts.
7. **Push and open the PR.**
8. **Stop touching that branch.**

## Simulate before merging a policy change

`tsc` and `eslint` cannot see a wrong recommendation, and neither can a
screenshot — the screen renders a ranked list perfectly whether the ranking is
sound or nonsense. Only running the policy shows it.

**If the diff touches `next-move.ts`, `pairing.ts`, `cloning.ts` or
`loadout.ts`, run `simulatePolicy` before opening the PR** and put the number
in the body. It costs about 200 ms for 20 runs.

```
npx tsc src/lib/dofus/breeding/simulate.ts src/lib/dofus/breeding/costs.ts \
  --outDir "$SCRATCH/lib" --module commonjs --target es2020 \
  --moduleResolution node --esModuleInterop --skipLibCheck
```

Then call `simulatePolicy` from a throwaway script: same seed, same crossing
budget, before and after. The figure that matters is **the share of runs
reaching generation 10**, and it must not drop.

Every defect ever found in that policy was found by running it, never by
rereading it:

| Defect | Found by |
| --- | --- |
| Crossings that can never reach their target (#76) | simulation |
| A greedy that never climbs (#78) | simulation |
| The missing-partner blocker (#80) | simulation |
| A finite penalty draining the stable (#83) | simulation |

#83 is the cautionary one. #82 looked local — one penalty made finite so a badge
could show — and it took the climb from **85% to 10%** of runs reaching
generation 10. `tsc` was green, `eslint` was green, the browser rendered
correctly, and it shipped. It was caught a day later, by accident, while
measuring something else.

A change to `scoreOf` is never local.

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
