---
name: neat-training
description: How to run, resume, read and extend the NEAT search in `rust/` — the neuroevolution that finds the breeding policy instead of guessing it. Covers the three seed sets and why selecting on the wrong one voids the result, resuming from a checkpoint, reading the per-species table, retargeting the search at another mount family (dragodinde, volkorne), and changing the economy. Use whenever asked to train, resume, benchmark, replay a champion, or explain a number that came out of `breeding-neat`.
---

# Running the NEAT search

This exists because twelve PRs rewrote the same fifteen lines of guessed
heuristic (`scoreOf` in `next-move.ts`) without a way to tell whether any
version was better. The search replaces the guessing; the seed discipline below
is what makes its numbers mean anything. Break that discipline and you are back
to guessing, but with more decimals.

## Layout

- `rust/breeding-sim` — the simulator. Trees, lineage, pairing, the economy, the
  gauge schedule, the greedy baseline. No neuroevolution in here.
- `rust/breeding-neat` — the search itself (`src/neat.rs`, ~600 lines,
  hand-written) and the training loop (`src/main.rs`).
- `rust/economy.toml` — every price, hand-editable, commented.
- Written to `rust/` at the end of a run: `champion.json`, `finalists.json`,
  `checkpoint.json`.

## The rule this skill exists for: three seed sets, three jobs

| set | range | job |
|---|---|---|
| training | `0..800_000`, rotating each generation | fitness |
| run-off | `800_000..800_100` | choosing between finalists |
| sealed | `900_000..900_200` | the published number, opened once |

**Never select on the sealed seeds.** Not "just to check", not "only this
once" — the moment a candidate is chosen because it scored well there, the set
has been spent and no honest number remains. The run-off exists precisely so
that finalists can be compared without touching it.

**Training fitness is not a result.** It is the maximum of ~100 000 noisy
estimates, each averaged over a handful of games, so it selects luck as much as
quality. Measured on this project: a champion announced at 124,88 M scored
97,83 M on the run-off, and a finalist announced at 78,90 M scored 91,66 M — the
ordering itself inverts. Quote the run-off, or the sealed set at the very end.
Never the training curve.

Naming: this gap is the **winner's curse**, not overfitting. The seeds rotate,
so there is nothing to memorise. Calling it overfitting sends anyone reading it
looking for a regularisation problem that does not exist.

## Running it

Build once, then run the binary:

```sh
cd rust
cargo build --release -p breeding-neat
./target/release/breeding-neat.exe --minutes 60 --seeds 8 --iterations 800 --seed 1001
```

**Do not use `cargo run` for anything you intend to compare.** It rebuilds when
sources change, so editing a file while a comparison is between arms silently
swaps the binary under the measurement. This has destroyed two runs here. Build
once, run the frozen `.exe`, edit whatever you like meanwhile.

**Do not run anything else heavy at the same time.** The search saturates all
cores through rayon; a parallel benchmark changes the generations-per-hour and
makes two rounds incomparable.

| flag | default | notes |
|---|---|---|
| `--minutes` | 60 | wall clock, checked between generations |
| `--population` | 128 | |
| `--seeds` | 4 | games per genome per generation — the noise/cost dial |
| `--iterations` | 600 | hill-climbing steps per batch composition |
| `--seed` | 20260808 | drives which training seeds get drawn |
| `--resume` | — | path to a `checkpoint.json` |

The parser walks arguments in pairs, so every flag needs a value and a lone
trailing flag is silently dropped. There are no positional arguments.

## Resuming

`checkpoint.json` holds the population, the innovation registry, the speciation
threshold and the cumulative generation count.

The registry is saved whole rather than rebuilt from the genomes, and that is
not redundancy: nothing in a genome records **which link** was split to create a
given node, so `splits` would be lost and two lineages would stop recognising
the same structural mutation as the same innovation. Crossover would degrade
quietly, with nothing in the output to show for it.

```sh
./target/release/breeding-neat.exe --minutes 60 --resume checkpoint.json --seed 1002
```

**Change `--seed` on every resumed round.** Reusing it replays the same
sequence of training seeds, so the extra hour re-searches ground already
covered.

Archive each round before the next overwrites it — `cp champion.json
champion-r2.json`, same for the checkpoint. Without that you cannot say
afterwards where progress stopped.

## Reading the output

The per-species table is the useful one. The raw run-off ranking regularly
lists three near-clones of the winner, because it ranks individuals and a
successful genome fills the podium with copies of itself.

```
 espèce  départage bloc          libre          opti   crois.   clones   achats   gen10
      2    94.82 M 300000/48     122032/65         —      433      401      102    89.7
```

- `bloc` is unit 0, the five synchronised enclos; `libre` is unit 1, the enclos
  allowed to desynchronise.
- The six digits are gauge bands 0–3 in the order **Baffeur, Caresseur,
  Foudroyeur, Dragofesse, Abreuvoir, Mangeoire**, then `/` and the mount level.
  So `300000/48` is Baffeur at band 3, everything else at band 0, mounts levelled
  to 48.
- `opti` is the generation from which Optimakina is bought, `—` for never.
- The last four columns are behaviour averaged over 40 run-off seeds, not score.
  A score gap says one policy is better; only these say why.

**A `hist.` row is not a species.** It is the running champion, re-entered into
the run-off because the population may have lost it. If `hist.` wins the round,
the live population did **not** improve — a good genome appeared, was archived,
and was then dropped again. Report that distinction; the headline number alone
hides it.

The champion is kept on **training fitness**, so it inherits the winner's curse
it is meant to protect against: a genome with a higher training score replaces
one that was better on the run-off. Round 5 here archived a genome worth
104,46 M; round 6 replaced it with one scoring 116,06 M in training and 93,38 M
on the run-off. So `champion.json` is **not monotone**, and archiving each
round (`cp champion.json champion-r5.json`) is what makes the best artefact
recoverable afterwards. It travels in the checkpoint, so a resumed run keeps
it — before that fix, `hist.` silently meant "best of this hour".

## Replaying a champion

```sh
./target/release/replay.exe [path] [seed-start] [rank]
```

Defaults: `champion.json`, `900000`, rank 1. `finalists.json` is an array, so
the third argument picks which one. The second argument moves the seed window,
which is how to separate two explanations of a gap: replay on training-domain
seeds, and if the score is unchanged, the sealed set was not harder — the gap
was the winner's curse.

Careful when comparing a replay against a training run's own sealed-seed line:
`replay` uses `Searching::new`, which defaults to **1500** hill-climbing
iterations, while training uses whatever `--iterations` was passed. The same
champion measured 107,99 M at 800 iterations and 112,66 M at 1500 — the policy
keeps paying off with a larger search budget at play time, which is worth
knowing on its own, but it makes the two numbers non-comparable.

## Shipping a champion to the app

The app **runs the network**. `policy.ts` compiles `champion.json` and calls it
on every census the search proposes, so shipping a champion is copying one file
and re-running the guards:

```sh
cp rust/champion-e2.json src/lib/dofus/breeding/champion.json
node scripts/check-network.mjs      # the port evaluates it like Rust does
node scripts/check-search.mjs       # and composes the same plans
node scripts/policy-report.mjs      # it still mates, and what it aims at
rust/target/release/replay.exe src/lib/dofus/breeding/champion.json
```

`replay` is the number to quote. It plays 200 sealed seeds on the full economy
and prints the greedy and myopic baselines beside it — **both of which the app
never runs**; they exist so that "did it learn anything" has an answer.

The ribbon that used to read a pre-computed schedule is gone, and `plan.rs`,
`model-plans/`, `model-plan.ts`, `timeline.ts` and `check-plan.mjs` went with
it. Do not re-emit per-paddock plans: the screen composes its batch live, from
the breeder's own stable and prices, which is the whole point of running the
network in the browser.

## What the champion is trained on, and why that has been wrong

Two mismatches between the training environment and the app, both measured on
2026-08-18. Read them before trusting a new champion.

**The treadmill cannot teach the enclos.** `play_treadmill` calls the optimiser
with `capacity: 0` (`treadmill.rs:457`), and `random_action` only offers
`Action::Cycle` when `places < capacity`. So a champion trained there has never
been scored on "bank this mount rather than cross it" — and
`empty_place_genetons`, the lever the maintainer added to make banking
arbitrable, is dead code for the same reason: `applied.places` is always 0.
The app then runs that champion with capacity > 0. It hoarded: half a pen in
"à féconder sans croiser", and 44 fécondes held against 8 spent. Both were
patched app-side (#224, #227) rather than trained.

**Training does not apply the ladder.** The app passes
`SearchConfig.admissible` — `aimsAt` against the crowned ladder — so it only
ever plays crossings the ladder allows. Training passes nothing, so the champion
learns to choose in a **wider** space than the one it plays in, and part of what
it learned is unusable. Closing this means threading the ladder into
`Searching` in `main.rs`.

Until both are closed, a training round measures a game the app does not play.

## Retargeting at another mount family

`Catalog::load(path, family_id)` already takes the family. `muldo()`
(`trees.rs:335`) is just the hardcoded convenience, and outside tests it has
four call sites: `breeding-neat/src/main.rs:309`,
`breeding-neat/src/bin/replay.rs:125` and `:167`,
`breeding-sim/src/bin/bench.rs:59`. Add a `--family` option threading through
those rather than a second hardcoded helper.

**The sizes already hold.** dragodinde has 66 colours, muldo 120, volkorne 120,
against `MAX_COLORS = 128`; all three top out at generation 10, against
`MAX_GENERATION = 10`. `FEATURES` (75 today) counts by generation and not by colour,
so the encoding is identical across families and a genome is structurally
loadable from one to another.

**But do not port a champion — retrain.** The endgame it learned is not the
same shape: the muldo has 50 colours at generation 10 and 4 at generation 9,
the dragodinde 19 and 2. The frontier, the recipe readiness features and the
whole value of holding a top-generation mount differ accordingly.

Before trusting any number on a new family:

1. Regenerate the parity fixtures for it (`scripts/dump-parity-fixtures.ts`)
   and run `cargo test -p breeding-sim`. The shipped fixtures are muldo-only.
   This gate compares 29 126 outcomes at 1e-9 and it does fail when the port
   drifts — it was verified to fail under a perturbation of 1/90000.
2. Re-price `economy.toml`. The **extraction resource** price is already per
   family — `[valeurs.ressource_par_famille]`, the maintainer's relevés of
   25/08, resolved by `Prices::for_family` — and `bench`/`knobs` pick it up from
   their family argument. What is still muldo: the generation-10 price band, and
   the *width* of the resource band, scaled from the muldo thirty-day band
   because no other family has one. The geneton yields are **not** a per-family
   term: they are the same for every mount (maintainer, 25/08).
3. Re-run `--bin bench` for the new floor and the new greedy number to beat.

## Changing the economy

Edit `rust/economy.toml`, then re-run both gates:

```sh
cargo run --release -p breeding-sim --bin gauges   # 4^6 band combinations, exhaustively
cargo run --release -p breeding-sim --bin bench    # do-nothing floor, greedy, cost per game
```

`gauges` searches all 4 096 band combinations without heuristics, so it says
what the neuroevolution *should* find — which is the only way to judge whether
it got there.

One inconsistency to know about: `GENETONS_BY_GENERATION` lives in
`economy.rs:95`, not in the TOML. It is universal across families — only a game
patch would move it, and that is a code edit. Genetons drop **only on a
successful birth**, never on a failed one.

The one price that is **not** a single global: the extraction resource. Three
families, three items, three HDV quotes. `Prices::for_family(id)` resolves it
once from `[valeurs.ressource_par_famille]` and returns a plain `Economy`; a
family the file does not name pays the reference price and the binary says so out
loud. A price change there makes each family's published bench incomparable
separately — replay all three.

**Any new binary must read prices through `Prices::load_default()`.** A run was
once voided because a binary used `Economy::default()` instead: the levers were
inert and mount level bought success rate for free. `bench` and `replay` exit
rather than fall back to defaults, and anything new should do the same —
measuring against an economy other than the file's is worse than not measuring.

## The missing term: market depth

`Economy::value_of` and the census price **every** mount at its full market
price, however many of them are held — and a stérile counts as much as a
féconde. Market depth is not modelled at all, and it is the costliest thing
missing from the simulator.

So **any policy whose gain comes from accumulating copies of an expensive colour
is over-scored, and the score will not show it.** On 2026-08-14 the summit
duplication loop (PR #188) measured +43.18 M and 200 wins out of 200 — finishing
with **162 gen 10**. The maintainer, who plays the game, settled it in one
sentence: « non le marché n'absorbe pas ça ». The rule was right, the measurement
was right, the number was wrong. It ships disabled (`Summit::Hold`).

Before proposing to switch on a policy that produces in volume, look at how many
copies it ends up holding and **tell the maintainer** — he is the oracle on what
the HDV absorbs, not the bench. A `bin/bench` that explodes on an accumulating
policy is a signal to check, not a win. Reopening the question would mean
pricing the resale of the n-th copy.

## When something looks wrong

| symptom | cause |
|---|---|
| first generation takes minutes, not seconds | an inert policy burning the full search on empty batches; `IDLE_LIMIT` (`economy.rs:940`) is the guard |
| one species for hundreds of generations | compatibility threshold miscalibrated against the normalised distance; it adapts toward 10 species and should oscillate roughly 9–15 |
| champion scores exactly the do-nothing floor | disconnected network — `is_connected()` returns `NEG_INFINITY` rather than paying for the games |
| run-off far below training fitness | expected. Only worth acting on if the gap grows every round, which means the population has converged and the maximum is measuring luck |
| every species suddenly shares one strategy | the threshold reopened or collapsed; check the species count in the generation log before reading the table |
| generations per hour keeps falling across resumed rounds | topology bloat. Measured here: 11 nodes / 70 links at 297 generations/hour, 44 / 124 at 168 — the search loses half its budget to networks that are not earning it. Watch the topology printed with the champion |

## Four things that have each cost a training round

### The game that matters starts from generation 1

`economy.toml` seeds each game with 100 mounts over **generations 2 to 9**
(`generation_minimale_du_pool` / `maximale`). Confirmed by the breeder on
2026-08-21: that pool exists **to help, and to recover from a previous attempt**.
The game that matters starts from **generation 1**.

It reverses conclusions rather than shading them. Run-off seeds, under the ladder:

| policy | on the gen 2–9 pool | from gen 1 |
| --- | --- | --- |
| the shipped champion | 48,06 M | **22,18 M** |
| a champion trained on the pool | 55,93 M | 15,46 M |
| greedy | 65,11 M | 13,15 M |

**Greedy only looks unbeatable because it exploits the pool.** From gen 1 it loses
to everything, and a champion trained on the pool loses to the one it was meant to
replace. Two full training rounds went into optimising the wrong start.

### Two seeds in three collapse on the do-nothing floor

A gen 1 start gives the search almost **no gradient early**. Nothing a random
network does beats keeping the starting kamas in the bank, so unless an early
mutation stumbles onto a profitable crossing the population settles on doing
nothing and speciation never recovers.

Measured 2026-08-21/22, same tree, same regime, both new score terms at zero:

| seed | after ~3 minutes |
| --- | --- |
| 555 | pinned at 10,00 M, 111 generations, never leaves |
| 20260822 | pinned at 10,00 M, 974 generations, best ever 10,22 M |
| **20260821** | 10,29 → **15,28 M by generation 51**, then 78 M by 700 |

This was first blamed on `cout_par_croisement = 10_000` being punitive. That
diagnosis was **wrong**: isolating it with both terms at zero reproduced the same
collapse.

**The tell is the generation rate.** A dead round does ~36 generations a minute
because it is simulating a policy that does nothing; a working one does ~2. Best
still at 10,00 M after a hundred generations means dead. **Probe four minutes
before spending hours.**

### `replay`'s arguments mislead

`replay [path] [seed-start] [rank]`, and `--ladder` is matched by scanning **all**
arguments. Three ways it has returned a confident wrong answer:

- **`replay X --ladder on`** — `--ladder` lands in the seed-start slot, fails to
  parse, so the window silently falls back to the **sealed** set, and `on` becomes
  the rank.
- **`replay X 800000`** — no `--ladder`, so the champion is judged **outside** the
  ladder it trained under. Gave 55,93 M where the ladder gives 38,16 M, and
  reversed which champion looked better.
- Correct form: **`replay X 800000 1 --ladder`**.

Seed windows: `800000` run-off (selection), `900000` sealed (publish once, never
select), `700000` a free independent window for testing whether an ordering is
noise.

**The output columns are easy to misread**, and doing so invalidated a whole
bisection. `recherche / NEAT` occupies `$1 $2 $3`, so:

    $4 score   $6 crossings   $7 purchases   $8 sacrifices
    $9 clones  $10 gen10      $11 loads

### The horizon is a tractability knob, not a play budget

`heures = 300` was chosen only so the search would converge in reasonable
wall-clock time. **Never rank a real strategy on fitting inside it**, and never
present it to the breeder as a play budget — he plays about one fournée a day, so
his budget is in fournées (see AGENTS.md, "How the breeder actually plays").

What it costs the simulation anyway: from a gen 1 start, 300 h is just short of the
endgame, so everything built for the endgame is silently inert — the summit admits
gen 10 crossings, depth prices gen 10 sales, the project crown targets a gen 10,
and none of it ever fires.

| heures | gen 10 held |
| --- | --- |
| 300 (configured) | 0,0 |
| **334** | 0,1 — first appearance |
| 600 | **10,0** |
| 1500 | 97,0 |

**600 h is the useful figure**: first appearance is one game in ten, an event
rather than a strategy. 1500 h runs about three times slower — 0,6 generations a
minute against 2 — but it was never the disaster first reported: that verdict was
**a laptop suspending with the lid closed**. `systemd-inhibit --what=sleep:idle`
does not block the lid switch. Treat a run whose internal clock lags wall time as a
suspended machine, not a stalled simulator.
