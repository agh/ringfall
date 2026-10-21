---
type: spec
title: "Ringfall metrics: every number the playtest harness reports"
status: draft
authors: ["Ringfall hackathon team"]
created: 2026-10-21
---

# Ringfall metrics

> [Ringfall](../README.md) > [Specification](spec.md) > Metrics

This document defines every field that `runPlaytest()` and `summarize()`
in `src/core/playtest.ts` return, so a designer tuning against them and an
agent writing a gate on them read the same meaning. For each field it
gives the unit, how the number is computed, what a good value looks like
for Chapter 1 and why, and which story, issue, or test uses it. The
gameplay numbers quoted come from [design-doc.md](design-doc.md); the
floors come from `tests/unit/bot.test.ts`, the gate thresholds from
`tests/balance/gate.ts`, and
[evolution.md](evolution.md) records that two of those thresholds were
lowered when first written, so they are floors the harness must clear,
not targets it was tuned to.

## How the harness runs

`runPlaytest({ seed, profile, maxSeconds })` creates a game from the seed,
derives a simulation random source and a bot random source from it, and
steps the simulation at exactly 1/60 s while the status is `playing` and
the clock is below `maxSeconds`, which defaults to 600. The steady profile
is the default; the reckless profile never retreats. After every step the
harness tallies the events the step produced and samples the shield. A
run is deterministic for a seed: the first test in `tests/unit/bot.test.ts`
asserts that two runs of seed 11 are equal in every field.

## Per-run fields from runPlaytest

### outcome

A label with no unit, one of `won`, `dead`, or `timeout`. It is the final
`GameState.status`, except that a game still `playing` when the clock
reaches `maxSeconds` is reported as `timeout`. For Chapter 1 the steady
bot should reach `won` on most seeds and never `timeout`, because the demo
is meant to last five to ten minutes and a `timeout` at 600 seconds means
a wave the bot can neither clear nor lose. Issue #12 uses it to compute
the win rate.

### wavesCleared

A count of waves. On a win it equals `wave.number`, which is 8, the value
of `FINAL_WAVE`; otherwise it is `wave.number - 1`, so a run that dies or
times out during wave 3 reports 2. A good Chapter 1 value is 8 for the
steady profile on most seeds and at least 1 on every seed, which is story
S3's acceptance criterion: a first-time player must get the first kill and
the first clear before they are in danger. The second and third tests in
`tests/unit/bot.test.ts` use it.

### seconds

Simulation seconds, not wall-clock seconds. It is `GameState.time` when
the loop stops, advanced by 1/60 s per step. A full clear should land in
the five to ten minute band the specification promises, so 300 to 600 is
the healthy range for a won run and anything shorter means the waves are
too thin; the lower bound of the band is the sum of eight 3 s countdowns
and seven 2.5 s cleared pauses plus the fighting. Issue #12 reports its
mean.

### kills

A count of enemies killed, read from `GameState.kills`. The maximum in a
full clear is 68, which is the 52 skimmers and 16 striders in the
composition table of [design-doc.md](design-doc.md) summed over eight
waves. The second test runs eight seeds (200 to 207) for 150 seconds each
and requires at least five first-wave clears and at least 24 kills in
total. Story S3 uses it.

### score

Points, read from `GameState.score`. A skimmer is worth 100, a strider
300, and a wave bonus of 500 is added when a wave clears and again on the
final wave's victory, so a full clear scores 14,000 at most. The score is
also what `src/core/records.ts` keeps as a personal best in local storage.
No test asserts a score threshold; the end card and spec item 15 use it.

### shotsFired

A count of `shot` events. Each rifle round fired is one event whether or
not it hits. With 32 rounds in the magazine and 160 in reserve the bot
cannot exceed 192 shots with the rifle alone; weapon pickups bring their
own magazine and reserve, so a run with pickups can exceed it.
It is the denominator of accuracy.

### shotsHit

A count of `shot` events whose `hitEnemy` flag is true, meaning the
hitscan ray reached an enemy sphere before any cover box. A skimmer dies
in two hits of 20 damage against 40 health and a strider in six against
120, so a full clear needs at least 200 hits. It is the numerator of
accuracy.

### shieldBreaks

A count of `shieldBroken` events, each emitted when a hit takes the shield
from above zero to zero. For Chapter 1 the number should be small but not
zero on the steady profile, because the shield break is the whole thirty
second loop and a run with none never shows it; two skimmers in contact
strip a full shield in about four seconds, so a wave with no break means
the bot never let them close. The fourth test compares the mean across
profiles. Stories S5 and S6 use it.

### grenadesThrown

A count of `grenadeThrown` events. The player starts with 4 and nothing
refills them, so the field is between 0 and 4; a good steady run throws
all four, because the specification wants the re-engage with a grenade to
be part of every thirty second loop. Story S7 asks for the bot's grenade
accuracy to be reported, which this field alone does not give; a hit
count per grenade would need an event the step does not yet emit.

### damageTaken

Damage points summed from the `amount` of every `playerDamaged` event,
counting both shield and health damage. A run that ends in `won` has
taken at most 100 health plus whatever the shield absorbed across its
recharges, so this field has no fixed ceiling; it is read alongside
`shieldBreaks` to tell a run that was never touched from one that was
always behind cover. No test asserts it today.

### secondsShieldDown

Simulation seconds during which the shield was at or below zero, sampled
once per step by adding 1/60 s whenever `player.vitality.shield <= 0`
after the step. Because the recharge starts 4 seconds after the last hit
and runs at 35 points per second, the shortest possible shield-down
interval after a break is about 4 seconds plus the first fraction of
recharge, so a good run has roughly that many seconds per break and no
more; a much larger ratio means the bot kept taking hits while down.
Story S6 names this field as the playtest evidence that the rhythm holds,
although no threshold is asserted yet.

### waveClearTimes

An array of simulation seconds, one per cleared wave, each measured from
the `waveStarted` event of that wave to its `waveCleared` event. The
final wave emits `victory` rather than `waveCleared`, so a won run has at
most seven entries and the last wave's duration is not recorded; a gate on
wave 8 pacing would need that event added in `src/core/game.ts`. A good
Chapter 1 series rises gently with the composition table, which is what
the five named waves in issue #8 will reshape. Story S9 and issue #12 use
it, and the second and third tests assert at least one entry.

## Summary fields from summarize

`summarize(results)` folds a batch of runs, normally one per seed. The
`games` field is the batch size and the denominator of every mean; an
empty batch divides by one so that nothing is `NaN`.

### winRate

A fraction from 0 to 1: the number of runs whose outcome is `won` divided
by `games`. For Chapter 1 the steady profile should win on most seeds and
the reckless profile on fewer, since the reckless bot never retreats to
recharge; a win rate of 1 for both profiles would mean the shield loop is
not needed to win, and a win rate of 0 for the steady bot means the game
is unfair. Issue #12 makes this the headline number of the gate.

### meanWavesCleared

Waves, the arithmetic mean of `wavesCleared` across the batch. The third
test asserts at least 1 over six seeds from 100 to 105 with a 240 second
cap; a Chapter 1 target is close to 8 for the steady profile.

### meanSeconds

Simulation seconds, the mean of `seconds`. Read with `winRate`: a short
mean with a high win rate means the waves are too easy, and a short mean
with a low win rate means they are lethal. Issue #12 reports it.

### accuracy

A fraction from 0 to 1 computed over the whole batch as total `shotsHit`
divided by total `shotsFired`, not as the mean of per-run ratios, so a run
with many shots weighs more. The second test asserts the per-run ratio is
above 0.25 pooled over seeds 200 to 207, and [evolution.md](evolution.md) records that figure
as a lowered threshold rather than a tuned target. Since the bot aims with
bounded turn rate and jitter and the rifle's spread is 0.004 rad standing
and 0.012 rad moving, a steady bot that lands well under half its shots
suggests the enemies are smaller or faster than the aim model expects, as
happened when the harness was first written and the skimmer's low
collision sphere meant the bot had to aim down.

### meanShieldBreaks

Breaks per run, the mean of `shieldBreaks`. The fourth test asserts that
the two profiles differ in at least one of mean shield breaks, mean
seconds, or accuracy across seeds 21 to 24, with a 300 second cap, so that
the profiles are not degenerate; the
expected direction is that the reckless bot breaks more often.

### meanWaveClearTimes

An array of simulation seconds indexed by wave, where entry `i` is the
mean of `waveClearTimes[i]` over the runs that have an entry at that
index, and 0 where no run reached that wave. Its length is the longest
`waveClearTimes` in the batch, so it holds at most seven entries for the
reason given above. This is the series a designer reads to see the
escalation across the composition table.

## Human-session metrics not collected today

If the product ever had analytics, the three numbers worth having are the
time from Deploy to the first kill, which should sit inside the first
thirty seconds the specification calls the product; the time from Deploy
to the first shield break, which marks the first thirty second loop; and
the session length from Deploy to the overlay returning, which the five to
ten minute target would be judged against. None of them is collected.
[requirements.md](product/requirements.md) requires no network calls
after page load, no third-party scripts, and no analytics, and
[design-doc.md](design-doc.md) repeats that nothing leaves the device. The
only persistence is the personal bests in local storage, which never
leave the browser. Each of the three could be computed from the same event
timeline the bot produces, which is why they are defined here even though
no human session reports them.
