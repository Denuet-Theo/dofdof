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

## Retargeting at another mount family

`Catalog::load(path, family_id)` already takes the family. `muldo()`
(`trees.rs:335`) is just the hardcoded convenience, and outside tests it has
four call sites: `breeding-neat/src/main.rs:309`,
`breeding-neat/src/bin/replay.rs:125` and `:167`,
`breeding-sim/src/bin/bench.rs:59`. Add a `--family` option threading through
those rather than a second hardcoded helper.

**The sizes already hold.** dragodinde has 66 colours, muldo 120, volkorne 120,
against `MAX_COLORS = 128`; all three top out at generation 10, against
`MAX_GENERATION = 10`. `FEATURES = 54` counts by generation and not by colour,
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
2. Re-price `economy.toml`. Amber per rank, the generation-10 price band and
   the geneton yields are all muldo values.
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
`economy.rs:95`, not in the TOML. If a family or a patch changes those yields,
it is a code edit. Genetons drop **only on a successful birth**, never on a
failed one.

**Any new binary must read prices through `Prices::load_default()`.** A run was
once voided because a binary used `Economy::default()` instead: the levers were
inert and mount level bought success rate for free. `bench` and `replay` exit
rather than fall back to defaults, and anything new should do the same —
measuring against an economy other than the file's is worse than not measuring.

## When something looks wrong

| symptom | cause |
|---|---|
| first generation takes minutes, not seconds | an inert policy burning the full search on empty batches; `IDLE_LIMIT` (`economy.rs:940`) is the guard |
| one species for hundreds of generations | compatibility threshold miscalibrated against the normalised distance; it adapts toward 10 species and should oscillate roughly 9–15 |
| champion scores exactly the do-nothing floor | disconnected network — `is_connected()` returns `NEG_INFINITY` rather than paying for the games |
| run-off far below training fitness | expected. Only worth acting on if the gap grows every round, which means the population has converged and the maximum is measuring luck |
| every species suddenly shares one strategy | the threshold reopened or collapsed; check the species count in the generation log before reading the table |
| generations per hour keeps falling across resumed rounds | topology bloat. Measured here: 11 nodes / 70 links at 297 generations/hour, 44 / 124 at 168 — the search loses half its budget to networks that are not earning it. Watch the topology printed with the champion |
