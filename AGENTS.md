<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# What decides what

Four things get called "the policy" in this repo, and confusing them has cost
real work. This is the map.

**The ladder — `src/lib/dofus/breeding/ladder.ts` ≡ `rust/breeding-sim/src/ladder.rs`.**
The reference, and the only thing that exists on both sides by design. It builds
the plan (which colours, which recipes, which gen 1 blocks), crowns a generation
10 target, and answers the one question everything else asks it: **is this
crossing admissible** (`aimsAt`). `check-ladder.mjs` holds the rule,
`check-ladder-parity.mjs` holds the equality between the two ports. A change on
one side without the other is a bug, not a divergence.

**The champion — `champion.json` + `search.ts`/`census.ts`.**
A value function that scores a stable, and a hill climb that composes a batch and
asks it. It decides **which** of the admissible crossings to play, and nothing
else. It is an artefact of `rust/breeding-neat`, and it is only as good as the
environment it was scored in — see the `neat-training` skill for two measured
ways that environment has not matched the app.

**The measurement witnesses — `Greedy` and `Myopic`, in Rust only.**
They are yardsticks, printed by `bench` and `replay`. **They are never played by
the app**, and no TypeScript port of them exists. If a number quotes "glouton",
it is telling you what a reference player would have done, not what your screen
did. Deleting them would make "is the champion any good" unanswerable, which is
exactly how the shipped champion spent weeks scoring barely above doing nothing.

**The screen — everything under `src/components/breeding`.**
Pens, births, cloning advice, extraction, prices, gauges. It reads the plan; it
does not make one.

What is *not* here any more, and must not come back without a reason: a second
heuristic player (`next-move.ts`, `loadout.ts`, `simulate.ts`), a pre-computed
ribbon (`timeline.ts`, `model-plans/`, `plan.rs`) and their guards. They were
unreachable from the app while still being maintained and checked on every run —
guards protecting code nobody executed.

# A bug is never fixed in one place

**Before fixing a bug, grep for every other place the same mistake can be made,
and fix them all in the same change.** Not "note them for later", not "mention
them in the PR body" — fix them.

The reason is measured, not theoretical. Three separate silent-write-failure
fixes shipped as one-line local patches over three weeks. Each was correct.
Each left the other thirty call sites untouched, because nobody looked. The
fourth one cost 22 mounts: a batch of births failed to insert, the failure went
to `console.error`, the dialog closed announcing success, and it was found the
next day by comparing the game's stable count to the app's — 203 against 225.

So the fix is never the line that broke. It is:

1. **Name the class of the bug** in one sentence — "an error path that only
   logs", "an optimistic local write with no rollback", "a `.in()` on an id
   list that may hold fabricated ids".
2. **Grep the class, not the symptom.** `console.error` after a write,
   `setState` before an `await`, `Promise.all` mixing a write and its
   compensation. The symptom is one file; the class is usually twenty.
3. **Fix every hit, or say why not** — in the PR body, per exception.
4. **Make the class unrepresentable** where a mechanism can do it: one shared
   helper the call sites must go through beats thirty correct call sites that a
   thirty-first will not match. See `src/lib/errors/write-failures.ts`.

A PR that fixes one instance of a class the maintainer has already been bitten
by three times is not a fix, it is a fourth report of the same bug.

# Every bug fix ships with a test that fails without it

Not "write-path bugs". Not "the ones that look risky". **Every bug.** The two
that cost mounts both looked local, both were reviewed, and both passed `tsc`,
`eslint` and a browser screenshot. The judgement call about which bugs deserve
a test is exactly the judgement that failed, twice, so it is not a call to
make any more.

The test goes in `e2e/` whenever the bug is reachable by clicking — which is
almost always here. `npm run test:e2e`: Playwright, a real browser, a real Next
server, and a Supabase mocked at the network layer so a **specific write can be
refused at a specific moment**. That last part is the whole point; no test that
cannot fail an insert would have caught the 22 mounts.

**Prove it fails on the bug.** Reintroduce the defect, watch the spec go red,
put the fix back, watch it go green. State both results in the PR body. A suite
that stays green with the bug restored is decoration, and writing one is worse
than writing none — it buys confidence that is not there.

**Click twice.** The regression that followed the first fix only appears on the
*second* click, once the first write has changed the stable underneath. A spec
that exercises one click proves almost nothing about a batch of seventeen.

If a bug genuinely cannot be covered, **say so in the PR body, with the
reason**. That is a sentence the maintainer can argue with. Silence is not.

# The suite runs before the PR is opened, every time

`npm run test:e2e` green is a precondition of `gh pr create`, not a nice-to-have
after it. It costs about 25 seconds.

- **No exceptions for "doc-only" or "one line".** The cheapest change is exactly
  where the check gets skipped, and skipping it is free right up until it isn't.
- **Put the result in the PR body** — how many passed, how long. A PR that does
  not say the suite ran should be read as one where it did not.
- **A red or unrunnable suite blocks the PR.** Report what failed and stop; do
  not open it "so it can be looked at". Never `--grep` down to the tests that
  pass, and never delete or skip a failing spec to get green.
