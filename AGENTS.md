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

**The batch — `ladder-policy.ts` ≡ `rust/breeding-sim/src/ladder.rs`'s
`LadderPolicy`.** Given the plan, it decides **which** of the admissible
crossings to play, plus the clonings, the purchases and the sacrifices that pay
for them. Rules, not a learned artefact. `check-ladder-policy.mjs` holds the
equality between the two ports, batch for batch.

**The other players — `Greedy`, `Myopic` and the champion, in Rust only.**
Yardsticks, printed by `bench`, `replay` and `table`. **None of them is played by
the app**, and no TypeScript port of any of them exists any more. If a number
quotes "glouton", it is telling you what a reference player would have done, not
what your screen did. Deleting them would make "is the ladder any good"
unanswerable, which is exactly how the shipped champion spent weeks scoring
barely above doing nothing.

The champion was in TypeScript until 27/08 — `champion.json`, `search.ts`,
`network.ts`, the 75-entry feature vector in `census.ts`, and four parity guards
that compared the two searches. It lost to the ladder on all three families, so
it left the app and stayed in Rust where it can still be measured against. Do not
port it back to answer "which crossing"; that question has an answer now.

**The screen — everything under `src/components/breeding`.**
Pens, births, cloning advice, extraction, prices, gauges. It reads the plan; it
does not make one.

What is *not* here any more, and must not come back without a reason: a second
heuristic player (`next-move.ts`, `loadout.ts`, `simulate.ts`), a pre-computed
ribbon (`timeline.ts`, `model-plans/`, `plan.rs`) and their guards. They were
unreachable from the app while still being maintained and checked on every run —
guards protecting code nobody executed.

# How the breeder actually plays

Two facts about the person using this app. Neither is derivable from the code,
both have been rediscovered the hard way, and both invert measurements when
ignored.

## One fournée per day — so measure in fournées, never in hours

He sleeps and he works. **The constraint is showing up, not clock time**, and he
runs roughly one fournée a day.

Everything follows from that:

- **Rank on value per fournée.** An enclos cycle that fits three fournées into a
  day buys nothing, because the third will not be played. Set budgets in
  fournées — `economy.toml`'s `mode = "fournees"`, or `table`'s positional count.
- **`LadderPolicy::tuned_for` under-levels by construction.** It maximises
  `count × (value − fuel)` where `count` is fournées-per-horizon — the term it
  trades against is *constant at one* for him, so the whole trade-off collapses.
  It answers 36 then 50.
- **The 300 h / 600 h horizons are a NEAT tractability parameter and nothing
  else.** Do not present one as a play budget, and do not re-derive one.

### The level: measure in fournées, and the cap is what makes that legal

The counterweight is that **levelling costs real days**, because a filling of the
Mangeoire is capped. Level 100 wants 172 668 points against 52 544 for level 60 —
3,3× — so at a 70 000 cap it needs three fillings, three visits, three days.

That worry has an answer now, and it is the opposite of what it looked like. The
cap does not make the fournée-mode sweep wrong; **it is what makes it right.**
Level 67 wants 67 942 points and level 68 wants 70 327, so at a 70 000 cap every
level `tunedLevel` can advise fits **one** filling — one visit, one day. On a
calendar all candidate levels therefore cost the same number of days, and counting
fournées *is* counting days. `pointsCap` already excludes everything above.

The two modes disagree, and only one of them is his calendar:

| mode | what bounds the run | level 50 vs 67, his stable |
| --- | --- | --- |
| `mode = "heures"` (`economy.toml`'s default) | simulated hours | 50 wins, because 67 plays **28** fournées to 50's **36** |
| fournée count (`table <famille> <n>`) | gestures | **67 wins**, at 30, 60, 100 and 150 fournées |

Hours mode charges the climb in *time*, so a higher level plays fewer batches on
the same horizon — measured at 480 h, level 36 plays 58 and level 120 plays 14, a
factor of four. That is a real effect in the simulator and a false one for him: he
plays one fournée a day whether the Mangeoire took two hours or twenty. **Never
compare levels on an hours budget.**

Measured in fournée mode on his export of 2026-08-27, 200 seeds, paired, kamas
cashed, **with the Mangeoire on band 1** — the band he actually fills, one filling
to 70 000:

| horizon | 36 | 50 | 60 | 67 |
| --- | --- | --- | --- | --- |
| 30 fournées | −1,34 M | **best** | −1,24 M | −2,71 M |
| 60 fournées | −5,42 M | **best** | −0,13 M | −1,37 M |
| 150 fournées | −7,72 M | **best** | −2,77 M | −11,58 M |

An earlier version of this table had level 67 winning at every horizon. It was
measured on band 0, where the climb is charged at the cheap fuel throughout — two
fillings and two visits for a level 67, which is not what he does. Pass
`--bande-mangeoire 0` to reproduce it; the ranking inverts, and 67 goes from worst
to best. **A level comparison is meaningless without saying which band it holds.**

**Settled on 2026-08-28, and the answer is 50 — but only after two wrong turns
that are worth keeping, because each looked like the end.**

*First turn.* `tunedLevel` subtracted `fuelCostPerCycle × 10`, the fuel of a full
enclos, from a revenue worth **one crossing** and a Mangeoire cost that levels
**two** parents. Five times too much, in the calculation's only subtraction, while
`costs.ts` had `fuelCostPerCycle * 2` all along. The net came out **negative at
every level**, so the advice ranked losses, not gains. Real defect, real fix.

*Second turn, and it was wrong.* With the net positive the peak looked flat — 0,4 %
between 50 and 67 — so a near-tie went to the higher level, on the grounds that the
bench prefers 67. Both halves of that reasoning were false, for one reason.

*What settles it: the gauges fill in slices, and nothing modelled that.* A fuel
only fills up to its own cap, so reaching 70 000 costs 40 000 points of band-0 fuel
plus 30 000 of band-1 — the breeder's own reading, 28/08: « je la remplis en une
fois : 40 000 points de niveau 0 et 30 000 points de niveau 1 ». The cost is
**convex**, and every price in this repo was linear:

| | level 50 (34 365 pts) | level 67 (67 942 pts) |
| --- | --- | --- |
| flat average, per enclos | 43 499 | 86 001 |
| in slices | 19 382 | 77 455 |
| overcharge | **55 %** | **10 %** |

A flat average therefore makes high levels artificially attractive — which is
exactly the direction the advice was wrong in. And the bench does the opposite
error: it charges the whole climb at band 0 — 38 200 an enclos at level 67, against
77 455 measured — so it undercharges precisely what it takes to prefer 50. Two
models wrong in opposite directions, both pointing at 67.

In slices, level 50 pays **54 743** an hour against **51 415** for 67 — 6,5 %, not
a tie. The near-tie rule was removed with it: a rule whose reason is dead is not
kept in case.

`layeredTransferCost` is the one door, and everything priced per enclos goes
through it. `mangeoireCostPerMountPoint` survives as an **average** — it divides
867 582 points, a dozen fillings, by their number — and must never be multiplied
by a level's points. Guard: `npm run check:tuned-level`.

**Resolved on 2026-08-28, and it changed the answer.** The bench charged the whole
climb at one band's price; `layered_gauge_cost` now slices the Mangeoire the way
the breeder fills it, and `table` holds band 1 by default instead of band 0. The
level ranking inverted — see the table above — and the bench now agrees with the
app, which advises 50.

**The slicing applies to the Mangeoire only, and that distinction is load-bearing.**
A cycle gauge held on band 2 means keeping it *above* 70 000 for the rate: you buy
high fuel continuously, so every point costs the held band's price. The Mangeoire
is filled from empty, once. Treating them alike broke
`payer_le_chemin_critique_seul_est_moins_cher` — on 5 628 points everything fits in
band 0, so choosing a band stopped costing anything and paying for the critical
path became free. The test was right.

**Two traps found on the way, both still there:**

- `[mangeoire] prix_par_point` is parsed into `Economy::mangeoire_per_point` and
  **never read by the simulation** — `schedule` uses `gauge_prices`, from
  `[carburant]`. Editing it to run a what-if silently changes nothing, and a
  measurement of "the sweep at his Mangeoire price" was published on that basis
  before the identical figures gave it away. Edit `[carburant] mangeoire` instead.
- The TypeScript slices **every** gauge, not just the Mangeoire — #305 shipped it
  that way, so `fuelPerCrossing` and the advised level currently undercharge the
  cycle. Aligning it is a separate change.

**`table`'s printed fournée count was a budget, not a measurement**, until
2026-08-27: it printed `economy.batches`, which only bounds the run in fournée
mode. Four horizons from 48 h to 2 160 h all announced "100 fournees" while the
crossings went from 90 to 3 660 — and that is what made the hours-mode level
ranking look like a comparison at equal effort. Guard:
`rust/breeding-neat/tests/loads_played.rs`.

## The margin is read month by month, and never as one batch times thirty

He asked for this three times before it was written down, which is why it is here
rather than in a commit message. **What he wants to know is the margin his stable
throws off month after month, with nothing liquidated.** Not a score, not a total
over an arbitrary horizon, not a rate extrapolated from one batch.

`encaisse` — `score − liquidation` — is the right column: it is cash that actually
passed through the till during the run. `score` is not, and neither is anything
from `--heures`, whose horizon is not months.

Measured on his export of 2026-08-27, level 50, Mangeoire band 1, 200 seeds:

| month | cumulative | **the month's margin** | gen 10 held |
| --- | --- | --- | --- |
| 1 | 23,31 M | 23,31 M | 3,2 |
| 2 | 50,13 M | **+26,82 M** | 8,9 |
| 3 | 77,16 M | **+27,03 M** | 2,7 |
| 4 | 86,04 M | **+8,88 M** | 2,3 |
| 5 | 98,78 M | **+12,74 M** | 2,8 |

Two things this table says that a total hides.

**Of month 1's 23,31 M, 11,93 M is cashed in the very first fournée** — the sale of
what the parc already holds, his three gen 10 and his unpaired steriles. Once. The
operation itself yields about 11,4 M that month while the pipeline fills. Any
figure that multiplies one batch by thirty inherits this and overstates.

**And it collapses at month 4**, from 27 M to 9 M with the same policy. Two causes,
separated by measurement:

- **The market runs dry, and it compounds.** Setting `baisse_par_vente = 0`:
  23,62 / 57,14 / 93,76 / 106,71 / 127,45 against 23,31 / 50,13 / 77,16 / 86,04 /
  98,78. That is −1 % at one month and **−22 % at five**. Measuring the decay on a
  single month says it is negligible, and that conclusion was published before the
  longer horizons contradicted it.
- **The pipeline delivers one wave.** The collapse survives with the decay off —
  36,62 then 12,95 — so it is not the market alone. His stable is converted into a
  single cohort of gen 10, sold, and the base is never replenished fast enough to
  build a second.

### Read the census on what a mount **carries**, not on its colour

The breeder had to point this out: the name carries the ancestry — `G4 DO M
DOAM-ROEB` is a **dore**, a gen 1 colour, born of two gen 4 — and it is the
ancestry that decides what a crossing can aim at. Counting colours files that
mount under gen 1, as raw material about to be bought again.

On his starting stable the two counts differ on **30 of 83 gen 1**: twelve carry
gen 3, six carry gen 4, one carries gen 10. `held_by_carried` exists so the census
prints both, and the gap is the diagnostic. At month 4, simulated:

| gen | by colour | **carried** | wanted |
| --- | --- | --- | --- |
| 1 | 39,0 | 16,8 | 0 |
| 2 | 17,9 | 17,2 | **80** |
| 3 | 9,4 | 6,9 | **40** |
| 8 | 8,9 | **14,3** | 8 |
| 9 | 1,8 | 2,8 | 4 |
| 10 | 2,3 | **13,6** | **0** |

Read by colour it says "40 idle gen 1 and 2,3 gen 10". Read by ancestry: **13,6
mounts carry gen 10**, gen 8 sits at 179 % of demand, gen 2 runs at a fifth.

**And the obvious conclusion from that is wrong.** "A fifth of the park is material
the plan has no use for, recycle it" was written here and measured the next hour:
sacrificing everything that carries the top generation without being it costs
23,30 / 75,01 / 84,85 / 97,96 against 23,31 / 77,16 / 86,04 / 98,78 — **−2,15 M at
month 3**, and never a gain.

Two reasons, both of which the breeder gave before the measurement did:

- **They sell for nothing.** Most carry gen 10 on a gen 1 *colour*, and `value_of`
  is zero below generation 2. `settle` skips them for that reason alone; forcing
  them out destroys them for 0.
- **A high ancestry is worth holding.** A gen 1 born of a gen 9 aims at gen 10 —
  that is #59, and it is why `pairAncestryGeneration` exists. Carrying the top
  generation makes a mount a **good partner**, not a spent one.

The rule about a spent gen 10 (below) is about mounts whose *colour* is gen 10 and
whose genealogy holds no gen 9. It does not extend to carriers, and reading the
census as if it did cost a wrong recommendation.

**It is not the tier ordering**, which was the natural suspect since `Ordering`
documents "the ladder underuses its base". Measured with `table --ordre` on his
stable: TopDown 86,04 M at 120 fournées, RoundRobin 85,77, BottomUp 71,85. Feeding
the base costs more than it returns at every horizon tried — though BottomUp is the
only one that does not collapse at month 4, which is what pointed at saturation
rather than starvation.

**And it is not which gen 1 get bought.** `Purchasing::RoundRobin` against the
default, same stable: 23,31 / 77,36 / 86,04 against 23,31 / 77,16 / 86,04. Two
tenths of a million at month 3 and nothing anywhere else.

**Buying *more* gen 1 is not available either, and that is the finding.** The
purchase loop stops on `places + 2 <= capacity`, and his park reads 60/60 — there
is no room to put them. What the base is short of is **places**, not kamas:

| park | month 1 | month 3 | month 4 | the month-4 margin |
| --- | --- | --- | --- | --- |
| 60 places — his | 23,31 M | 77,16 M | 86,04 M | **+8,88 M** |
| 90 places | 21,54 M | 86,49 M | 100,74 M | **+14,25 M** |
| 130 places | 25,91 M | 93,54 M | 116,68 M | **+23,14 M** |

Doubling the park roughly triples the fourth month. That is the lever, and it is
the one the app cannot pull — `enclos_count` is what the game gives him. It also
explains why BottomUp failed: it takes room from the top instead of adding room.

**What the screen shows is not this.** `earnings.ts` prices one batch and
multiplies by thirty, which lands near the good months (27 M) and about 70 % above
the five-month average. Its header says "a rate, not a forecast"; this table is
what the forecast actually looks like.

## A gen 10 without a gen 9 in its genealogy is spent — sell it even fertile

Gen 10 × gen 1 names another gen 10 (relevé du 14/08, issue #185), but **only
through the gen 9 tint the gen 10 carries in its genealogy**. That tint recombines
with the gen 1's colour; nothing names *(gen 10 + gen 1)* directly, because a
gen 10's recipe is always gen 9 + gen 1.

So a gen 10 born of a gen 1 and a gen 10 carries only gen 1 and gen 10 tints and
**can never produce another gen 10**. Its fertility is worth nothing, and
`Economy::value_of` at the summit ignores `fertile` — the price is identical. It
is inventory, not breeding stock.

The exact test is "no gen 1 partner makes this name a top-generation colour", not
the proxy "carries a gen 9": a gen 10 can carry a gen 9 whose recombinations still
name nothing.

Measured on his export of 2026-08-27 — 240 muldo, gen 1 to 6, then three gen 10,
**no gen 7, 8 or 9 at all**:

| monture | généalogie | peut relancer la boucle |
| --- | --- | --- |
| azur_indigo (g10, féconde) | indigo g1 + azur_turquoise g10 | non |
| azur_pourpre (g10, féconde) | doré g1 + azur_pourpre g10 | non |
| azur_turquoise (g10) | **azur g9** + pourpre g1 | oui, mais **stérile** |

His only gen-9-carrying summit is sterile, and cloning needs two steriles of the
same generation — he has one. **The summit loop therefore cannot start on his
parc**, and forcing it changes nothing: measured at −1,43 M, which is why the
implementation was written, ported, parity-covered and then deleted.

# Two things about the stable that are not in the schema

## The plan depends on **row order**, so the stable is canonicalised

`flatten` walks the stable in array order and the search breaks **strict value
ties** in the order it meets mounts. Two stables with identical content, ordered
differently, do not produce the same plan — measured on the 15/08 fixture:
**18 matings proposed in fixture order, 19 in id order**.

That is user-visible because the stable is read with `.order('id')` while every
local write **appends** — `recordBirths`, `recordClonings`, enclos exit, add,
remove, and the two rollbacks, six sites. A recorded foal sits at the tail until a
refresh puts it back at its uuid's place, so the list changes with no change in
content. That is mechanically the "I refresh and two new matings appear" report.

Canonicalised at `stablePlan`'s entry (`canonicalStable`), keyed on **content** —
colour, sex, fertile, cycled, level, ancestry — with the id only as a last
tiebreak, deliberately **not** on the id: projections carry fabricated ids
(`clone-a-venir:`, `naissance-a-venir:`) while real rows get a uuid, so an
id-keyed order placed the same animal differently in the projection and in
reality. Guard: `npm run check:plan-order`.

**The e2e mock had `order` in `NOT_A_FILTER`**, so it served fixture order while
the real server sorts, and no test in the repo could see any of this. A fake server
that ignores part of the query greens exactly what it was asked to watch.

## The écurie's 250 places are ergonomics, not a population cap

Storing a mount is **free and lossless** — gauges only move in an enclos — so the
inventory, havresac and coffre hold ten thousand more at no cost beyond the
tedium of finding one again. Never model overflow as a cap, and never as a reason
to clone. What it does cost is the **search**, which is why `prix_du_retrait`
exists as a score term rather than a constraint.

And "certificat" in this codebase means the **tradeable HDV item**, not storage.
Designing on the other reading has already produced two proposals that rested on
a mechanic that does not exist — ask before building on the vocabulary.

# The golden rule: the screen shows only what the base confirmed

Everything below is one sentence:

> **Never show, keep, or act on a state the database has not confirmed.**

It has three clauses, and each one has already cost mounts on its own.

**1. A write reports what it *changed*, not the absence of an error.**
PostgREST answers a filtered `update … in(…)` or `delete … eq(…)` with success
when it matches no row — zero rows changed is not an SQL error. On 23/08 six
enclos were taken out at level 44, six successes came back, and ten rows out of
sixty were written. Chain `.select()`, say how many rows you expected, and pass
the result to `touchedRows`.

**2. Anything put on screen ahead of the round trip comes back off if the base
refuses it.** The optimistic write is the right default here — the whole ranking
recomputes on every keystroke and waiting for the network would make typing
crawl — but it is only half a mechanism without its undo. `touchedRows` and
`revertOnFailure` both take a required `Undo`: a function, `'rien-posé-en-avance'`
when the screen shows nothing unconfirmed, or `'gardé-exprès'` with the reason
written next to it. There is no default. The question "what does the screen
already show that the base has not taken?" must be *asked* at every write; it
was answered "nothing" by omission about thirty times.

**3. A state you could not *read* is never treated as a known state.**
`useBreedingBatch` answered a failed read with `setPens([])`, so the screen fell
back to a live proposal and the next lock overwrote the row describing what the
enclos really held. Measured: one click replaced three real pens with five
recomputed ones. An unread state disables the writes that depend on it, and says
so.

`npm run check:writes` holds all three. It is not a style check — run against the
tree from before #271/#272 it reports thirteen silent writes, including the exact
line that swallowed a batch. Adding a write that skips the door fails it; the
only way through is to name the silence in its `ALLOWED` list, with a reason a
reviewer can argue with.

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
