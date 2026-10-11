# utero 1c-a: Bass machines, buses, master, mixer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add the bass voices, the bus mixer and the master chain.
- **Bass:** SUB and MID BASS machines with per-step notes (a NOTE edit mode in the sequencer). MID can follow SUB's sequence (LINK), and SUB can bypass its bus FX (DIRECT).
- **Mixer:** 8 stereo buses with DJ filter, drive, fader and (quantized) mute, plus meters.
- **Master:** a chain of low cut, tilt, glue comp, saturation, level, and limiter or clip, with a LUFS meter.
- **UI:** a mixer row with all of it, every knob modulatable and macro-learnable.
- **Parked 1b bug:** removing a non-last macro target no longer clicks.

**Architecture:**
- **Generic parameters.** A `ParamBank` (smoothed normalised params mapped through a `ParamDesc` table) replaces `KickParams`. It serves every machine, every bus and the master.
- **Rows.** The engine addresses parameters by row: 0–12 tracks, 13–20 buses, 21 master. Modulation routes and macro targets use the same rows.
- **Signal flow.** Track voices feed their bus (fixed mapping). The buses feed the master, which writes stereo out. The snapshot grows to carry all 22 rows of effective values, the bus/master meters and the applied mute states.

**Tech Stack:** Rust 2021 (wasm32-unknown-unknown), Vite + React 19 + TypeScript, Tailwind v4 + shadcn/ui, Vitest + Testing Library (jsdom).

**Spec:** [docs/superpowers/specs/2026-10-11-utero-design.md](../specs/2026-10-11-utero-design.md). This plan covers:
- §9: SUB, MID (except FOLLOW, which waits for the chord system in sub-project 3)
- §10: bus chain without sends/THROW, and the master
- §4: the mixer row
- the 1b parked ruling on macro target slots

Plan **1c-b** follows with send A (reverb), send B (delay), THROW, the FX RTN bus input, and the SC.KICK and ENV.F modulators.

**Product rulings taken for this plan.** The spec is silent on these, or this plan narrows it:
1. **Notes:** each step carries an absolute MIDI note (default 41 = F2). Notes are chromatic for now; scale quantisation comes with the key/chord system.
2. **NOTE edit mode:** the sequencer gets a minimal TRIG/NOTE mode switch. In NOTE mode, ↑/↓ moves a step one semitone (⇧ = octave), as do the wheel and vertical drag. Steps of non-melodic tracks are inert. The full edit-mode set (PROB/COND/LOCK/…) stays in plan 1d.
3. **SUB DIRECT:** this bypasses the BASS bus filter and drive, but still follows the BASS fader and mute, so taking the bass out live always works.
4. **Envelopes:** SUB and MID use a short attack ramp (2 ms / 1 ms) instead of an instant jump, so retriggers never click. SUB restarts its phase (PHASE) only from silence.
5. **Bus routing:** the track → bus mapping is fixed: KICK·KCK2 → KICK, HH·OH → HATS, SNR·NOIS·SMPL → PERC, SUB·MID → BASS, LD1·LD2 → LEAD, PAD → PAD, ORN → ORN. Bus 7 is FX RTN, which is silent until 1c-b. Buses are stereo; voices are mono and centred for now.
6. **Fader law:** 0.8 = 0 dB, 1.0 ≈ +6 dB, 0 = silence (gain = (x / 0.8)^3.1).
7. **DJ filter:** below 0.48 it is a low-pass (20 kHz → 20 Hz), above 0.52 a high-pass (20 Hz → 20 kHz), and between them a bypass. The modes crossfade over 5 ms.
8. **Quantized mute:** when the global MUTE Q toggle is on and the transport is playing, a mute or unmute takes effect on the next bar. While stopped it is immediate.
9. **Master defaults:** gentle (COMP 0.2, SAT 0.1, ceiling −0.3 dB, limiter mode). The LUFS meter is short-term loudness with a ~1.5 s exponential window, using BS.1770 K-weighting coefficients for 48 kHz.
10. **Macro targets:** each target gets a stable engine slot (`slot` field), so removing one fades only that slot. This is the 1b parked finding.

## Global Constraints

- Audio: 48 kHz, Web Audio block = 128 frames. There is no allocation, lock or I/O inside `Engine::process`. Every parameter change is smoothed (spec §5).
- **Parameter order per sample, every row:** smoothed base norm → macro override → + Σ route amount × modulator output → clamp 0..1 → map (spec §8).
- **Rows:** 0–12 = tracks (KICK, KCK2, HH, OH, SNR, NOIS, SMPL, SUB, MID, LD1, LD2, PAD, ORN), 13–20 = buses (KICK, HATS, PERC, BASS, LEAD, PAD, ORN, FX), 21 = MASTER. `MOD_ROWS = 22` and `MOD_PARAMS = MAX_PARAMS = 24`. Rust and TS must agree.
- **Param tables, which Rust and TS must mirror in this exact order and with these default_norm values:**
  - SUB: OCT 0.5, PHASE 0, DRIVE 0.1, GLIDE 0, DECAY 0.6, DRIFT 0.2, LEVEL 0.8, ROUTE 0
  - MID: WAVE 0, DETUNE 0.3, FOLD 0, NOISE 0.05, DRIFT 0.2, OCT 0.5, GLIDE 0, LINK 0, CUTOFF 0.45, RES 0.3, ENV AMT 0.5, F.DECAY 0.4, DRIVE 0.2, KEYTRK 0.5, TYPE 0, LEVEL 0.7, A.DECAY 0.5
  - BUS: FLT 0.5, DRV 0, LEVEL 0.8
  - MASTER: COMP 0.2, ATK 0.6, REL 0.5, MIX 1, SAT 0.1, CURVE 0.5, TILT 0.5, LOW CUT 0, CEIL 0.975, MODE 0, LEVEL 0.8
- **Snapshot layout** (Rust `engine.rs` ↔ TS `snapshot.ts`):
  - tick at 0
  - playheads at 1 (13 values)
  - modulator outputs at 14 (16)
  - effective norms at 30 (22 rows × 24)
  - meters at 558: 8 × (peak, rms), then master peak L, peak R, LUFS, GR dB
  - applied mutes at 578 (8)
  - total 586
- UI: dark, accent `acc` = value/selection, `mod` = modulation, red = armed LEARN. Text meets WCAG AA (no `text-zinc-500`/`text-sky-700` for text; use ≥ zinc-400/sky-400). Every action works with mouse and keyboard, and every ARIA name is unique (spec §4, user CLAUDE.md).
- Commits: conventional, stage specific files, never `git add .`. End with `Co-Authored-By: <your model name> <noreply@anthropic.com>`.
- Commands: Rust `source "$HOME/.cargo/env" && …`; web `cd web && source ~/.nvm/nvm.sh && …`. Run `npm run wasm` after Rust changes before web tests. Component tests start with `// @vitest-environment jsdom`, call `afterEach(cleanup)`, and wrap direct store calls in `act()`.

## Review Focus

1. **Quantized mute while stopped:** it must apply immediately, never get stuck pending. Covered by Task 9 `quantized_mute_while_stopped_is_immediate`.
2. **SUB retriggered while sounding:** no click, no phase reset mid-cycle, no amplitude step. Covered by Task 5 `retrigger_while_sounding_does_not_click`.
3. **Fader at 0, or a modulated LEVEL pushed to 0:** gives exact silence and no NaN. Covered by Task 7 `fader_law` and `default_bus_is_transparent`.
4. **Stacked routes push every level up:** the output never exceeds the ceiling. Covered by Task 8 `limiter_holds_the_ceiling` and Task 9 `limiter_holds_the_ceiling_under_heavy_modulation`.
5. **Removing a non-last macro target:** only its own engine slot is cleared, with no shifting. Covered by Task 1 `removing a target clears only its own engine slot`.
6. **NOTE edits on a non-melodic track:** they are ignored, and no command is sent. Covered by Task 11 `setStepNote clamps and ignores non-melodic tracks` and Task 13 `kick steps ignore note edits`.

---

## File Structure

```
crates/core/src/params.rs        MODIFY  + ParamBank, MAX_PARAMS
crates/core/src/kick.rs          MODIFY  KickParams → ParamBank (kick_params)
crates/core/src/seq.rs           MODIFY  Step.note, Trig
crates/core/src/dsp.rs           MODIFY  + midi_to_hz, db helpers, Osc (polyBLEP), Svf (TPT), fold, Glide, OnePole, Biquad
crates/core/src/sub.rs           CREATE  SUB machine
crates/core/src/mid.rs           CREATE  MID BASS machine
crates/core/src/bus.rs           CREATE  Bus (DJ filter, drive, fader, mute, meters), fader_gain
crates/core/src/master.rs        CREATE  Master (low cut, tilt, comp, sat, level, limit/clip, LUFS)
crates/core/src/modulation.rs    MODIFY  MOD_TRACKS → MOD_ROWS = 22, MOD_PARAMS = 24
crates/core/src/engine.rs        MODIFY  machines, rows, buses, master, LINK/DIRECT, quantized mute, snapshot v3
crates/core/src/lib.rs           MODIFY  module list
crates/wasm/src/lib.rs           MODIFY  set_step note, set_bus_mute
web/src/state/types.ts           MODIFY  StepState.note, MacroTargetState.slot, BusState, MasterState, AppState fields
web/src/state/machines.ts        CREATE  UI mirrors of SUB/MID/BUS/MASTER params, MACHINES, rows, labels, noteName
web/src/state/store.ts           MODIFY  macro slots, rows, buses, master, mute, notes, edit mode
web/src/audio/{ops,exports,dispatch,snapshot}.ts  MODIFY
web/src/ui/Knob.tsx              MODIFY  size + ariaLabel props
web/src/ui/ParamKnob.tsx         CREATE  row/param-aware knob (learn, mods, markers, drop)
web/src/ui/VFader.tsx            CREATE  vertical fader (extracted from MacroFaders)
web/src/ui/MacroFaders.tsx       MODIFY  use VFader + paramLabel
web/src/ui/MachinePanel.tsx      REPLACE machine-table driven (KICK/SUB/MID)
web/src/ui/SequencerMatrix.tsx   REPLACE + TRIG/NOTE mode
web/src/ui/Mixer.tsx             CREATE  8 bus strips + master section
web/src/App.tsx                  MODIFY  mixer row
```

---

### Task 1: Stable engine slots for macro targets (store)

**Files:**
- Modify: `web/src/state/types.ts`, `web/src/state/store.ts`, `web/src/state/store.mod.test.ts`, `web/src/audio/dispatch.test.ts`

**Interfaces:**
- Produces: `MacroTargetState` gains `slot: number`, the engine target slot (0–15), which is stable for the target's lifetime.
  - A new target takes the lowest slot its macro is not using.
  - `removeMacroTarget(m, i)` removes array entry `i` and sends only `cmdClearMacroTarget(m, removed.slot)`.
  - `syncAll` and LEARN edits send `cmdSetMacroTarget(m, t.slot, t)`.
  - Array order stays the display order.

- [ ] **Step 1: Write the failing tests.** In `web/src/state/store.mod.test.ts` (inside `describe('macros and learn')`):
  - In `learn records endpoints without touching the base`, change the targets expectation to `[{ track: 0, param: 5, a: 0.1, b: 0.9, slot: 0 }]`.
  - In `a new target starts with both ends at the base`, change the expectation to `{ track: 1, param: 0, a: base, b: 0.7, slot: 0 }`.
  - Replace the whole test `removeMacroTarget shifts later targets and resends them` with these three tests:

```ts
  test('removing a target clears only its own engine slot', () => {
    const { store, sent } = fresh()
    store.armLearn(0, 'a')
    store.setParam(0, 1, 0.1)
    store.setParam(0, 2, 0.2)
    store.setParam(0, 3, 0.3)
    sent.length = 0
    store.removeMacroTarget(0, 0)
    expect(store.getState().macros[0].targets.map((t) => [t.param, t.slot])).toEqual([[2, 1], [3, 2]])
    expect(sent).toEqual([[Op.ClearMacroTarget, 0, 0]])
  })

  test('a freed target slot is reused by the next learned target', () => {
    const { store } = fresh()
    store.armLearn(0, 'a')
    store.setParam(0, 1, 0.1)
    store.setParam(0, 2, 0.2)
    store.removeMacroTarget(0, 0)
    store.setParam(0, 4, 0.4)
    expect(store.getState().macros[0].targets.map((t) => [t.param, t.slot])).toEqual([[2, 1], [4, 0]])
  })

  test('a macro holds at most 16 targets', () => {
    const { store } = fresh()
    store.armLearn(0, 'a')
    for (let p = 0; p < 9; p++) store.setParam(0, p, 0.5)
    for (let p = 0; p < 9; p++) store.setParam(1, p, 0.5)
    expect(store.getState().macros[0].targets).toHaveLength(16)
  })
```

In `web/src/audio/dispatch.test.ts`, change `cmdSetMacroTarget(2, 1, { track: 1, param: 0, a: 0.1, b: 0.9 })` to `cmdSetMacroTarget(2, 1, { track: 1, param: 0, a: 0.1, b: 0.9, slot: 1 })`. The expected call stays `['set_macro_target', [2, 1, 1, 0, 0.1, 0.9]]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/state/store.mod.test.ts`
Expected: FAIL. Targets have no `slot`, and removal resends the shifted tail.

- [ ] **Step 3: Implement**

`web/src/state/types.ts`: change `MacroTargetState` to
```ts
export interface MacroTargetState {
  /** row (0–12 track, 13–20 bus, 21 master) */
  track: number
  param: number
  a: number
  b: number
  /** engine target slot 0–15, stable for the target's lifetime */
  slot: number
}
```

`web/src/state/store.ts`:
- Add `MacroTargetState` to the `./types` import.
- In `syncAll`, replace `mac.targets.forEach((t, i) => send(cmdSetMacroTarget(m, i, t)))` with `mac.targets.forEach((t) => send(cmdSetMacroTarget(m, t.slot, t)))`.
- In `setParam`, replace the whole `if (learn) { … return }` block with:
```ts
      if (learn) {
        const mac = state.macros[learn.macro]
        const existing = mac.targets.find((x) => x.track === t && x.param === p)
        const base = state.tracks[t].params[p]
        let target: MacroTargetState
        if (existing) {
          target = { ...existing, [learn.side]: value }
        } else {
          const used = new Set(mac.targets.map((x) => x.slot))
          const slot = Array.from({ length: MACRO_TARGETS }, (_, k) => k).find((k) => !used.has(k))
          if (slot === undefined) return
          target = { track: t, param: p, a: base, b: base, slot, [learn.side]: value }
        }
        updateMacro(learn.macro, (x) => ({
          ...x,
          targets: existing ? x.targets.map((y) => (y === existing ? target : y)) : [...x.targets, target],
        }))
        send(cmdSetMacroTarget(learn.macro, target.slot, target))
        return
      }
```
- Replace `removeMacroTarget` with:
```ts
    removeMacroTarget(m: number, i: number) {
      const removed = state.macros[m].targets[i]
      if (!removed) return
      updateMacro(m, (x) => ({ ...x, targets: x.targets.filter((_, k) => k !== i) }))
      // Engine slots are stable: only the removed target's slot fades out.
      send(cmdClearMacroTarget(m, removed.slot))
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: all green. Any other test literal of `MacroTargetState` that tsc flags gets `slot` added, with the slot the store would assign (0 for the first target).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/types.ts web/src/state/store.ts web/src/state/store.mod.test.ts web/src/audio/dispatch.test.ts
git commit -m "fix(web): give macro targets stable engine slots so removal never shifts

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 2: Generic ParamBank (replaces KickParams)

**Files:**
- Modify: `crates/core/src/params.rs`, `crates/core/src/kick.rs`, `crates/core/src/engine.rs`

**Interfaces:**
- Produces:
  - `params::MAX_PARAMS: usize = 24`
  - `ParamBank::new(descs: &'static [ParamDesc], sample_rate: f32)`, with these methods:
    - `.count() -> usize`
    - `.set_norm(i, norm)`: a non-finite norm or bad index is ignored; values are clamped to 0..1
    - `.next_norms() -> [f32; MAX_PARAMS]`: one 10 ms smoothing step; entries ≥ count are 0
    - `.apply_norms(&[f32; MAX_PARAMS])`
    - `.advance()`
    - `.get(i) -> f32`
    - `.defaults() -> [f32; MAX_PARAMS]`
- Produces from `kick.rs`: `pub type KickParams = ParamBank;` and `pub fn kick_params(sample_rate: f32) -> KickParams`. `KICK_PARAMS`, the index consts and `KickVoice` are unchanged.

- [ ] **Step 1: Write the failing tests.** Append to `mod tests` in `params.rs`:

```rust
    const TABLE: [ParamDesc; 2] = [
        ParamDesc { name: "A", min: 0.0, max: 10.0, default_norm: 0.5, curve: Curve::Lin },
        ParamDesc { name: "B", min: 1.0, max: 100.0, default_norm: 0.0, curve: Curve::Exp },
    ];

    #[test]
    fn bank_starts_at_mapped_defaults() {
        let b = ParamBank::new(&TABLE, 48_000.0);
        assert_eq!(b.count(), 2);
        assert_eq!(b.get(0), 5.0);
        assert_eq!(b.get(1), 1.0);
        assert_eq!(b.defaults()[0], 0.5);
        assert_eq!(b.defaults()[5], 0.0);
    }

    #[test]
    fn bank_smooths_and_maps() {
        let mut b = ParamBank::new(&TABLE, 48_000.0);
        b.set_norm(0, 1.0);
        b.advance();
        assert!(b.get(0) > 5.0 && b.get(0) < 5.1);
        for _ in 0..48_000 {
            b.advance();
        }
        assert!((b.get(0) - 10.0).abs() < 1e-3);
    }

    #[test]
    fn bank_ignores_bad_input() {
        let mut b = ParamBank::new(&TABLE, 48_000.0);
        b.set_norm(0, f32::NAN);
        b.set_norm(7, 1.0);
        b.set_norm(1, 3.0);
        for _ in 0..48_000 {
            b.advance();
        }
        assert_eq!(b.get(0), 5.0);
        assert!((b.get(1) - 100.0).abs() < 1e-2);
        assert_eq!(b.next_norms()[7], 0.0);
    }

    #[test]
    fn empty_bank_is_valid() {
        let mut b = ParamBank::new(&[], 48_000.0);
        assert_eq!(b.count(), 0);
        b.advance();
        assert_eq!(b.next_norms(), [0.0; MAX_PARAMS]);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core params`
Expected: compile error (`ParamBank` not found).

- [ ] **Step 3: Implement `ParamBank`.** Add this to `params.rs`, above the tests, and add `use crate::dsp::Smoother;` at the top.

```rust
pub const MAX_PARAMS: usize = 24;

/// Smoothed normalised base values of one machine, bus or master, mapped through its `ParamDesc` table.
pub struct ParamBank {
    descs: &'static [ParamDesc],
    smooth: [Smoother; MAX_PARAMS],
    values: [f32; MAX_PARAMS],
}

impl ParamBank {
    pub fn new(descs: &'static [ParamDesc], sample_rate: f32) -> Self {
        assert!(descs.len() <= MAX_PARAMS, "too many params");
        ParamBank {
            descs,
            smooth: core::array::from_fn(|i| Smoother::new(descs.get(i).map_or(0.0, |d| d.default_norm), 10.0, sample_rate)),
            values: core::array::from_fn(|i| descs.get(i).map_or(0.0, |d| d.map(d.default_norm))),
        }
    }

    pub fn count(&self) -> usize {
        self.descs.len()
    }

    pub fn set_norm(&mut self, i: usize, norm: f32) {
        if norm.is_finite() && i < self.descs.len() {
            self.smooth[i].set(norm.clamp(0.0, 1.0));
        }
    }

    pub fn next_norms(&mut self) -> [f32; MAX_PARAMS] {
        let mut out = [0.0; MAX_PARAMS];
        for (i, v) in out.iter_mut().enumerate().take(self.descs.len()) {
            *v = self.smooth[i].next();
        }
        out
    }

    pub fn apply_norms(&mut self, norms: &[f32; MAX_PARAMS]) {
        for (i, d) in self.descs.iter().enumerate() {
            self.values[i] = d.map(norms[i]);
        }
    }

    pub fn advance(&mut self) {
        let norms = self.next_norms();
        self.apply_norms(&norms);
    }

    pub fn get(&self, i: usize) -> f32 {
        self.values[i]
    }

    pub fn defaults(&self) -> [f32; MAX_PARAMS] {
        core::array::from_fn(|i| self.descs.get(i).map_or(0.0, |d| d.default_norm))
    }
}
```

- [ ] **Step 4: Migrate the kick.** In `kick.rs`:
  - Delete the `pub struct KickParams { … }` and its `impl KickParams { … }`.
  - Change the imports to `use crate::dsp::{one_pole_coef, Drive2x};` and `use crate::params::{Curve, ParamBank, ParamDesc};`.
  - Add:
```rust
pub type KickParams = ParamBank;

pub fn kick_params(sample_rate: f32) -> KickParams {
    ParamBank::new(&KICK_PARAMS, sample_rate)
}
```
  - In the kick tests, replace every `KickParams::new(SR)` with `kick_params(SR)`, and every `[1.0; KICK_PARAM_COUNT]` / `[0.0; KICK_PARAM_COUNT]` passed to `apply_norms` with `[1.0; MAX_PARAMS]` / `[0.0; MAX_PARAMS]`. Import `crate::params::MAX_PARAMS` in the test module.

In `engine.rs` (minimal changes; Task 9 rewrites the engine):
- `use crate::kick::{kick_params, KickParams, KickVoice, KICK_PARAMS, KICK_PARAM_COUNT};` and `use crate::params::MAX_PARAMS;`
- The field becomes `effective: [[f32; MAX_PARAMS]; KICK_TRACKS]`.
- It is initialised with `effective: [core::array::from_fn(|i| KICK_PARAMS.get(i).map_or(0.0, |d| d.default_norm)); KICK_TRACKS]`.
- `kick_params: core::array::from_fn(|_| kick_params(sample_rate))`
- In `process`: `for (p, v) in norms.iter_mut().enumerate().take(KICK_PARAM_COUNT) { … }`. The rest is unchanged.

- [ ] **Step 5: Run all core tests**

Run: `source "$HOME/.cargo/env" && cargo test`
Expected: every existing test plus the 4 new `params` tests pass, with no warnings.

- [ ] **Step 6: Commit**

```bash
git add crates/core/src/params.rs crates/core/src/kick.rs crates/core/src/engine.rs
git commit -m "refactor(core): generic ParamBank for every machine, bus and master

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 3: Per-step notes end to end

**Files:**
- Modify: `crates/core/src/seq.rs`, `crates/core/src/engine.rs`, `crates/wasm/src/lib.rs`
- Modify: `web/src/state/types.ts`, `web/src/state/store.ts`, `web/src/audio/ops.ts`, `web/src/audio/exports.ts`, `web/src/audio/dispatch.ts`
- Tests: `crates/core/src/seq.rs`, `web/src/audio/dispatch.test.ts`, `web/src/audio/wasm.test.ts`, `web/src/state/store.test.ts`

**Interfaces:**
- Produces in Rust:
  - `Step.note: u8` (MIDI note, default 41 = F2), clamped to ≤ 127 in `Track::set_step`.
  - `pub struct Trig { pub vel: f32, pub note: u8 }` (Copy).
  - `Track::on_tick(..) -> Option<Trig>`.
- Produces the wasm export `utero_set_step(track, step, trig, vel, prob, cond, a, b, micro, note)`, with note as the 10th argument.
- Produces in TS:
  - `StepState.note: number`
  - `cmdSetStep` appends `st.note`, making it 11 words
  - `EngineExports.utero_set_step` gains `note`, and dispatch passes `c[10]`
  - the store's empty step has `note: 41`, and `isDefault` also requires `note === 41`

- [ ] **Step 1: Write the failing tests**

Append to `mod tests` in `seq.rs`:
```rust
    #[test]
    fn trig_carries_the_step_note() {
        let mut t = Track::new();
        t.set_step(0, Step { note: 53, ..trig() });
        let mut rng = Rng::new(1);
        let mut ctx = CondCtx { fill: false, neighbor: false, rng: &mut rng };
        let fired = t.on_tick(0, &mut ctx).expect("fires");
        assert_eq!(fired.note, 53);
        assert_eq!(fired.vel, 1.0);
    }

    #[test]
    fn note_defaults_to_f2_and_is_clamped() {
        assert_eq!(Step::default().note, 41);
        let mut t = Track::new();
        t.set_step(0, Step { note: 200, ..trig() });
        let mut rng = Rng::new(1);
        let mut ctx = CondCtx { fill: false, neighbor: false, rng: &mut rng };
        assert_eq!(t.on_tick(0, &mut ctx).unwrap().note, 127);
    }
```

Web tests:
- `dispatch.test.ts`: the step literal becomes `{ trig: true, vel: 0.5, prob: 60, cond: 1 as const, a: 2, b: 4, micro: -3, note: 53 }`, and the expected call becomes `['set_step', [0, 5, 1, 0.5, 60, 1, 2, 4, -3, 53]]`.
- `store.test.ts`: in `toggleStep flips the step and sends it`, the expected command becomes `[[Op.SetStep, 1, 3, 1, 1, 100, 0, 1, 2, 0, 41]]`.
- `wasm.test.ts`:
  - `ex.utero_set_step(0, 0, 1, 1, 100, 0, 1, 2, 0)` becomes `ex.utero_set_step(0, 0, 1, 1, 100, 0, 1, 2, 0, 41)`.
  - In the garbage test, `ex.utero_set_step(99, 999, 1, NaN, 500, 42, 0, 0, 999)` becomes `ex.utero_set_step(99, 999, 1, NaN, 500, 42, 0, 0, 999, 300)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core seq` then `cd web && npx vitest run src/audio src/state`
Expected: Rust fails to compile (`note`, `Trig` missing); the web dispatch and store tests fail.

- [ ] **Step 3: Implement**

`seq.rs`:
- add `/// MIDI note; 41 = F2.` and `pub note: u8,` to `Step`, plus `note: 41` in `Default`
- add `note: step.note.min(127),` inside `set_step`'s struct update
- add
```rust
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Trig {
    pub vel: f32,
    pub note: u8,
}
```
- change `on_tick` to return `Option<Trig>`, with `return Some(Trig { vel: step.vel, note: step.note });`

`engine.rs`:
- import `Trig` only if used. In `on_tick`, `if let Some(trig) = self.tracks[t].on_tick(tick, &mut ctx) { if t < KICK_TRACKS { self.kicks[t].trigger(trig.vel, &mut self.rng); } self.mods.on_track_trigger(t); }`

`crates/wasm/src/lib.rs`:
- `utero_set_step` gets a trailing `note: u32` parameter and sets `note: byte(note).min(127),` in the `Step`.

`web/src/state/types.ts`:
- `StepState` gets `/** MIDI note, 41 = F2 */ note: number`.

`web/src/audio/ops.ts`:
```ts
export const cmdSetStep = (t: number, s: number, st: StepState) =>
  [Op.SetStep, t, s, st.trig ? 1 : 0, st.vel, st.prob, st.cond, st.a, st.b, st.micro, st.note]
```

`web/src/audio/exports.ts`:
- `utero_set_step(track, step, trig, vel, prob, cond, a, b, micro, note: number): void`

`web/src/audio/dispatch.ts`:
- `case Op.SetStep: ex.utero_set_step(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10]); break`

`web/src/state/store.ts`:
- `emptyStep` returns `{ trig: false, vel: 1, prob: 100, cond: 0, a: 1, b: 2, micro: 0, note: 41 }`
- `isDefault` adds `&& s.note === 41`

- [ ] **Step 4: Run all tests**

Run: `source "$HOME/.cargo/env" && cargo test && cd web && source ~/.nvm/nvm.sh && npm run wasm && npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/seq.rs crates/core/src/engine.rs crates/wasm/src/lib.rs web/src/state/types.ts web/src/state/store.ts web/src/state/store.test.ts web/src/audio/ops.ts web/src/audio/exports.ts web/src/audio/dispatch.ts web/src/audio/dispatch.test.ts web/src/audio/wasm.test.ts
git commit -m "feat: per-step notes from sequencer to engine

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 4: DSP primitives for oscillators, filters and the master

**Files:**
- Modify: `crates/core/src/dsp.rs` (append above `#[cfg(test)]`, plus tests)

**Interfaces:**
- Produces:
  - Conversions: `midi_to_hz(note: f32) -> f32`, `db_to_gain(db) -> f32`, `gain_to_db(gain) -> f32` (floor 1e-9)
  - `Osc::new()`, with `.reset(phase)`, `.phase()` and `.next(freq, sample_rate, width) -> (saw, pulse)` (polyBLEP, width clamped 0.05–0.95)
  - `Svf::new()`, with `.reset()` and `.process(x, cutoff_hz, damp, sample_rate) -> SvfOut { lp, bp, hp }`. This is the Zavalishin TPT filter; damp = 2 − 2·Q⁻¹-style, valid in (0, 2]; non-finite state resets.
  - `fold(x, amount) -> f32`: sine folder, where 0 = exact bypass
  - `Glide::new(semis)`, with `.set_time(ms, sample_rate)`, `.set_target(semis)`, `.jump(semis)`, `.next() -> f32` and `.value() -> f32`
  - `OnePole::default()`, with `.lp(x, coef) -> f32`
  - `Biquad::new(b0, b1, b2, a1, a2)` (TDF-II), with `.process(x) -> f32`

- [ ] **Step 1: Write the failing tests.** Append inside `mod tests` in `dsp.rs`:

```rust
    fn sine(freq: f32, n: usize) -> Vec<f32> {
        (0..n).map(|i| (TAU * freq * i as f32 / 48_000.0).sin()).collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn unit_conversions() {
        assert!((midi_to_hz(69.0) - 440.0).abs() < 1e-3);
        assert!((midi_to_hz(57.0) - 220.0).abs() < 1e-3);
        assert!((gain_to_db(db_to_gain(-12.0)) + 12.0).abs() < 1e-4);
        assert!((gain_to_db(0.0) + 180.0).abs() < 1e-3);
    }

    #[test]
    fn osc_is_bounded_dc_free_and_on_pitch() {
        let mut o = Osc::new();
        let mut rising = 0;
        let mut prev = 0.0_f32;
        let mut sum = 0.0_f32;
        for _ in 0..48_000 {
            let (saw, pulse) = o.next(100.0, 48_000.0, 0.5);
            assert!(saw.abs() <= 1.05 && pulse.abs() <= 1.05);
            if prev < 0.0 && pulse >= 0.0 {
                rising += 1;
            }
            prev = pulse;
            sum += saw;
        }
        assert!((99..=101).contains(&rising), "{rising}");
        assert!((sum / 48_000.0).abs() < 0.01);
    }

    #[test]
    fn svf_lowpass_and_highpass_separate_bands() {
        let mut f = Svf::new();
        let hi: Vec<f32> = sine(8_000.0, 9_600).iter().map(|&x| f.process(x, 200.0, 1.414, 48_000.0).lp).collect();
        assert!(rms(&hi[4_800..]) < 0.01);
        let mut f = Svf::new();
        let lo: Vec<f32> = sine(50.0, 48_000).iter().map(|&x| f.process(x, 5_000.0, 1.414, 48_000.0).lp).collect();
        let ratio = rms(&lo[9_600..]) / rms(&sine(50.0, 48_000)[9_600..]);
        assert!((0.95..1.05).contains(&ratio), "{ratio}");
        let mut f = Svf::new();
        let thin: Vec<f32> = sine(50.0, 48_000).iter().map(|&x| f.process(x, 2_000.0, 1.414, 48_000.0).hp).collect();
        assert!(rms(&thin[9_600..]) < 0.01);
    }

    #[test]
    fn svf_survives_wild_modulation() {
        let mut f = Svf::new();
        let mut rng = crate::rng::Rng::new(4);
        for _ in 0..48_000 {
            let cutoff = 20.0 * 1000f32.powf(rng.next_f32());
            let out = f.process(rng.bipolar(), cutoff, 0.05, 48_000.0);
            assert!(out.lp.is_finite() && out.bp.is_finite() && out.hp.is_finite());
            assert!(out.lp.abs() < 50.0);
        }
    }

    #[test]
    fn fold_bypasses_at_zero_and_stays_bounded() {
        for i in -10..=10 {
            let x = i as f32 / 10.0;
            assert_eq!(fold(x, 0.0), x);
            assert!(fold(x, 1.0).abs() <= 1.0 + 1e-6);
        }
    }

    #[test]
    fn glide_jumps_at_zero_time_and_slides_otherwise() {
        let mut g = Glide::new(41.0);
        g.set_time(0.0, 48_000.0);
        g.set_target(53.0);
        assert_eq!(g.next(), 53.0);
        let mut g = Glide::new(41.0);
        g.set_time(100.0, 48_000.0);
        g.set_target(53.0);
        assert!(g.next() < 41.5);
        for _ in 0..48_000 {
            g.next();
        }
        assert!((g.value() - 53.0).abs() < 1e-3);
        g.jump(30.0);
        assert_eq!(g.value(), 30.0);
    }

    #[test]
    fn biquad_identity_passes_through() {
        let mut b = Biquad::new(1.0, 0.0, 0.0, 0.0, 0.0);
        for x in [0.3_f32, -0.7, 0.1] {
            assert_eq!(b.process(x), x);
        }
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core dsp`
Expected: compile errors (`Osc`, `Svf` etc. not found).

- [ ] **Step 3: Implement.** Append above `#[cfg(test)]` in `dsp.rs`, and change the top import to `use core::f32::consts::{FRAC_PI_2, PI, TAU};`.

```rust
pub fn midi_to_hz(note: f32) -> f32 {
    440.0 * ((note - 69.0) / 12.0).exp2()
}

pub fn db_to_gain(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

pub fn gain_to_db(gain: f32) -> f32 {
    20.0 * gain.max(1.0e-9).log10()
}

/// polyBLEP residual: removes most of the aliasing of a naive saw/pulse edge.
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Osc {
    phase: f32,
}

impl Osc {
    pub fn new() -> Self {
        Osc { phase: 0.0 }
    }

    pub fn reset(&mut self, phase: f32) {
        self.phase = phase.rem_euclid(1.0);
    }

    pub fn phase(&self) -> f32 {
        self.phase
    }

    /// Returns (saw, pulse) for this sample, then advances; `width` is the pulse duty cycle.
    pub fn next(&mut self, freq: f32, sample_rate: f32, width: f32) -> (f32, f32) {
        let dt = (freq / sample_rate).clamp(1.0e-7, 0.5);
        let t = self.phase;
        let w = width.clamp(0.05, 0.95);
        let saw = 2.0 * t - 1.0 - poly_blep(t, dt);
        let naive = if t < w { 1.0 } else { -1.0 };
        let pulse = naive + poly_blep(t, dt) - poly_blep((t + 1.0 - w) % 1.0, dt);
        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        (saw, pulse)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SvfOut {
    pub lp: f32,
    pub bp: f32,
    pub hp: f32,
}

/// Zavalishin TPT state-variable filter: stays stable under per-sample cutoff modulation.
#[derive(Clone, Copy, Debug, Default)]
pub struct Svf {
    ic1: f32,
    ic2: f32,
}

impl Svf {
    pub fn new() -> Self {
        Svf { ic1: 0.0, ic2: 0.0 }
    }

    pub fn reset(&mut self) {
        self.ic1 = 0.0;
        self.ic2 = 0.0;
    }

    /// `damp` is 2·ζ: 2 = no resonance, → 0 = self-oscillation.
    pub fn process(&mut self, x: f32, cutoff: f32, damp: f32, sample_rate: f32) -> SvfOut {
        let g = (PI * (cutoff / sample_rate).clamp(1.0e-5, 0.49)).tan();
        let k = damp.clamp(0.01, 2.0);
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = x - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        if !(self.ic1.is_finite() && self.ic2.is_finite()) {
            self.reset();
            return SvfOut { lp: 0.0, bp: 0.0, hp: 0.0 };
        }
        SvfOut { lp: v2, bp: v1, hp: x - k * v1 - v2 }
    }
}

/// Sine wavefolder, crossfaded in by `amount` so 0 is an exact bypass.
pub fn fold(x: f32, amount: f32) -> f32 {
    if amount <= 0.0 {
        return x;
    }
    let a = amount.min(1.0);
    let folded = (x * (1.0 + a * 5.0) * FRAC_PI_2).sin();
    x + (folded - x) * a
}

/// Portamento in semitones: one-pole towards the target; time 0 jumps.
#[derive(Clone, Copy, Debug)]
pub struct Glide {
    value: f32,
    target: f32,
    coef: f32,
}

impl Glide {
    pub fn new(semis: f32) -> Self {
        Glide { value: semis, target: semis, coef: 1.0 }
    }

    pub fn set_time(&mut self, ms: f32, sample_rate: f32) {
        self.coef = if ms <= 0.0 { 1.0 } else { 1.0 - (-1.0 / (ms * 0.001 * sample_rate)).exp() };
    }

    pub fn set_target(&mut self, semis: f32) {
        self.target = semis;
    }

    pub fn jump(&mut self, semis: f32) {
        self.value = semis;
        self.target = semis;
    }

    pub fn next(&mut self) -> f32 {
        self.value += (self.target - self.value) * self.coef;
        self.value
    }

    pub fn value(&self) -> f32 {
        self.value
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct OnePole {
    z: f32,
}

impl OnePole {
    pub fn lp(&mut self, x: f32, coef: f32) -> f32 {
        self.z += (x - self.z) * coef;
        if !self.z.is_finite() {
            self.z = 0.0;
        }
        self.z
    }
}

/// Transposed direct form II biquad (normalised: a0 = 1).
#[derive(Clone, Copy, Debug)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    pub const fn new(b0: f32, b1: f32, b2: f32, a1: f32, a2: f32) -> Self {
        Biquad { b0, b1, b2, a1, a2, z1: 0.0, z2: 0.0 }
    }

    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core dsp`
Expected: all dsp tests pass, with no warnings. If a test fails because of a number in this plan (not your code), report BLOCKED with the measured value.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/dsp.rs
git commit -m "feat(core): add polyblep osc, tpt svf, folder, glide and filters

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 5: SUB machine

**Files:**
- Create: `crates/core/src/sub.rs`
- Modify: `crates/core/src/lib.rs` (`pub mod sub;`)

**Interfaces:**
- Consumes: `dsp::{midi_to_hz, Drive2x, Glide}`, `params::{Curve, ParamBank, ParamDesc}`, `rng::Rng`.
- Produces:
  - Index consts `OCT=0, PHASE=1, DRIVE=2, GLIDE=3, DECAY=4, DRIFT=5, LEVEL=6, ROUTE=7`, plus `SUB_PARAM_COUNT = 8` and `SUB_PARAMS`
  - `sub_params(sample_rate) -> ParamBank`
  - `is_direct(p: &ParamBank) -> bool` (ROUTE ≥ 0.5)
  - `SubVoice::new(sample_rate)`, with these methods:
    - `.trigger(vel, note: u8, p: &ParamBank, rng: &mut Rng)`
    - `.render(&mut self, p: &ParamBank) -> f32`
    - `.is_active()`
    - `.pitch() -> f32` (current glide value, semitones)

- [ ] **Step 1: Write the failing tests** in `crates/core/src/sub.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn settled(edits: &[(usize, f32)]) -> ParamBank {
        let mut p = sub_params(SR);
        for &(i, v) in edits {
            p.set_norm(i, v);
        }
        for _ in 0..48_000 {
            p.advance();
        }
        p
    }

    fn render(v: &mut SubVoice, p: &ParamBank, n: usize) -> Vec<f32> {
        (0..n).map(|_| v.render(p)).collect()
    }

    #[test]
    fn defaults_are_one_octave_down_and_about_800_ms() {
        let p = sub_params(SR);
        assert_eq!(p.get(OCT), 1.0);
        assert!((p.get(DECAY) - 796.0).abs() < 2.0);
        assert!(!is_direct(&p));
    }

    #[test]
    fn silent_until_triggered() {
        let p = settled(&[]);
        let mut v = SubVoice::new(SR);
        assert!(render(&mut v, &p, 100).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn plays_f1_for_note_41() {
        let p = settled(&[(DRIVE, 0.0), (DRIFT, 0.0)]);
        let mut v = SubVoice::new(SR);
        v.trigger(1.0, 41, &p, &mut Rng::new(1));
        let out = render(&mut v, &p, 48_000);
        let crossings = out.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        assert!((43..=44).contains(&crossings), "{crossings}");
    }

    #[test]
    fn retrigger_while_sounding_does_not_click() {
        let p = settled(&[(DRIFT, 0.0)]);
        let mut v = SubVoice::new(SR);
        let mut rng = Rng::new(1);
        v.trigger(1.0, 41, &p, &mut rng);
        let mut out = render(&mut v, &p, 9_600);
        v.trigger(1.0, 41, &p, &mut rng);
        out.extend(render(&mut v, &p, 2_400));
        let worst = out.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0_f32, f32::max);
        assert!(worst < 0.02, "max step {worst}");
    }

    #[test]
    fn glide_slides_between_notes() {
        let p = settled(&[(GLIDE, 1.0)]);
        let mut v = SubVoice::new(SR);
        let mut rng = Rng::new(1);
        v.trigger(1.0, 41, &p, &mut rng);
        render(&mut v, &p, 4_800);
        v.trigger(1.0, 53, &p, &mut rng);
        render(&mut v, &p, 1);
        assert!(v.pitch() < 42.0);
        render(&mut v, &p, 96_000);
        assert!((v.pitch() - 53.0).abs() < 0.05);
    }

    #[test]
    fn route_flag_switches_to_direct() {
        assert!(is_direct(&settled(&[(ROUTE, 1.0)])));
    }

    #[test]
    fn decays_and_deactivates() {
        let p = settled(&[(DECAY, 0.0)]);
        let mut v = SubVoice::new(SR);
        v.trigger(1.0, 41, &p, &mut Rng::new(1));
        render(&mut v, &p, 48_000);
        assert!(!v.is_active());
    }

    #[test]
    fn extreme_params_stay_finite() {
        for norm in [0.0_f32, 1.0] {
            let edits: Vec<(usize, f32)> = (0..SUB_PARAM_COUNT).map(|i| (i, norm)).collect();
            let p = settled(&edits);
            let mut v = SubVoice::new(SR);
            v.trigger(1.0, 127, &p, &mut Rng::new(3));
            assert!(render(&mut v, &p, 48_000).iter().all(|s| s.is_finite() && s.abs() <= 1.0));
        }
    }
}
```

Add `pub mod sub;` to lib.rs (alphabetical).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core sub`
Expected: compile errors.

- [ ] **Step 3: Implement** (above the tests)

```rust
use core::f32::consts::TAU;

use crate::dsp::{midi_to_hz, Drive2x, Glide};
use crate::params::{Curve, ParamBank, ParamDesc};
use crate::rng::Rng;

pub const OCT: usize = 0;
pub const PHASE: usize = 1;
pub const DRIVE: usize = 2;
pub const GLIDE: usize = 3;
pub const DECAY: usize = 4;
pub const DRIFT: usize = 5;
pub const LEVEL: usize = 6;
pub const ROUTE: usize = 7;
pub const SUB_PARAM_COUNT: usize = 8;

/// Order and default_norm are mirrored in web/src/state/machines.ts.
pub const SUB_PARAMS: [ParamDesc; SUB_PARAM_COUNT] = [
    // 0, 1 or 2 octaves below the step note
    ParamDesc { name: "OCT", min: 0.0, max: 2.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "PHASE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "DRIVE", min: 0.0, max: 1.0, default_norm: 0.1, curve: Curve::Lin },
    ParamDesc { name: "GLIDE", min: 0.0, max: 300.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "DECAY", min: 50.0, max: 5000.0, default_norm: 0.6, curve: Curve::Exp },
    ParamDesc { name: "DRIFT", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.8, curve: Curve::Lin },
    // < 0.5 through the BASS bus FX, ≥ 0.5 DIRECT (bypasses bus filter/drive, keeps fader + mute)
    ParamDesc { name: "ROUTE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
];

pub fn sub_params(sample_rate: f32) -> ParamBank {
    ParamBank::new(&SUB_PARAMS, sample_rate)
}

pub fn is_direct(p: &ParamBank) -> bool {
    p.get(ROUTE) >= 0.5
}

/// A clean sine an octave or two below the note: the low end the kick sits on.
pub struct SubVoice {
    sample_rate: f32,
    phase: f32,
    amp: f32,
    attack: bool,
    att_coef: f32,
    active: bool,
    vel: f32,
    drift: f32,
    glide: Glide,
    drive: Drive2x,
}

impl SubVoice {
    pub fn new(sample_rate: f32) -> Self {
        SubVoice {
            sample_rate,
            phase: 0.0,
            amp: 0.0,
            attack: false,
            att_coef: 1.0 - (-1.0 / (0.002 * sample_rate)).exp(),
            active: false,
            vel: 0.0,
            drift: 0.0,
            glide: Glide::new(41.0),
            drive: Drive2x::new(),
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn pitch(&self) -> f32 {
        self.glide.value()
    }

    pub fn trigger(&mut self, vel: f32, note: u8, p: &ParamBank, rng: &mut Rng) {
        let sounding = self.active && self.amp > 0.05;
        if sounding && p.get(GLIDE) > 0.0 {
            self.glide.set_target(note as f32);
        } else {
            self.glide.jump(note as f32);
        }
        // Restart from PHASE only from silence: resetting a sounding sine would click.
        if !sounding {
            self.phase = p.get(PHASE);
        }
        self.attack = true;
        self.active = true;
        self.vel = vel.clamp(0.0, 1.0);
        self.drift = rng.bipolar() * 0.005 * p.get(DRIFT);
    }

    pub fn render(&mut self, p: &ParamBank) -> f32 {
        if !self.active {
            return 0.0;
        }
        let sr = self.sample_rate;
        self.glide.set_time(p.get(GLIDE), sr);
        let semis = self.glide.next() - 12.0 * p.get(OCT).round();
        let freq = midi_to_hz(semis) * (1.0 + self.drift);
        self.phase += freq / sr;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        if self.attack {
            self.amp += (1.0 - self.amp) * self.att_coef;
            if self.amp > 0.999 {
                self.attack = false;
            }
        } else {
            self.amp *= (-1.0 / (p.get(DECAY) * 0.001 * sr)).exp();
            if self.amp < 1.0e-4 {
                self.active = false;
            }
        }
        let x = (self.phase * TAU).sin() * self.amp;
        self.drive.process(x, p.get(DRIVE)) * self.vel * p.get(LEVEL)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core sub`
Expected: 8 passed, no warnings. If a test fails because of a number in this plan, report BLOCKED with measured values.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/sub.rs
git commit -m "feat(core): add sub machine with glide, phase reset and direct route

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 6: MID BASS machine

**Files:**
- Create: `crates/core/src/mid.rs`
- Modify: `crates/core/src/lib.rs` (`pub mod mid;`)

**Interfaces:**
- Consumes: `dsp::{fold, midi_to_hz, Drive2x, Glide, Osc, Svf}`, `params::*`, `rng::Rng`.
- Produces:
  - Index consts, `MID_PARAM_COUNT = 17` and `MID_PARAMS`:
    - SRC: `WAVE=0, DETUNE=1, FOLD=2, NOISE=3, DRIFT=4, OCT=5, GLIDE=6, LINK=7`
    - FLTR: `CUTOFF=8, RES=9, ENV_AMT=10, F_DECAY=11, DRIVE=12, KEYTRK=13, TYPE=14, LEVEL=15`
    - AMP: `A_DECAY=16`
  - `mid_params(sample_rate) -> ParamBank`
  - `is_linked(p) -> bool` (LINK ≥ 0.5)
  - `MidVoice::new(sample_rate, seed: u32)`, with `.trigger(vel, note, p, rng)`, `.render(p) -> f32` and `.is_active()`

- [ ] **Step 1: Write the failing tests** in `crates/core/src/mid.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn settled(edits: &[(usize, f32)]) -> ParamBank {
        let mut p = mid_params(SR);
        for &(i, v) in edits {
            p.set_norm(i, v);
        }
        for _ in 0..48_000 {
            p.advance();
        }
        p
    }

    fn render(v: &mut MidVoice, p: &ParamBank, n: usize) -> Vec<f32> {
        (0..n).map(|_| v.render(p)).collect()
    }

    #[test]
    fn defaults() {
        let p = mid_params(SR);
        assert!((p.get(CUTOFF) - 446.0).abs() < 3.0);
        assert!((p.get(A_DECAY) - 346.0).abs() < 3.0);
        assert!(!is_linked(&p));
    }

    #[test]
    fn silent_until_triggered() {
        let p = settled(&[]);
        let mut v = MidVoice::new(SR, 1);
        assert!(render(&mut v, &p, 100).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn a_note_is_audible_and_bounded() {
        let p = settled(&[]);
        let mut v = MidVoice::new(SR, 1);
        v.trigger(1.0, 41, &p, &mut Rng::new(2));
        let out = render(&mut v, &p, 24_000);
        assert!(out.iter().fold(0.0_f32, |m, s| m.max(s.abs())) > 0.05);
        assert!(out.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
    }

    #[test]
    fn filter_envelope_brightens_the_attack() {
        let roughness = |env: f32| {
            let p = settled(&[(ENV_AMT, env), (DETUNE, 0.0), (NOISE, 0.0), (DRIFT, 0.0)]);
            let mut v = MidVoice::new(SR, 1);
            v.trigger(1.0, 41, &p, &mut Rng::new(2));
            let out = render(&mut v, &p, 960);
            out.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f32>()
        };
        assert!(roughness(1.0) > roughness(0.0) * 1.5);
    }

    #[test]
    fn cutoff_modulation_stays_finite() {
        let mut p = settled(&[(RES, 1.0)]);
        let mut v = MidVoice::new(SR, 1);
        let mut rng = Rng::new(5);
        v.trigger(1.0, 41, &p, &mut rng);
        for _ in 0..48_000 {
            p.set_norm(CUTOFF, rng.next_f32());
            p.advance();
            assert!(v.render(&p).is_finite());
        }
    }

    #[test]
    fn decays_and_deactivates() {
        let p = settled(&[(A_DECAY, 0.0)]);
        let mut v = MidVoice::new(SR, 1);
        v.trigger(1.0, 41, &p, &mut Rng::new(1));
        render(&mut v, &p, 48_000);
        assert!(!v.is_active());
    }

    #[test]
    fn extreme_params_stay_finite() {
        for norm in [0.0_f32, 1.0] {
            let edits: Vec<(usize, f32)> = (0..MID_PARAM_COUNT).map(|i| (i, norm)).collect();
            let p = settled(&edits);
            let mut v = MidVoice::new(SR, 7);
            v.trigger(1.0, 100, &p, &mut Rng::new(3));
            assert!(render(&mut v, &p, 48_000).iter().all(|s| s.is_finite() && s.abs() <= 1.0));
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core mid`
Expected: compile errors.

- [ ] **Step 3: Implement** (above the tests)

```rust
use crate::dsp::{fold, midi_to_hz, Drive2x, Glide, Osc, Svf};
use crate::params::{Curve, ParamBank, ParamDesc};
use crate::rng::Rng;

pub const WAVE: usize = 0;
pub const DETUNE: usize = 1;
pub const FOLD: usize = 2;
pub const NOISE: usize = 3;
pub const DRIFT: usize = 4;
pub const OCT: usize = 5;
pub const GLIDE: usize = 6;
pub const LINK: usize = 7;
pub const CUTOFF: usize = 8;
pub const RES: usize = 9;
pub const ENV_AMT: usize = 10;
pub const F_DECAY: usize = 11;
pub const DRIVE: usize = 12;
pub const KEYTRK: usize = 13;
pub const TYPE: usize = 14;
pub const LEVEL: usize = 15;
pub const A_DECAY: usize = 16;
pub const MID_PARAM_COUNT: usize = 17;

/// Order and default_norm are mirrored in web/src/state/machines.ts.
pub const MID_PARAMS: [ParamDesc; MID_PARAM_COUNT] = [
    // saw ↔ pulse
    ParamDesc { name: "WAVE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    // second oscillator detune in cents (Reese)
    ParamDesc { name: "DETUNE", min: 0.0, max: 30.0, default_norm: 0.3, curve: Curve::Lin },
    ParamDesc { name: "FOLD", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "NOISE", min: 0.0, max: 1.0, default_norm: 0.05, curve: Curve::Lin },
    ParamDesc { name: "DRIFT", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    // −1, 0 or +1 octave
    ParamDesc { name: "OCT", min: 0.0, max: 2.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "GLIDE", min: 0.0, max: 300.0, default_norm: 0.0, curve: Curve::Lin },
    // ≥ 0.5: play SUB's notes instead of MID's own steps
    ParamDesc { name: "LINK", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "CUTOFF", min: 30.0, max: 12_000.0, default_norm: 0.45, curve: Curve::Exp },
    ParamDesc { name: "RES", min: 0.0, max: 1.0, default_norm: 0.3, curve: Curve::Lin },
    // filter envelope depth in octaves
    ParamDesc { name: "ENV AMT", min: 0.0, max: 4.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "F.DECAY", min: 10.0, max: 2000.0, default_norm: 0.4, curve: Curve::Exp },
    ParamDesc { name: "DRIVE", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    ParamDesc { name: "KEYTRK", min: 0.0, max: 1.0, default_norm: 0.5, curve: Curve::Lin },
    // < 0.5 low-pass, ≥ 0.5 band-pass
    ParamDesc { name: "TYPE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.7, curve: Curve::Lin },
    ParamDesc { name: "A.DECAY", min: 30.0, max: 4000.0, default_norm: 0.5, curve: Curve::Exp },
];

pub fn mid_params(sample_rate: f32) -> ParamBank {
    ParamBank::new(&MID_PARAMS, sample_rate)
}

pub fn is_linked(p: &ParamBank) -> bool {
    p.get(LINK) >= 0.5
}

/// Two detuned polyBLEP oscillators → noise AM → fold → TPT filter with envelope → drive.
pub struct MidVoice {
    sample_rate: f32,
    osc_a: Osc,
    osc_b: Osc,
    svf: Svf,
    glide: Glide,
    amp: f32,
    attack: bool,
    att_coef: f32,
    fenv: f32,
    active: bool,
    vel: f32,
    drift: f32,
    noise_lp: f32,
    drive: Drive2x,
    rng: Rng,
}

impl MidVoice {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        MidVoice {
            sample_rate,
            osc_a: Osc::new(),
            osc_b: Osc::new(),
            svf: Svf::new(),
            glide: Glide::new(41.0),
            amp: 0.0,
            attack: false,
            att_coef: 1.0 - (-1.0 / (0.001 * sample_rate)).exp(),
            fenv: 0.0,
            active: false,
            vel: 0.0,
            drift: 0.0,
            noise_lp: 0.0,
            drive: Drive2x::new(),
            rng: Rng::new(seed),
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn trigger(&mut self, vel: f32, note: u8, p: &ParamBank, rng: &mut Rng) {
        let sounding = self.active && self.amp > 0.05;
        if sounding && p.get(GLIDE) > 0.0 {
            self.glide.set_target(note as f32);
        } else {
            self.glide.jump(note as f32);
        }
        if !sounding {
            self.osc_a.reset(0.0);
            self.osc_b.reset(rng.next_f32());
            self.svf.reset();
        }
        self.attack = true;
        self.fenv = 1.0;
        self.active = true;
        self.vel = vel.clamp(0.0, 1.0);
        self.drift = rng.bipolar() * 0.01 * p.get(DRIFT);
    }

    pub fn render(&mut self, p: &ParamBank) -> f32 {
        if !self.active {
            return 0.0;
        }
        let sr = self.sample_rate;
        self.glide.set_time(p.get(GLIDE), sr);
        let semis = self.glide.next() + 12.0 * (p.get(OCT).round() - 1.0);
        let base = midi_to_hz(semis) * (1.0 + self.drift);
        let spread = (p.get(DETUNE) / 2400.0).exp2(); // half the detune each way
        let (sa, pa) = self.osc_a.next(base / spread, sr, 0.5);
        let (sb, pb) = self.osc_b.next(base * spread, sr, 0.5);
        let w = p.get(WAVE);
        let va = sa + (pa - sa) * w;
        let vb = sb + (pb - sb) * w;
        let d = (p.get(DETUNE) / 30.0).min(1.0);
        let mut x = (va + vb * d) / (1.0 + d);

        // NOISE modulates the amplitude, so the texture moves with the note instead of sitting beside it.
        let n = self.rng.bipolar();
        self.noise_lp += (n - self.noise_lp) * 0.05;
        let nz = p.get(NOISE);
        x *= 1.0 + nz * self.noise_lp * 3.0;
        x += n * nz * 0.05;
        x = fold(x.clamp(-1.0, 1.0), p.get(FOLD));

        let key = p.get(KEYTRK) * (semis - 41.0) / 12.0;
        let cutoff = (p.get(CUTOFF) * (p.get(ENV_AMT) * self.fenv + key).exp2()).clamp(20.0, 18_000.0);
        let f = self.svf.process(x, cutoff, 2.0 - 1.9 * p.get(RES), sr);
        let filtered = if p.get(TYPE) < 0.5 { f.lp } else { f.bp * 1.5 };
        let y = self.drive.process(filtered.clamp(-4.0, 4.0), p.get(DRIVE));
        let out = (y * self.amp * self.vel * p.get(LEVEL)).clamp(-1.0, 1.0);

        if self.attack {
            self.amp += (1.0 - self.amp) * self.att_coef;
            if self.amp > 0.999 {
                self.attack = false;
            }
        } else {
            self.amp *= (-1.0 / (p.get(A_DECAY) * 0.001 * sr)).exp();
            if self.amp < 1.0e-4 {
                self.active = false;
            }
        }
        self.fenv *= (-1.0 / (p.get(F_DECAY) * 0.001 * sr)).exp();
        if out.is_finite() {
            out
        } else {
            self.svf.reset();
            self.drive = Drive2x::new();
            0.0
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core mid`
Expected: 7 passed, no warnings. If a test fails because of a number in this plan, report BLOCKED with measured values.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/mid.rs
git commit -m "feat(core): add mid bass machine with reese detune, fold and filter envelope

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 7: Bus (DJ filter, drive, fader, mute, meters)

**Files:**
- Create: `crates/core/src/bus.rs`
- Modify: `crates/core/src/lib.rs` (`pub mod bus;`)

**Interfaces:**
- Consumes: `dsp::{Drive2x, Svf}`, `params::*`.
- Produces:
  - Constants: `BUSES = 8`, `FILTER=0, DRIVE=1, LEVEL=2`, `BUS_PARAM_COUNT = 3`, `BUS_PARAMS`
  - `fader_gain(norm) -> f32`: 0 → 0.0, 0.8 → 1.0, 1.0 → ≈2.0 (+6 dB)
  - `Bus::new(sample_rate)` with a public field `params: ParamBank`
  - `Bus` methods:
    - `.set_muted(bool)`, `.muted() -> bool`
    - `.process(l, r, post_l, post_r) -> (f32, f32)`: `post` skips filter and drive but gets fader and mute
    - `.peak() -> f32`, `.rms() -> f32`
  - The bus reads its params' **current mapped values**: the engine applies macros and modulation before `process`, and tests call `params.advance()`.

- [ ] **Step 1: Write the failing tests** in `crates/core/src/bus.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::TAU;

    const SR: f32 = 48_000.0;

    fn settle(b: &mut Bus, edits: &[(usize, f32)]) {
        for &(i, v) in edits {
            b.params.set_norm(i, v);
        }
        for _ in 0..4_800 {
            b.params.advance();
            b.process(0.0, 0.0, 0.0, 0.0);
        }
    }

    fn sine(freq: f32, i: usize) -> f32 {
        (TAU * freq * i as f32 / SR).sin()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn fader_law() {
        assert_eq!(fader_gain(0.0), 0.0);
        assert_eq!(fader_gain(0.8), 1.0);
        assert!((fader_gain(1.0) - 2.0).abs() < 0.01);
        assert!((fader_gain(0.4) - 0.116).abs() < 0.005);
        assert_eq!(fader_gain(-1.0), 0.0);
    }

    #[test]
    fn default_bus_is_transparent() {
        let mut b = Bus::new(SR);
        let mut rng = crate::rng::Rng::new(3);
        for _ in 0..1_000 {
            b.params.advance();
            let x = rng.bipolar();
            assert_eq!(b.process(x, -x, 0.0, 0.0), (x, -x));
        }
    }

    #[test]
    fn low_pass_side_darkens() {
        let mut b = Bus::new(SR);
        settle(&mut b, &[(FILTER, 0.1)]);
        let out: Vec<f32> = (0..9_600).map(|i| b.process(sine(5_000.0, i), 0.0, 0.0, 0.0).0).collect();
        assert!(rms(&out[4_800..]) < 0.05);
    }

    #[test]
    fn high_pass_side_thins() {
        let mut b = Bus::new(SR);
        settle(&mut b, &[(FILTER, 0.9)]);
        let out: Vec<f32> = (0..48_000).map(|i| b.process(sine(50.0, i), 0.0, 0.0, 0.0).0).collect();
        assert!(rms(&out[24_000..]) < 0.05);
    }

    #[test]
    fn post_input_skips_the_filter() {
        let mut b = Bus::new(SR);
        settle(&mut b, &[(FILTER, 0.0)]);
        let out: Vec<f32> = (0..9_600).map(|i| b.process(0.0, 0.0, sine(5_000.0, i), 0.0).0).collect();
        assert!(rms(&out[4_800..]) > 0.6);
    }

    #[test]
    fn mute_fades_without_steps() {
        let mut b = Bus::new(SR);
        b.params.advance();
        let mut prev = b.process(0.5, 0.5, 0.0, 0.0).0;
        b.set_muted(true);
        for _ in 0..4_800 {
            let y = b.process(0.5, 0.5, 0.0, 0.0).0;
            assert!((y - prev).abs() < 0.01);
            prev = y;
        }
        assert!(prev.abs() < 1e-3);
        assert!(b.muted());
    }

    #[test]
    fn meters_follow_the_signal() {
        let mut b = Bus::new(SR);
        b.params.advance();
        for _ in 0..48_000 {
            b.process(0.5, 0.5, 0.0, 0.0);
        }
        assert!((b.peak() - 0.5).abs() < 1e-3);
        assert!(b.rms() > 0.3);
    }

    #[test]
    fn non_finite_input_is_dropped() {
        let mut b = Bus::new(SR);
        b.params.advance();
        assert_eq!(b.process(f32::NAN, f32::INFINITY, 0.0, 0.0), (0.0, 0.0));
        assert_eq!(b.process(0.25, 0.25, 0.0, 0.0), (0.25, 0.25));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core bus`
Expected: compile errors.

- [ ] **Step 3: Implement** (above the tests)

```rust
use crate::dsp::{Drive2x, Svf};
use crate::params::{Curve, ParamBank, ParamDesc};

pub const BUSES: usize = 8;
pub const FILTER: usize = 0;
pub const DRIVE: usize = 1;
pub const LEVEL: usize = 2;
pub const BUS_PARAM_COUNT: usize = 3;

/// Order and default_norm are mirrored in web/src/state/machines.ts.
pub const BUS_PARAMS: [ParamDesc; BUS_PARAM_COUNT] = [
    // DJ filter: < 0.48 low-pass, > 0.52 high-pass, between = bypass
    ParamDesc { name: "FLT", min: 0.0, max: 1.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "DRV", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.8, curve: Curve::Lin },
];

const DEAD_ZONE: f32 = 0.02;
const FILTER_DAMP: f32 = 1.2;

/// Fader law: 0.8 = 0 dB, 1.0 ≈ +6 dB, 0 = silence.
pub fn fader_gain(norm: f32) -> f32 {
    if norm <= 0.0 {
        0.0
    } else {
        (norm / 0.8).powf(3.1)
    }
}

pub struct Bus {
    pub params: ParamBank,
    sample_rate: f32,
    lp: [Svf; 2],
    hp: [Svf; 2],
    drive: [Drive2x; 2],
    w_lp: f32,
    w_hp: f32,
    mute: f32,
    muted: bool,
    fade: f32,
    peak: f32,
    ms: f32,
    peak_decay: f32,
    ms_coef: f32,
}

impl Bus {
    pub fn new(sample_rate: f32) -> Self {
        Bus {
            params: ParamBank::new(&BUS_PARAMS, sample_rate),
            sample_rate,
            lp: [Svf::new(); 2],
            hp: [Svf::new(); 2],
            drive: [Drive2x::new(); 2],
            w_lp: 0.0,
            w_hp: 0.0,
            mute: 1.0,
            muted: false,
            fade: 1.0 - (-1.0 / (0.005 * sample_rate)).exp(),
            peak: 0.0,
            ms: 0.0,
            peak_decay: (-1.0 / (0.3 * sample_rate)).exp(),
            ms_coef: 1.0 - (-1.0 / (0.3 * sample_rate)).exp(),
        }
    }

    pub fn set_muted(&mut self, on: bool) {
        self.muted = on;
    }

    pub fn muted(&self) -> bool {
        self.muted
    }

    pub fn peak(&self) -> f32 {
        self.peak
    }

    pub fn rms(&self) -> f32 {
        self.ms.sqrt()
    }

    /// One stereo sample. `post` joins after filter and drive (SUB DIRECT) but still gets fader and mute.
    pub fn process(&mut self, l: f32, r: f32, post_l: f32, post_r: f32) -> (f32, f32) {
        let finite = |v: f32| if v.is_finite() { v } else { 0.0 };
        let f = self.params.get(FILTER);
        let want_lp = if f < 0.5 - DEAD_ZONE { 1.0 } else { 0.0 };
        let want_hp = if f > 0.5 + DEAD_ZONE { 1.0 } else { 0.0 };
        self.w_lp += (want_lp - self.w_lp) * self.fade;
        self.w_hp += (want_hp - self.w_hp) * self.fade;
        let span = 0.5 - DEAD_ZONE;
        let lp_cut = 20.0 * 1000f32.powf((f / span).min(1.0));
        let hp_cut = 20.0 * 1000f32.powf(((f - 0.5 - DEAD_ZONE) / span).clamp(0.0, 1.0));
        let drv = self.params.get(DRIVE);
        let gain = fader_gain(self.params.get(LEVEL));
        let want_mute = if self.muted { 0.0 } else { 1.0 };
        self.mute += (want_mute - self.mute) * self.fade;

        let input = [finite(l), finite(r)];
        let post = [finite(post_l), finite(post_r)];
        let mut out = [0.0_f32; 2];
        for c in 0..2 {
            let x = input[c];
            let lo = self.lp[c].process(x, lp_cut, FILTER_DAMP, self.sample_rate).lp;
            let hi = self.hp[c].process(x, hp_cut, FILTER_DAMP, self.sample_rate).hp;
            let filtered = x + (lo - x) * self.w_lp + (hi - x) * self.w_hp;
            out[c] = (self.drive[c].process(filtered, drv) + post[c]) * gain * self.mute;
        }
        let p = out[0].abs().max(out[1].abs());
        self.peak = if p > self.peak { p } else { self.peak * self.peak_decay };
        self.ms += (0.5 * (out[0] * out[0] + out[1] * out[1]) - self.ms) * self.ms_coef;
        (out[0], out[1])
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core bus`
Expected: 8 passed, no warnings. If a test fails because of a number in this plan, report BLOCKED with measured values.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/bus.rs
git commit -m "feat(core): add bus with dj filter, drive, fader law, smooth mute and meters

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 8: Master chain

**Files:**
- Create: `crates/core/src/master.rs`
- Modify: `crates/core/src/lib.rs` (`pub mod master;`)

**Interfaces:**
- Consumes: `dsp::{db_to_gain, gain_to_db, Biquad, OnePole, Svf}`, `bus::fader_gain`, `params::*`.
- Produces:
  - Index consts: `COMP=0, ATTACK=1, RELEASE=2, MIX=3, SAT=4, CURVE=5, TILT=6, LOW_CUT=7, CEILING=8, MODE=9, LEVEL=10`
  - `MASTER_PARAM_COUNT = 11`, `MASTER_PARAMS`
  - `Master::new(sample_rate)` with a public field `params: ParamBank`
  - `Master` methods:
    - `.process(l, r) -> (f32, f32)`
    - `.lufs() -> f32` (−70 floor)
    - `.gr_db() -> f32`
    - `.peak(channel) -> f32`
  - Chain order: low cut → tilt → glue comp (stereo-linked) → saturation (2× midpoint, CURVE adds even harmonics, DC-blocked) → level (fader law) → limiter (MODE < 0.5) or tanh clip, then a hard clamp at the ceiling.

- [ ] **Step 1: Write the failing tests** in `crates/core/src/master.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::TAU;

    const SR: f32 = 48_000.0;

    fn master(edits: &[(usize, f32)]) -> Master {
        let mut m = Master::new(SR);
        for &(i, v) in edits {
            m.params.set_norm(i, v);
        }
        for _ in 0..4_800 {
            m.params.advance();
            m.process(0.0, 0.0);
        }
        m
    }

    fn sine(freq: f32, amp: f32, i: usize) -> f32 {
        amp * (TAU * freq * i as f32 / SR).sin()
    }

    fn neutral() -> Master {
        master(&[(COMP, 0.0), (SAT, 0.0), (LOW_CUT, 0.0), (TILT, 0.5), (LEVEL, 0.8), (CEILING, 1.0), (MODE, 0.0)])
    }

    #[test]
    fn neutral_settings_are_transparent() {
        let mut m = neutral();
        let mut sum_in = 0.0;
        let mut sum_out = 0.0;
        for i in 0..48_000 {
            let x = sine(1_000.0, 0.25, i);
            let (y, _) = m.process(x, x);
            if i > 9_600 {
                sum_in += x * x;
                sum_out += y * y;
            }
        }
        let ratio = (sum_out / sum_in as f32).sqrt();
        assert!((0.98..1.02).contains(&ratio), "{ratio}");
    }

    #[test]
    fn limiter_holds_the_ceiling() {
        for mode in [0.0, 1.0] {
            let mut m = master(&[(MODE, mode)]);
            let ceiling = db_to_gain(-0.3);
            for i in 0..48_000 {
                let x = sine(80.0, 4.0, i);
                let (l, r) = m.process(x, -x);
                assert!(l.abs() <= ceiling + 1e-6 && r.abs() <= ceiling + 1e-6, "mode {mode}: {l}");
            }
        }
    }

    #[test]
    fn compressor_reduces_loud_input() {
        let mut m = master(&[(COMP, 1.0)]);
        for i in 0..24_000 {
            let x = sine(200.0, 1.0, i);
            m.process(x, x);
        }
        assert!(m.gr_db() > 6.0, "{}", m.gr_db());
    }

    #[test]
    fn lufs_reads_minus_20_for_a_minus_20_dbfs_sine() {
        let mut m = neutral();
        let a = db_to_gain(-20.0);
        for i in 0..8 * 48_000 {
            let x = sine(997.0, a, i);
            m.process(x, x);
        }
        assert!((m.lufs() + 20.0).abs() < 1.0, "{}", m.lufs());
    }

    #[test]
    fn silence_reads_the_floor() {
        let mut m = neutral();
        for _ in 0..48_000 {
            m.process(0.0, 0.0);
        }
        assert_eq!(m.lufs(), -70.0);
    }

    #[test]
    fn extreme_params_stay_finite_and_bounded() {
        for norm in [0.0_f32, 1.0] {
            let edits: Vec<(usize, f32)> = (0..MASTER_PARAM_COUNT).map(|i| (i, norm)).collect();
            let mut m = master(&edits);
            let ceiling = db_to_gain(MASTER_PARAMS[CEILING].map(norm));
            let mut rng = crate::rng::Rng::new(9);
            for _ in 0..48_000 {
                let (l, r) = m.process(rng.bipolar() * 3.0, rng.bipolar() * 3.0);
                assert!(l.is_finite() && r.is_finite());
                assert!(l.abs() <= ceiling + 1e-6 && r.abs() <= ceiling + 1e-6);
            }
        }
    }

    #[test]
    fn non_finite_input_is_dropped() {
        let mut m = neutral();
        assert_eq!(m.process(f32::NAN, 0.0), (0.0, 0.0));
        let (l, _) = m.process(0.1, 0.1);
        assert!(l.is_finite());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core master`
Expected: compile errors.

- [ ] **Step 3: Implement** (above the tests)

```rust
use crate::bus::fader_gain;
use crate::dsp::{db_to_gain, gain_to_db, Biquad, OnePole, Svf};
use crate::params::{Curve, ParamBank, ParamDesc};

pub const COMP: usize = 0;
pub const ATTACK: usize = 1;
pub const RELEASE: usize = 2;
pub const MIX: usize = 3;
pub const SAT: usize = 4;
pub const CURVE: usize = 5;
pub const TILT: usize = 6;
pub const LOW_CUT: usize = 7;
pub const CEILING: usize = 8;
pub const MODE: usize = 9;
pub const LEVEL: usize = 10;
pub const MASTER_PARAM_COUNT: usize = 11;

/// Order and default_norm are mirrored in web/src/state/machines.ts.
pub const MASTER_PARAMS: [ParamDesc; MASTER_PARAM_COUNT] = [
    // one knob: threshold 0 → −24 dB, ratio 1:1 → 4:1, half-compensated makeup
    ParamDesc { name: "COMP", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    ParamDesc { name: "ATK", min: 0.1, max: 30.0, default_norm: 0.6, curve: Curve::Exp },
    ParamDesc { name: "REL", min: 30.0, max: 1000.0, default_norm: 0.5, curve: Curve::Exp },
    ParamDesc { name: "MIX", min: 0.0, max: 1.0, default_norm: 1.0, curve: Curve::Lin },
    ParamDesc { name: "SAT", min: 0.0, max: 1.0, default_norm: 0.1, curve: Curve::Lin },
    ParamDesc { name: "CURVE", min: 0.0, max: 1.0, default_norm: 0.5, curve: Curve::Lin },
    // 0.5 = flat, 0 = −6 dB highs / +6 dB lows, 1 = the opposite
    ParamDesc { name: "TILT", min: 0.0, max: 1.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "LOW CUT", min: 10.0, max: 150.0, default_norm: 0.0, curve: Curve::Exp },
    ParamDesc { name: "CEIL", min: -12.0, max: 0.0, default_norm: 0.975, curve: Curve::Lin },
    // < 0.5 limiter, ≥ 0.5 soft clip
    ParamDesc { name: "MODE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.8, curve: Curve::Lin },
];

const TILT_HZ: f32 = 800.0;
const LIMIT_RELEASE_S: f32 = 0.05;
/// BS.1770 K-weighting at 48 kHz (pre-filter shelf, then RLB high-pass).
const K1: Biquad = Biquad::new(1.535_124_9, -2.691_696_2, 1.198_392_8, -1.690_659_3, 0.732_480_8);
const K2: Biquad = Biquad::new(1.0, -2.0, 1.0, -1.990_047_5, 0.990_072_25);

fn time_coef(seconds: f32, sample_rate: f32) -> f32 {
    1.0 - (-1.0 / (seconds * sample_rate)).exp()
}

pub struct Master {
    pub params: ParamBank,
    sample_rate: f32,
    low_cut: [Svf; 2],
    tilt: [OnePole; 2],
    tilt_coef: f32,
    gr_db: f32,
    sat_prev: [f32; 2],
    dc: [OnePole; 2],
    dc_coef: f32,
    lim_gain: f32,
    lim_rel: f32,
    k1: [Biquad; 2],
    k2: [Biquad; 2],
    ms: [f32; 2],
    lufs_coef: f32,
    peak: [f32; 2],
    peak_decay: f32,
}

impl Master {
    pub fn new(sample_rate: f32) -> Self {
        Master {
            params: ParamBank::new(&MASTER_PARAMS, sample_rate),
            sample_rate,
            low_cut: [Svf::new(); 2],
            tilt: [OnePole::default(); 2],
            tilt_coef: 1.0 - (-core::f32::consts::TAU * TILT_HZ / sample_rate).exp(),
            gr_db: 0.0,
            sat_prev: [0.0; 2],
            dc: [OnePole::default(); 2],
            dc_coef: 1.0 - (-core::f32::consts::TAU * 5.0 / sample_rate).exp(),
            lim_gain: 1.0,
            lim_rel: time_coef(LIMIT_RELEASE_S, sample_rate),
            k1: [K1; 2],
            k2: [K2; 2],
            ms: [0.0; 2],
            lufs_coef: time_coef(1.5, sample_rate),
            peak: [0.0; 2],
            peak_decay: (-1.0 / (0.3 * sample_rate)).exp(),
        }
    }

    pub fn gr_db(&self) -> f32 {
        self.gr_db
    }

    pub fn peak(&self, channel: usize) -> f32 {
        self.peak.get(channel).copied().unwrap_or(0.0)
    }

    /// Short-term loudness (≈ 1.5 s exponential window instead of BS.1770's 3 s box).
    pub fn lufs(&self) -> f32 {
        let power = self.ms[0] + self.ms[1];
        if power <= 1.0e-10 {
            -70.0
        } else {
            (-0.691 + 10.0 * power.log10()).max(-70.0)
        }
    }

    fn saturate(&mut self, c: usize, x: f32, amount: f32, curve: f32) -> f32 {
        let mid = 0.5 * (self.sat_prev[c] + x);
        self.sat_prev[c] = x;
        if amount <= 0.0 {
            return x;
        }
        let g = 1.0 + amount.min(1.0) * 4.0;
        let bias = curve * 0.3;
        let norm = g.tanh();
        let shape = |v: f32| ((v + bias * v * v) * g).tanh() / norm;
        let y = 0.5 * (shape(mid) + shape(x));
        y - self.dc[c].lp(y, self.dc_coef)
    }

    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        if !(l.is_finite() && r.is_finite()) {
            return (0.0, 0.0);
        }
        let sr = self.sample_rate;
        let p = &self.params;
        let low_cut = p.get(LOW_CUT);
        let tilt = (p.get(TILT) - 0.5) * 2.0;
        let (low_gain, high_gain) = (db_to_gain(-6.0 * tilt), db_to_gain(6.0 * tilt));
        let amount = p.get(COMP);
        let (attack, release, mix) = (p.get(ATTACK), p.get(RELEASE), p.get(MIX));
        let (sat, curve) = (p.get(SAT), p.get(CURVE));
        let level = fader_gain(p.get(LEVEL));
        let ceiling = db_to_gain(p.get(CEILING));
        let clip = p.get(MODE) >= 0.5;

        // 1) low cut + tilt
        let mut x = [l, r];
        for c in 0..2 {
            let hp = self.low_cut[c].process(x[c], low_cut, 1.414, sr).hp;
            let low = self.tilt[c].lp(hp, self.tilt_coef);
            x[c] = low * low_gain + (hp - low) * high_gain;
        }

        // 2) glue compressor, stereo-linked peak detector in dB
        let threshold = -24.0 * amount;
        let ratio = 1.0 + 3.0 * amount;
        let over = gain_to_db(x[0].abs().max(x[1].abs())) - threshold;
        let target = if over > 0.0 { over * (1.0 - 1.0 / ratio) } else { 0.0 };
        let coef = if target > self.gr_db { time_coef(attack * 0.001, sr) } else { time_coef(release * 0.001, sr) };
        self.gr_db += (target - self.gr_db) * coef;
        let makeup = -threshold * (1.0 - 1.0 / ratio) * 0.5;
        let comp_gain = db_to_gain(makeup - self.gr_db);

        // 3) saturation, 4) level
        for (c, v) in x.iter_mut().enumerate() {
            *v += (*v * comp_gain - *v) * mix;
            *v = self.saturate(c, *v, sat, curve) * level;
        }

        // 5) limiter or soft clip to the ceiling
        if clip {
            for v in &mut x {
                *v = ceiling * (*v / ceiling).tanh();
            }
        } else {
            let peak = x[0].abs().max(x[1].abs());
            let need = if peak > ceiling { ceiling / peak } else { 1.0 };
            if need < self.lim_gain {
                self.lim_gain = need;
            } else {
                self.lim_gain += (1.0 - self.lim_gain) * self.lim_rel;
            }
            for v in &mut x {
                *v *= self.lim_gain;
            }
        }
        for c in 0..2 {
            x[c] = x[c].clamp(-ceiling, ceiling);
            let k = self.k2[c].process(self.k1[c].process(x[c]));
            self.ms[c] += (k * k - self.ms[c]) * self.lufs_coef;
            let a = x[c].abs();
            self.peak[c] = if a > self.peak[c] { a } else { self.peak[c] * self.peak_decay };
        }
        (x[0], x[1])
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core master`
Expected: 7 passed, no warnings. If a test fails because of a number in this plan, report BLOCKED with measured values.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/master.rs
git commit -m "feat(core): add master chain with glue comp, saturation, tilt, limiter and lufs

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 9: Engine: machines, rows, buses, master, snapshot v3

**Files:**
- Modify: `crates/core/src/modulation.rs` (constants), `crates/core/src/engine.rs` (replace everything above `#[cfg(test)]`, update and append tests)

**Interfaces:**
- Consumes everything from Tasks 2–8.
- Produces in `modulation.rs`:
  - `MOD_TRACKS` is renamed `MOD_ROWS = 22`, and `MOD_PARAMS = 24`.
  - Route validation uses them; `sums` is `[[f32; MOD_PARAMS]; MOD_ROWS]`.
- Produces in `engine.rs`:
  - Constants:
    - `TRACKS = 13`, `ROWS = 22`, `MASTER_ROW = 21`, `SUB_TRACK = 7`, `MID_TRACK = 8`
    - `TRACK_BUS: [usize; 13] = [0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6]`
    - Snapshot: `SNAP_TICK = 0`, `SNAP_PLAYHEADS = 1`, `SNAP_MODS = 14`, `SNAP_EFFECTIVE = 30`, `SNAP_METERS = 558`, `SNAP_MUTED = 578`, `SNAP_LEN = 586`
  - `Engine::set_param(row, param, norm)` addresses rows; bad rows and params are ignored.
  - New methods:
    - `set_bus_mute(bus, muted: bool, quantized: bool)`
    - `bus_muted(bus) -> bool`
    - `track_active(track) -> bool`
  - `effective_norm(row, param)` returns −1 for an unknown row, or for a param ≥ that row's count.
  - Existing methods are unchanged.

- [ ] **Step 1: Update modulation constants.** In `modulation.rs`, rename `MOD_TRACKS` to `MOD_ROWS` (value 22) and set `MOD_PARAMS` to 24. Change every use (`set_route` validation, `sums` type). Run `cargo test -p utero-core modulation` — it must stay green.

- [ ] **Step 2: Write the failing tests.** In `engine.rs` `mod tests`:
  - In `snapshot_mirrors_engine_state`, change `assert_eq!(SNAP_LEN, 238);` to `assert_eq!(SNAP_LEN, 586);`
  - Append:

```rust
    use crate::bus;
    use crate::dsp::db_to_gain;
    use crate::master;
    use crate::mid;
    use crate::sub;

    fn bass_step(e: &mut Engine, track: usize, note: u8) {
        e.set_step(track, 0, Step { trig: true, note, ..Step::default() });
    }

    #[test]
    fn sub_plays_its_note_through_the_bass_bus() {
        let mut e = Engine::new(48_000.0);
        bass_step(&mut e, SUB_TRACK, 41);
        e.play();
        let out = render_seconds(&mut e, 0.5);
        assert!(rms(&out) > 0.05, "{}", rms(&out));
    }

    #[test]
    fn muting_the_kick_bus_silences_the_kick() {
        let mut e = Engine::new(48_000.0);
        quarter_kick(&mut e);
        e.set_bus_mute(0, true, false);
        e.play();
        let out = render_seconds(&mut e, 0.5);
        assert!(rms(&out[2_400..]) < 1e-3);
    }

    #[test]
    fn quantized_mute_waits_for_the_next_bar() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0); // one bar = 2 s = 96 000 samples
        quarter_kick(&mut e);
        e.play();
        render_seconds(&mut e, 0.25);
        e.set_bus_mute(0, true, true);
        assert!(!e.bus_muted(0));
        render_seconds(&mut e, 1.5);
        assert!(!e.bus_muted(0));
        render_seconds(&mut e, 0.5);
        assert!(e.bus_muted(0));
    }

    #[test]
    fn quantized_mute_while_stopped_is_immediate() {
        let mut e = Engine::new(48_000.0);
        e.set_bus_mute(3, true, true);
        assert!(e.bus_muted(3));
        e.set_bus_mute(3, false, true);
        assert!(!e.bus_muted(3));
    }

    #[test]
    fn linked_mid_follows_the_sub() {
        for (link, expect) in [(0.0, false), (1.0, true)] {
            let mut e = Engine::new(48_000.0);
            e.set_param(MID_TRACK, mid::LINK, link);
            bass_step(&mut e, SUB_TRACK, 41);
            render_seconds(&mut e, 0.05); // let the LINK norm settle before the first trig
            e.play();
            render_seconds(&mut e, 0.05);
            assert_eq!(e.track_active(MID_TRACK), expect);
        }
    }

    #[test]
    fn direct_sub_bypasses_the_bass_bus_filter() {
        let level = |route: f32| {
            let mut e = Engine::new(48_000.0);
            e.set_param(TRACKS + 3, bus::FILTER, 0.0);
            e.set_param(SUB_TRACK, sub::ROUTE, route);
            bass_step(&mut e, SUB_TRACK, 41);
            e.play();
            rms(&render_seconds(&mut e, 0.5)[4_800..])
        };
        assert!(level(1.0) > 2.0 * level(0.0));
    }

    #[test]
    fn limiter_holds_the_ceiling_under_heavy_modulation() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 0);
        for (i, (row, param)) in [(0, 8), (1, 8), (TRACKS, bus::LEVEL), (MASTER_ROW, master::LEVEL), (MASTER_ROW, master::SAT)].into_iter().enumerate() {
            e.set_route(i, route(0, row as u8, param as u8, 1.0));
        }
        quarter_kick(&mut e);
        bass_step(&mut e, SUB_TRACK, 41);
        e.play();
        let ceiling = db_to_gain(-0.3) + 1e-6;
        let mut out = Vec::new();
        for _ in 0..375 {
            e.process(BLOCK);
            out.extend_from_slice(&e.out_l);
            out.extend_from_slice(&e.out_r);
        }
        assert!(out.iter().all(|s| s.abs() <= ceiling));
    }

    #[test]
    fn bus_and_master_rows_accept_modulation() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 0);
        e.set_route(0, route(0, MASTER_ROW as u8, master::LEVEL as u8, -0.3));
        render_seconds(&mut e, 0.3);
        assert!((e.effective_norm(MASTER_ROW, master::LEVEL) - 0.5).abs() < 0.01);
    }

    #[test]
    fn bad_rows_are_ignored() {
        let mut e = Engine::new(48_000.0);
        e.set_param(99, 0, 0.5);
        e.set_param(TRACKS, 99, 0.5);
        e.set_bus_mute(99, true, false);
        assert_eq!(e.effective_norm(ROWS, 0), -1.0);
        assert_eq!(e.effective_norm(5, 0), -1.0);
        assert_eq!(e.effective_norm(TRACKS, bus::BUS_PARAM_COUNT), -1.0);
        assert!(!e.bus_muted(99));
        assert!(!e.track_active(99));
    }

    #[test]
    fn snapshot_carries_meters_and_mutes() {
        let mut e = Engine::new(48_000.0);
        quarter_kick(&mut e);
        e.set_bus_mute(2, true, false);
        e.play();
        render_seconds(&mut e, 0.5);
        assert!(e.snapshot[SNAP_METERS] > 0.0, "kick bus peak");
        assert_eq!(e.snapshot[SNAP_MUTED + 2], 1.0);
        assert!(e.snapshot[SNAP_METERS + 2 * bus::BUSES + 2] > -70.0, "master lufs");
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core engine`
Expected: compile errors (`SUB_TRACK`, `set_bus_mute`, … not found).

- [ ] **Step 4: Replace everything above `#[cfg(test)]` in `engine.rs`**

```rust
use crate::bus::{Bus, BUSES};
use crate::kick::{kick_params, KickVoice};
use crate::macros::{MacroTarget, Macros};
use crate::master::Master;
use crate::mid::{is_linked, mid_params, MidVoice};
use crate::modulation::{ModMatrix, ModSettings, Route, MOD_PARAMS, MOD_ROWS, MOD_SLOTS};
use crate::params::{ParamBank, MAX_PARAMS};
use crate::rng::Rng;
use crate::seq::{CondCtx, Step, Track, Trig};
use crate::sub::{is_direct, sub_params, SubVoice};
use crate::transport::{Transport, PPQN};

pub const BLOCK: usize = 128;
pub const TRACKS: usize = 13;
/// Parameter rows: 0–12 tracks, 13–20 buses, 21 master (also the modulation/macro target rows).
pub const ROWS: usize = TRACKS + BUSES + 1;
pub const MASTER_ROW: usize = TRACKS + BUSES;
pub const SUB_TRACK: usize = 7;
pub const MID_TRACK: usize = 8;
/// KICK·KCK2 → KICK, HH·OH → HATS, SNR·NOIS·SMPL → PERC, SUB·MID → BASS, LD1·LD2 → LEAD, PAD, ORN; bus 7 = FX RTN.
pub const TRACK_BUS: [usize; TRACKS] = [0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6];
const BAR_TICKS: u64 = PPQN * 4;

/// Snapshot layout, mirrored in web/src/audio/snapshot.ts.
pub const SNAP_TICK: usize = 0;
pub const SNAP_PLAYHEADS: usize = 1;
pub const SNAP_MODS: usize = SNAP_PLAYHEADS + TRACKS;
pub const SNAP_EFFECTIVE: usize = SNAP_MODS + MOD_SLOTS;
/// Per bus: peak, rms; then master: peak L, peak R, short-term LUFS, gain reduction dB.
pub const SNAP_METERS: usize = SNAP_EFFECTIVE + ROWS * MOD_PARAMS;
pub const SNAP_MUTED: usize = SNAP_METERS + BUSES * 2 + 4;
pub const SNAP_LEN: usize = SNAP_MUTED + BUSES;

const _: () = assert!(ROWS == MOD_ROWS && MAX_PARAMS == MOD_PARAMS);

enum Voice {
    None,
    Kick(KickVoice),
    Sub(SubVoice),
    Mid(MidVoice),
}

struct Machine {
    voice: Voice,
    params: ParamBank,
}

impl Machine {
    fn for_track(t: usize, sample_rate: f32) -> Self {
        match t {
            0 | 1 => Machine { voice: Voice::Kick(KickVoice::new(sample_rate, 0x00C0_FFEE + t as u32)), params: kick_params(sample_rate) },
            SUB_TRACK => Machine { voice: Voice::Sub(SubVoice::new(sample_rate)), params: sub_params(sample_rate) },
            MID_TRACK => Machine { voice: Voice::Mid(MidVoice::new(sample_rate, 0x000B_A55E)), params: mid_params(sample_rate) },
            _ => Machine { voice: Voice::None, params: ParamBank::new(&[], sample_rate) },
        }
    }

    fn is_active(&self) -> bool {
        match &self.voice {
            Voice::Kick(v) => v.is_active(),
            Voice::Sub(v) => v.is_active(),
            Voice::Mid(v) => v.is_active(),
            Voice::None => false,
        }
    }
}

pub struct Engine {
    pub out_l: [f32; BLOCK],
    pub out_r: [f32; BLOCK],
    pub snapshot: [f32; SNAP_LEN],
    sample_rate: f32,
    transport: Transport,
    tracks: [Track; TRACKS],
    machines: [Machine; TRACKS],
    buses: [Bus; BUSES],
    master: Master,
    effective: [[f32; MAX_PARAMS]; ROWS],
    pending_mute: [Option<bool>; BUSES],
    mods: ModMatrix,
    macros: Macros,
    rng: Rng,
    fill: bool,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        let mut e = Engine {
            out_l: [0.0; BLOCK],
            out_r: [0.0; BLOCK],
            snapshot: [0.0; SNAP_LEN],
            sample_rate,
            transport: Transport::new(sample_rate),
            tracks: [Track::new(); TRACKS],
            machines: core::array::from_fn(|t| Machine::for_track(t, sample_rate)),
            buses: core::array::from_fn(|_| Bus::new(sample_rate)),
            master: Master::new(sample_rate),
            effective: [[0.0; MAX_PARAMS]; ROWS],
            pending_mute: [None; BUSES],
            mods: ModMatrix::new(),
            macros: Macros::new(sample_rate),
            rng: Rng::new(0x5EED),
            fill: false,
        };
        for row in 0..ROWS {
            if let Some(defaults) = e.bank(row).map(|b| b.defaults()) {
                e.effective[row] = defaults;
            }
        }
        e
    }

    fn bank(&self, row: usize) -> Option<&ParamBank> {
        match row {
            r if r < TRACKS => Some(&self.machines[r].params),
            r if r < MASTER_ROW => Some(&self.buses[r - TRACKS].params),
            MASTER_ROW => Some(&self.master.params),
            _ => None,
        }
    }

    fn bank_mut(&mut self, row: usize) -> Option<&mut ParamBank> {
        match row {
            r if r < TRACKS => Some(&mut self.machines[r].params),
            r if r < MASTER_ROW => Some(&mut self.buses[r - TRACKS].params),
            MASTER_ROW => Some(&mut self.master.params),
            _ => None,
        }
    }

    pub fn play(&mut self) {
        for t in &mut self.tracks {
            t.reset();
        }
        self.mods.restart();
        self.transport.play();
    }

    pub fn stop(&mut self) {
        self.transport.stop();
    }

    pub fn set_bpm(&mut self, bpm: f32) {
        self.transport.set_bpm(bpm as f64);
    }

    pub fn set_fill(&mut self, on: bool) {
        self.fill = on;
    }

    pub fn set_step(&mut self, track: usize, index: usize, step: Step) {
        if let Some(t) = self.tracks.get_mut(track) {
            t.set_step(index, step);
        }
    }

    pub fn set_length(&mut self, track: usize, len: u8) {
        if let Some(t) = self.tracks.get_mut(track) {
            t.set_length(len);
        }
    }

    pub fn set_speed(&mut self, track: usize, code: u8) {
        if let Some(t) = self.tracks.get_mut(track) {
            t.set_speed(code);
        }
    }

    /// `row` 0–12 = track machine, 13–20 = bus, 21 = master.
    pub fn set_param(&mut self, row: usize, param: usize, norm: f32) {
        if let Some(bank) = self.bank_mut(row) {
            bank.set_norm(param, norm);
        }
    }

    /// A quantized change while playing waits for the next bar; stopped, it applies at once.
    pub fn set_bus_mute(&mut self, bus: usize, muted: bool, quantized: bool) {
        if bus >= BUSES {
            return;
        }
        if quantized && self.transport.is_playing() {
            self.pending_mute[bus] = Some(muted);
        } else {
            self.pending_mute[bus] = None;
            self.buses[bus].set_muted(muted);
        }
    }

    pub fn bus_muted(&self, bus: usize) -> bool {
        self.buses.get(bus).is_some_and(|b| b.muted())
    }

    pub fn track_active(&self, track: usize) -> bool {
        self.machines.get(track).is_some_and(|m| m.is_active())
    }

    pub fn set_modulator(&mut self, slot: usize, s: ModSettings) {
        self.mods.set_modulator(slot, s);
    }

    pub fn set_mod_step(&mut self, slot: usize, i: usize, v: f32) {
        self.mods.set_step(slot, i, v);
    }

    pub fn set_mod_step_len(&mut self, slot: usize, len: u8) {
        self.mods.set_step_len(slot, len);
    }

    pub fn set_route(&mut self, index: usize, route: Route) {
        self.mods.set_route(index, route);
    }

    pub fn clear_route(&mut self, index: usize) {
        self.mods.clear_route(index);
    }

    pub fn set_macro_target(&mut self, m: usize, i: usize, t: MacroTarget) {
        self.macros.set_target(m, i, t);
    }

    pub fn clear_macro_target(&mut self, m: usize, i: usize) {
        self.macros.clear_target(m, i);
    }

    pub fn set_macro_pos(&mut self, m: usize, pos: f32) {
        self.macros.set_pos(m, pos);
    }

    pub fn mod_output(&self, slot: usize) -> f32 {
        self.mods.output(slot)
    }

    pub fn effective_norm(&self, row: usize, param: usize) -> f32 {
        match self.bank(row) {
            Some(b) if param < b.count() => self.effective[row][param],
            _ => -1.0,
        }
    }

    pub fn playhead(&self, track: usize) -> i32 {
        self.tracks.get(track).map_or(-1, |t| t.playhead() as i32)
    }

    pub fn ticks(&self) -> u64 {
        self.transport.ticks()
    }

    /// base (smoothed) → macro override → + modulation → clamp; records the effective norms of `row`.
    fn resolve(&mut self, row: usize) -> [f32; MAX_PARAMS] {
        let Some(bank) = self.bank_mut(row) else { return [0.0; MAX_PARAMS] };
        let count = bank.count();
        let mut norms = bank.next_norms();
        self.macros.apply(row as u8, &mut norms[..count]);
        for (p, v) in norms.iter_mut().enumerate().take(count) {
            *v = (*v + self.mods.sum(row, p)).clamp(0.0, 1.0);
        }
        self.effective[row] = norms;
        norms
    }

    pub fn process(&mut self, frames: usize) {
        let bpm = self.transport.bpm() as f32;
        for i in 0..frames.min(BLOCK) {
            if let Some(tick) = self.transport.tick() {
                self.on_tick(tick);
            }
            self.mods.advance(bpm, self.sample_rate);
            self.macros.advance();

            let mut bus_in = [0.0_f32; BUSES];
            let mut bus_post = [0.0_f32; BUSES];
            for t in 0..TRACKS {
                if matches!(self.machines[t].voice, Voice::None) {
                    continue;
                }
                let norms = self.resolve(t);
                let Machine { voice, params } = &mut self.machines[t];
                params.apply_norms(&norms);
                let y = match voice {
                    Voice::Kick(v) => v.render(params),
                    Voice::Sub(v) => v.render(params),
                    Voice::Mid(v) => v.render(params),
                    Voice::None => 0.0,
                };
                let b = TRACK_BUS[t];
                if t == SUB_TRACK && is_direct(params) {
                    bus_post[b] += y;
                } else {
                    bus_in[b] += y;
                }
            }

            let (mut mix_l, mut mix_r) = (0.0, 0.0);
            for b in 0..BUSES {
                let norms = self.resolve(TRACKS + b);
                self.buses[b].params.apply_norms(&norms);
                let (l, r) = self.buses[b].process(bus_in[b], bus_in[b], bus_post[b], bus_post[b]);
                mix_l += l;
                mix_r += r;
            }

            let norms = self.resolve(MASTER_ROW);
            self.master.params.apply_norms(&norms);
            let (l, r) = self.master.process(mix_l, mix_r);
            self.out_l[i] = if l.is_finite() { l } else { 0.0 };
            self.out_r[i] = if r.is_finite() { r } else { 0.0 };
        }
        self.write_snapshot();
    }

    fn write_snapshot(&mut self) {
        self.snapshot[SNAP_TICK] = self.transport.ticks() as f32;
        for t in 0..TRACKS {
            self.snapshot[SNAP_PLAYHEADS + t] = self.tracks[t].playhead() as f32;
        }
        for m in 0..MOD_SLOTS {
            self.snapshot[SNAP_MODS + m] = self.mods.output(m);
        }
        for row in 0..ROWS {
            let base = SNAP_EFFECTIVE + row * MOD_PARAMS;
            self.snapshot[base..base + MOD_PARAMS].copy_from_slice(&self.effective[row]);
        }
        for b in 0..BUSES {
            self.snapshot[SNAP_METERS + 2 * b] = self.buses[b].peak();
            self.snapshot[SNAP_METERS + 2 * b + 1] = self.buses[b].rms();
            self.snapshot[SNAP_MUTED + b] = if self.buses[b].muted() { 1.0 } else { 0.0 };
        }
        let m = SNAP_METERS + 2 * BUSES;
        self.snapshot[m] = self.master.peak(0);
        self.snapshot[m + 1] = self.master.peak(1);
        self.snapshot[m + 2] = self.master.lufs();
        self.snapshot[m + 3] = self.master.gr_db();
    }

    fn on_tick(&mut self, tick: u64) {
        if tick % BAR_TICKS == 0 {
            for b in 0..BUSES {
                if let Some(m) = self.pending_mute[b].take() {
                    self.buses[b].set_muted(m);
                }
            }
        }
        let mut neighbor = false;
        for t in 0..TRACKS {
            let mut ctx = CondCtx { fill: self.fill, neighbor, rng: &mut self.rng };
            if let Some(trig) = self.tracks[t].on_tick(tick, &mut ctx) {
                self.trigger(t, trig);
                self.mods.on_track_trigger(t);
            }
            neighbor = self.tracks[t].last_cond();
        }
    }

    fn trigger(&mut self, t: usize, trig: Trig) {
        let linked = is_linked(&self.machines[MID_TRACK].params);
        let Machine { voice, params } = &mut self.machines[t];
        match voice {
            Voice::Kick(v) => v.trigger(trig.vel, &mut self.rng),
            Voice::Sub(v) => v.trigger(trig.vel, trig.note, params, &mut self.rng),
            Voice::Mid(v) if !linked => v.trigger(trig.vel, trig.note, params, &mut self.rng),
            _ => {}
        }
        // LINK: MID plays SUB's notes instead of its own steps.
        if t == SUB_TRACK && linked {
            let Machine { voice, params } = &mut self.machines[MID_TRACK];
            if let Voice::Mid(v) = voice {
                v.trigger(trig.vel, trig.note, params, &mut self.rng);
            }
        }
    }
}
```

Keep the test-module helpers. If `square()` or `route()` were defined inside the 1b test additions, reuse them, and don't duplicate.

- [ ] **Step 5: Run all core tests and the benchmarks**

Run: `source "$HOME/.cargo/env" && cargo test && cargo test -p utero-core --release --test render -- --ignored --nocapture`
Expected: everything passes with no warnings. Record both benchmark times in the report; each must stay under 2.5 s per 10 s.

- [ ] **Step 6: Commit**

```bash
git add crates/core/src/modulation.rs crates/core/src/engine.rs
git commit -m "feat(core): route machines through buses and master with rows and snapshot v3

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 10: WASM + TS plumbing for buses, mutes and snapshot v3

**Files:**
- Modify: `crates/wasm/src/lib.rs`, `web/src/audio/exports.ts`, `web/src/audio/ops.ts`, `web/src/audio/dispatch.ts`, `web/src/audio/snapshot.ts`
- Tests: `web/src/audio/dispatch.test.ts`, `web/src/audio/wasm.test.ts`

**Interfaces:**
- Produces:
  - Wasm `utero_set_bus_mute(bus: u32, muted: u32, quantized: u32)`.
  - TS `Op.SetBusMute = 17` and `cmdSetBusMute(bus, muted: boolean, quantized: boolean) => [17, bus, muted ? 1 : 0, quantized ? 1 : 0]`.
  - `snapshot.ts` constants: `SNAP_TRACKS = 13`, `SNAP_BUSES = 8`, `SNAP_ROWS = 22`, `SNAP_MOD_SLOTS = 16`, `SNAP_PARAMS = 24`, `SNAP_PLAYHEADS = 1`, `SNAP_MODS = 14`, `SNAP_EFFECTIVE = 30`, `SNAP_METERS = 558`, `SNAP_MUTED = 578`, `SNAP_FLOATS = 586`.
  - `snapshot.ts` accessors:
    - `playheadOf(snap, t)`, `modOutputOf(snap, slot)`, `effectiveOf(snap, row, p)`
    - `busMeterOf(snap, b) -> { peak, rms }`
    - `masterMeterOf(snap) -> { peakL, peakR, lufs, gr }`
    - `busMutedOf(snap, b) -> boolean`

- [ ] **Step 1: Write the failing tests**

`dispatch.test.ts`:
- add `utero_set_bus_mute: rec('set_bus_mute'),` to the fake
- add `cmdSetBusMute(3, true, false)` at the end of the command list (import it)
- add `['set_bus_mute', [3, 1, 0]]` at the end of the expected calls

`wasm.test.ts`: change the snapshot import to `import { SNAP_EFFECTIVE, SNAP_FLOATS, SNAP_MUTED } from './snapshot'`, and append:
```ts
test('SUB plays a note through the BASS bus', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_step(7, 0, 1, 1, 100, 0, 1, 2, 0, 41)
  ex.utero_play()
  let peak = 0
  for (let i = 0; i < 100; i++) {
    ex.utero_process(128)
    const out = new Float32Array(ex.memory.buffer, ex.utero_out_l(), 128)
    peak = Math.max(peak, ...Array.from(out, Math.abs))
  }
  expect(peak).toBeGreaterThan(0.01)
})

test('bus mute reaches the snapshot', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_bus_mute(2, 1, 0)
  ex.utero_process(128)
  const snap = new Float32Array(ex.memory.buffer, ex.utero_snapshot(), SNAP_FLOATS)
  expect(snap[SNAP_MUTED + 2]).toBe(1)
  expect(snap[SNAP_MUTED + 1]).toBe(0)
})
```
In the garbage test add `ex.utero_set_bus_mute(99, 1, 1)` and `ex.utero_set_param(99, 0, 0.5)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cd web && source ~/.nvm/nvm.sh && npm run wasm && npx vitest run src/audio`
Expected: FAIL. The snapshot length is 586 vs the TS 238, `set_bus_mute` is not a function, and `cmdSetBusMute` is missing.

- [ ] **Step 3: Implement**

`crates/wasm/src/lib.rs`:
```rust
#[no_mangle]
pub extern "C" fn utero_set_bus_mute(bus: u32, muted: u32, quantized: u32) {
    eng().set_bus_mute(bus as usize, muted != 0, quantized != 0);
}
```

`exports.ts`: add `utero_set_bus_mute(bus: number, muted: number, quantized: number): void` to `EngineExports`.

`ops.ts`: add `SetBusMute: 17` to `Op`, plus
```ts
export const cmdSetBusMute = (bus: number, muted: boolean, quantized: boolean) => [Op.SetBusMute, bus, muted ? 1 : 0, quantized ? 1 : 0]
```

`dispatch.ts`: `case Op.SetBusMute: ex.utero_set_bus_mute(c[1], c[2], c[3]); break`

`snapshot.ts` (replace):
```ts
/** Layout mirrors SNAP_* in crates/core/src/engine.rs. */
export const SNAP_TRACKS = 13
export const SNAP_BUSES = 8
export const SNAP_ROWS = SNAP_TRACKS + SNAP_BUSES + 1
export const SNAP_MOD_SLOTS = 16
export const SNAP_PARAMS = 24
export const SNAP_PLAYHEADS = 1
export const SNAP_MODS = SNAP_PLAYHEADS + SNAP_TRACKS
export const SNAP_EFFECTIVE = SNAP_MODS + SNAP_MOD_SLOTS
export const SNAP_METERS = SNAP_EFFECTIVE + SNAP_ROWS * SNAP_PARAMS
export const SNAP_MUTED = SNAP_METERS + SNAP_BUSES * 2 + 4
export const SNAP_FLOATS = SNAP_MUTED + SNAP_BUSES

export const playheadOf = (snap: Float32Array, track: number) => snap[SNAP_PLAYHEADS + track]
export const modOutputOf = (snap: Float32Array, slot: number) => snap[SNAP_MODS + slot]
export const effectiveOf = (snap: Float32Array, row: number, param: number) => snap[SNAP_EFFECTIVE + row * SNAP_PARAMS + param]
export const busMeterOf = (snap: Float32Array, bus: number) => ({ peak: snap[SNAP_METERS + 2 * bus], rms: snap[SNAP_METERS + 2 * bus + 1] })
export const masterMeterOf = (snap: Float32Array) => {
  const m = SNAP_METERS + SNAP_BUSES * 2
  return { peakL: snap[m], peakR: snap[m + 1], lufs: snap[m + 2], gr: snap[m + 3] }
}
export const busMutedOf = (snap: Float32Array, bus: number) => snap[SNAP_MUTED + bus] >= 0.5
```

- [ ] **Step 4: Run all tests**

Run: `source "$HOME/.cargo/env" && cargo test && cd web && npm run wasm && npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add crates/wasm/src/lib.rs web/src/audio/exports.ts web/src/audio/ops.ts web/src/audio/dispatch.ts web/src/audio/snapshot.ts web/src/audio/dispatch.test.ts web/src/audio/wasm.test.ts
git commit -m "feat(wasm): bus mute command and snapshot v3 with meters

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 11: Store: machines, rows, buses, master, mute, notes

**Files:**
- Create: `web/src/state/machines.ts`, `web/src/state/machines.test.ts`, `web/src/state/store.mix.test.ts`
- Modify: `web/src/state/types.ts`, `web/src/state/store.ts`, `web/src/state/store.test.ts`

**Interfaces:**
- Produces from `machines.ts`:
  - Param tables: `SUB_PARAMS`, `MID_PARAMS`, `BUS_PARAMS`, `MASTER_PARAMS` (all `ParamMeta[]`)
  - `MACHINES: (MachineDef | null)[]` (13 entries), where `MachineDef = { name: string; melodic: boolean; params: ParamMeta[]; pages: { name: string; params: number[] }[] }`
  - Row constants: `TRACK_COUNT = 13`, `BUS_COUNT = 8`, `BUS_NAMES`, `MASTER_ROW = 21`, `ROW_COUNT = 22`
  - Param index constants: `BUS_FILTER = 0`, `BUS_DRIVE = 1`, `BUS_LEVEL = 2`, `MASTER_MODE = 9`, `MASTER_LEVEL = 10`
  - Functions:
    - `busRow(b)`, `isMelodic(t)`, `rowParamMetas(row)`
    - `rowLabel(trackNames, row)` (track name / `'<BUS> BUS'` / `'MASTER'`)
    - `paramLabel(trackNames, row, p)`
    - `noteName(n)` (41 → `'F2'`)
    - `faderDb(norm)` (`'−∞'` or `'+0.0 dB'` style)
- Produces in `types.ts`:
  - `BusState { name: string; params: number[]; muted: boolean }`
  - `MasterState { params: number[] }`
  - `AppState` gains `buses: BusState[]`, `master: MasterState`, `muteQuantize: boolean`, `editMode: 'trig' | 'note'`
- Produces in `store.ts`:
  - `rowParams(state, row)`; `effectiveValue(state, row, p)` works on any row
  - `setParam(row, p, v)` works on any row. A param outside that row's table is ignored, and learn uses the row's base.
  - New actions: `setStepNote(t, s, note)`, `setEditMode(mode)`, `toggleMute(bus)` (sends the quantize flag only while playing), `setMuteQuantize(on)`
  - `syncAll` also sends every bus's params and mute state, and the master params.

- [ ] **Step 1: Write the failing tests**

`web/src/state/machines.test.ts`:
```ts
import { expect, test } from 'vitest'
import { BUS_PARAMS, faderDb, MACHINES, MASTER_PARAMS, MID_PARAMS, noteName, paramLabel, rowLabel, rowParamMetas, SUB_PARAMS } from './machines'

const names = ['KICK', 'KCK2', 'HH', 'OH', 'SNR', 'NOIS', 'SMPL', 'SUB', 'MID', 'LD1', 'LD2', 'PAD', 'ORN']

test('param tables mirror the engine', () => {
  expect(SUB_PARAMS.map((p) => p.default)).toEqual([0.5, 0, 0.1, 0, 0.6, 0.2, 0.8, 0])
  expect(MID_PARAMS.map((p) => p.default)).toEqual([0, 0.3, 0, 0.05, 0.2, 0.5, 0, 0, 0.45, 0.3, 0.5, 0.4, 0.2, 0.5, 0, 0.7, 0.5])
  expect(BUS_PARAMS.map((p) => p.default)).toEqual([0.5, 0, 0.8])
  expect(MASTER_PARAMS.map((p) => p.default)).toEqual([0.2, 0.6, 0.5, 1, 0.1, 0.5, 0.5, 0, 0.975, 0, 0.8])
})

test('machines sit on KICK, KCK2, SUB and MID', () => {
  expect(MACHINES.map((m) => m?.name ?? null)).toEqual(['ANALOG BD', 'ANALOG BD', null, null, null, null, null, 'SUB', 'MID BASS', null, null, null, null])
  expect(MACHINES[8]?.pages.map((p) => p.name)).toEqual(['SRC', 'FLTR', 'AMP'])
  expect(MACHINES[7]?.melodic).toBe(true)
  expect(MACHINES[0]?.melodic).toBe(false)
})

test('rows and labels', () => {
  expect(rowParamMetas(16)).toBe(BUS_PARAMS)
  expect(rowParamMetas(21)).toBe(MASTER_PARAMS)
  expect(rowParamMetas(5)).toEqual([])
  expect(rowLabel(names, 7)).toBe('SUB')
  expect(rowLabel(names, 16)).toBe('BASS BUS')
  expect(rowLabel(names, 21)).toBe('MASTER')
  expect(paramLabel(names, 13, 0)).toBe('KICK BUS.FLT')
})

test('note names and fader dB', () => {
  expect(noteName(41)).toBe('F2')
  expect(noteName(60)).toBe('C4')
  expect(noteName(61)).toBe('C#4')
  expect(faderDb(0)).toBe('−∞')
  expect(faderDb(0.8)).toBe('+0.0 dB')
  expect(faderDb(1)).toBe('+6.0 dB')
})
```

`web/src/state/store.mix.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { Op } from '@/audio/ops'
import { createStore, effectiveValue } from './store'

function connected() {
  const store = createStore()
  const sent: number[][] = []
  store.connect((c) => sent.push(c))
  return { store, sent }
}
const fresh = () => {
  const c = connected()
  c.sent.length = 0
  return c
}

describe('mixer state', () => {
  test('initial buses and master', () => {
    const s = createStore().getState()
    expect(s.buses.map((b) => b.name)).toEqual(['KICK', 'HATS', 'PERC', 'BASS', 'LEAD', 'PAD', 'ORN', 'FX'])
    expect(s.buses.every((b) => b.params.length === 3 && !b.muted)).toBe(true)
    expect(s.master.params).toHaveLength(11)
    expect(s.tracks[7].params).toHaveLength(8)
    expect(s.tracks[8].params).toHaveLength(17)
    expect([s.muteQuantize, s.editMode]).toEqual([true, 'trig'])
  })

  test('connect sends machine, bus and master params plus bus mutes', () => {
    const { sent } = connected()
    expect(sent.filter((c) => c[0] === Op.SetParam)).toHaveLength(9 * 2 + 8 + 17 + 8 * 3 + 11)
    expect(sent.filter((c) => c[0] === Op.SetBusMute)).toHaveLength(8)
  })

  test('setParam on a bus row updates that bus', () => {
    const { store, sent } = fresh()
    store.setParam(16, 0, 0.2)
    expect(store.getState().buses[3].params[0]).toBe(0.2)
    expect(sent).toEqual([[Op.SetParam, 16, 0, 0.2]])
  })

  test('setParam outside a row table is ignored', () => {
    const { store, sent } = fresh()
    store.setParam(5, 0, 0.2)
    store.setParam(13, 7, 0.2)
    expect(sent).toEqual([])
  })

  test('learn on the master row uses the master base', () => {
    const { store } = fresh()
    store.armLearn(0, 'a')
    store.setParam(21, 10, 0.3)
    expect(store.getState().macros[0].targets[0]).toEqual({ track: 21, param: 10, a: 0.3, b: 0.8, slot: 0 })
    expect(store.getState().master.params[10]).toBe(0.8)
  })

  test('effectiveValue reads bus rows', () => {
    const { store } = fresh()
    store.setParam(13, 2, 0.6)
    expect(effectiveValue(store.getState(), 13, 2)).toBe(0.6)
  })

  test('toggleMute sends the quantize flag only while playing', () => {
    const { store, sent } = fresh()
    store.toggleMute(0)
    store.play()
    store.toggleMute(0)
    store.setMuteQuantize(false)
    store.toggleMute(1)
    expect(sent.filter((c) => c[0] === Op.SetBusMute)).toEqual([[Op.SetBusMute, 0, 1, 0], [Op.SetBusMute, 0, 0, 1], [Op.SetBusMute, 1, 1, 0]])
    expect(store.getState().buses.map((b) => b.muted).slice(0, 2)).toEqual([false, true])
  })

  test('setStepNote clamps and ignores non-melodic tracks', () => {
    const { store, sent } = fresh()
    store.setStepNote(7, 0, 200)
    expect(store.getState().tracks[7].steps[0].note).toBe(127)
    store.setStepNote(0, 0, 50)
    expect(store.getState().tracks[0].steps[0].note).toBe(41)
    expect(sent).toHaveLength(1)
  })

  test('edit mode switches', () => {
    const { store } = fresh()
    store.setEditMode('note')
    expect(store.getState().editMode).toBe('note')
  })
})
```

`store.test.ts`: in `connect syncs bpm, lengths, speeds, non-default steps and kick params`, change `expect(count(Op.SetParam)).toBe(18)` to `expect(count(Op.SetParam)).toBe(78)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/state`
Expected: FAIL. `./machines` is missing, and the store lacks buses etc.

- [ ] **Step 3: Implement**

`web/src/state/machines.ts`:
```ts
import { KICK_PAGES, KICK_PARAMS, type ParamMeta } from './kickParams'

export interface Page {
  name: string
  params: number[]
}

export interface MachineDef {
  name: string
  melodic: boolean
  params: ParamMeta[]
  pages: Page[]
}

const meta = (pairs: [string, number][]): ParamMeta[] => pairs.map(([name, d]) => ({ name, default: d }))

/** Mirrors SUB_PARAMS in crates/core/src/sub.rs. */
export const SUB_PARAMS = meta([['OCT', 0.5], ['PHASE', 0], ['DRIVE', 0.1], ['GLIDE', 0], ['DECAY', 0.6], ['DRIFT', 0.2], ['LEVEL', 0.8], ['ROUTE', 0]])
/** Mirrors MID_PARAMS in crates/core/src/mid.rs. */
export const MID_PARAMS = meta([
  ['WAVE', 0], ['DETUNE', 0.3], ['FOLD', 0], ['NOISE', 0.05], ['DRIFT', 0.2], ['OCT', 0.5], ['GLIDE', 0], ['LINK', 0],
  ['CUTOFF', 0.45], ['RES', 0.3], ['ENV AMT', 0.5], ['F.DECAY', 0.4], ['DRIVE', 0.2], ['KEYTRK', 0.5], ['TYPE', 0], ['LEVEL', 0.7],
  ['A.DECAY', 0.5],
])
/** Mirrors BUS_PARAMS in crates/core/src/bus.rs. */
export const BUS_PARAMS = meta([['FLT', 0.5], ['DRV', 0], ['LEVEL', 0.8]])
/** Mirrors MASTER_PARAMS in crates/core/src/master.rs. */
export const MASTER_PARAMS = meta([
  ['COMP', 0.2], ['ATK', 0.6], ['REL', 0.5], ['MIX', 1], ['SAT', 0.1], ['CURVE', 0.5], ['TILT', 0.5], ['LOW CUT', 0],
  ['CEIL', 0.975], ['MODE', 0], ['LEVEL', 0.8],
])

const KICK: MachineDef = { name: 'ANALOG BD', melodic: false, params: KICK_PARAMS, pages: KICK_PAGES }
const SUB: MachineDef = { name: 'SUB', melodic: true, params: SUB_PARAMS, pages: [{ name: 'SRC', params: [0, 1, 2, 3, 4, 5, 6, 7] }] }
const MID: MachineDef = {
  name: 'MID BASS', melodic: true, params: MID_PARAMS,
  pages: [{ name: 'SRC', params: [0, 1, 2, 3, 4, 5, 6, 7] }, { name: 'FLTR', params: [8, 9, 10, 11, 12, 13, 14, 15] }, { name: 'AMP', params: [16] }],
}

export const TRACK_COUNT = 13
export const BUS_COUNT = 8
export const BUS_NAMES = ['KICK', 'HATS', 'PERC', 'BASS', 'LEAD', 'PAD', 'ORN', 'FX']
export const MASTER_ROW = TRACK_COUNT + BUS_COUNT
export const ROW_COUNT = MASTER_ROW + 1
export const BUS_FILTER = 0
export const BUS_DRIVE = 1
export const BUS_LEVEL = 2
export const MASTER_MODE = 9
export const MASTER_LEVEL = 10

export const MACHINES: (MachineDef | null)[] = Array.from({ length: TRACK_COUNT }, (_, t) =>
  t <= 1 ? KICK : t === 7 ? SUB : t === 8 ? MID : null)

export const busRow = (b: number) => TRACK_COUNT + b
export const isMelodic = (t: number) => MACHINES[t]?.melodic ?? false

export function rowParamMetas(row: number): ParamMeta[] {
  if (row < TRACK_COUNT) return MACHINES[row]?.params ?? []
  if (row < MASTER_ROW) return BUS_PARAMS
  return row === MASTER_ROW ? MASTER_PARAMS : []
}

export function rowLabel(trackNames: string[], row: number): string {
  if (row < TRACK_COUNT) return trackNames[row] ?? `T${row}`
  if (row < MASTER_ROW) return `${BUS_NAMES[row - TRACK_COUNT]} BUS`
  return 'MASTER'
}

export function paramLabel(trackNames: string[], row: number, p: number): string {
  return `${rowLabel(trackNames, row)}.${rowParamMetas(row)[p]?.name ?? p}`
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`

/** Same law as bus::fader_gain: 0.8 = 0 dB, 1 ≈ +6 dB. */
export function faderDb(norm: number): string {
  if (norm <= 0) return '−∞'
  const db = 20 * Math.log10((norm / 0.8) ** 3.1)
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
}
```

`web/src/state/types.ts`: add
```ts
export interface BusState {
  name: string
  params: number[]
  muted: boolean
}

export interface MasterState {
  params: number[]
}
```
and to `AppState`: `buses: BusState[]`, `master: MasterState`, `muteQuantize: boolean`, `editMode: 'trig' | 'note'`.

`web/src/state/store.ts` changes:
- imports: `cmdSetBusMute` from ops; from `./machines` import `BUS_NAMES, BUS_PARAMS, isMelodic, MACHINES, MASTER_PARAMS, MASTER_ROW, TRACK_COUNT, rowParamMetas`; add `BusState` to the types import.
- in `initialState`, the track params come from `params: MACHINES[i]?.params.map((p) => p.default) ?? []`, and the returned object gains:
```ts
    buses: BUS_NAMES.map((name): BusState => ({ name, params: BUS_PARAMS.map((p) => p.default), muted: false })),
    master: { params: MASTER_PARAMS.map((p) => p.default) },
    muteQuantize: true,
    editMode: 'trig',
```
- add exported helper:
```ts
export function rowParams(state: AppState, row: number): number[] {
  if (row < TRACK_COUNT) return state.tracks[row]?.params ?? []
  if (row < MASTER_ROW) return state.buses[row - TRACK_COUNT]?.params ?? []
  return row === MASTER_ROW ? state.master.params : []
}
```
- `effectiveValue(state, row, p)`: start from `let v = rowParams(state, row)[p] ?? 0`, with the macro loop unchanged.
- inside `createStore`, add:
```ts
  const updateRow = (row: number, fn: (params: number[]) => number[]) => {
    if (row < TRACK_COUNT) updateTrack(row, (tr) => ({ ...tr, params: fn(tr.params) }))
    else if (row < MASTER_ROW) set({ ...state, buses: state.buses.map((b, i) => (i === row - TRACK_COUNT ? { ...b, params: fn(b.params) } : b)) })
    else set({ ...state, master: { params: fn(state.master.params) } })
  }
```
- `setParam(row, p, v)`:
  - start with `if (p >= rowParamMetas(row).length) return`
  - in the learn branch, `const base = rowParams(state, row)[p]` (replacing `state.tracks[t].params[p]`)
  - the non-learn path becomes `updateRow(row, (params) => params.map((x, i) => (i === p ? value : x)))` then `send(cmdSetParam(row, p, value))`
  - rename the first parameter from `t` to `row` throughout the function
- `syncAll`, after the tracks:
```ts
    state.buses.forEach((b, i) => {
      b.params.forEach((v, p) => send(cmdSetParam(TRACK_COUNT + i, p, v)))
      send(cmdSetBusMute(i, b.muted, false))
    })
    state.master.params.forEach((v, p) => send(cmdSetParam(MASTER_ROW, p, v)))
```
- new actions:
```ts
    setStepNote(t: number, s: number, note: number) {
      if (!isMelodic(t)) return
      const step = { ...state.tracks[t].steps[s], note: clamp(Math.round(note), 0, 127) }
      updateTrack(t, (tr) => ({ ...tr, steps: tr.steps.map((st, i) => (i === s ? step : st)) }))
      send(cmdSetStep(t, s, step))
    },
    setEditMode(mode: 'trig' | 'note') {
      set({ ...state, editMode: mode })
    },
    toggleMute(b: number) {
      const muted = !state.buses[b].muted
      set({ ...state, buses: state.buses.map((x, i) => (i === b ? { ...x, muted } : x)) })
      send(cmdSetBusMute(b, muted, state.muteQuantize && state.playing))
    },
    setMuteQuantize(on: boolean) {
      set({ ...state, muteQuantize: on })
    },
```

- [ ] **Step 4: Run all tests**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: all green. Fix only type fallout of the new `AppState` fields (e.g. test helpers constructing states); do not change behaviour.

- [ ] **Step 5: Commit**

```bash
git add web/src/state/machines.ts web/src/state/machines.test.ts web/src/state/types.ts web/src/state/store.ts web/src/state/store.test.ts web/src/state/store.mix.test.ts
git commit -m "feat(web): store machines, rows, buses, master, mutes and step notes

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 12: ParamKnob, Knob sizes, machine panel for SUB/MID

**Files:**
- Create: `web/src/ui/ParamKnob.tsx`
- Modify: `web/src/ui/Knob.tsx`, `web/src/ui/Knob.test.tsx`, `web/src/ui/MacroFaders.tsx`
- Replace: `web/src/ui/MachinePanel.tsx`
- Test: `web/src/ui/MachinePanel.test.tsx` (append)

**Interfaces:**
- Produces:
  - `Knob` gains optional `size?: 'md' | 'sm'` (56 px or 40 px rendered; the viewBox stays 56) and `ariaLabel?: string` (slider and label-button accessible names; defaults to `label`).
  - `ParamKnob({ state, frame, store, row, param, meta, size?, ariaLabel?, selected?, onSelect? })` holds all knob wiring for any row: learn-aware value, effective display, mod amount, macro markers, drop → `addRoute`, and outer-ring drag → route amount.
  - `MachinePanel({ state, frame, store })` is driven by `MACHINES[selected]`, so it handles KICK, SUB and MID. Its inner state (page, selected param) resets on track change.
  - `MacroFaders` labels targets with `paramLabel`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/ui/Knob.test.tsx`:
```tsx
test('small size renders 40 px and ariaLabel overrides the accessible name', () => {
  render(<Knob label="FLT" ariaLabel="KICK filter" size="sm" value={0.5} defaultValue={0.5} onChange={() => {}} />)
  const knob = screen.getByRole('slider', { name: 'KICK filter' })
  expect(knob.getAttribute('width')).toBe('40')
})
```

Append to `web/src/ui/MachinePanel.test.tsx` (it already has `Harness`, `setup` and `act`):
```tsx
test('SUB shows its own params and edits its own track', () => {
  const store = setup()
  act(() => store.select(7))
  expect(screen.getByText('SUB', { selector: 'span' })).toBeTruthy()
  expect(screen.getByRole('slider', { name: 'OCT' })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('slider', { name: 'DECAY' }), { key: 'End' })
  expect(store.getState().tracks[7].params[4]).toBe(1)
})

test('MID has SRC, FLTR and AMP pages', () => {
  const store = setup()
  act(() => store.select(8))
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['SRC', 'FLTR', 'AMP'])
  fireEvent.click(screen.getByRole('tab', { name: 'FLTR' }))
  expect(screen.getByRole('slider', { name: 'CUTOFF' })).toBeTruthy()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/ui/Knob.test.tsx src/ui/MachinePanel.test.tsx`
Expected: FAIL (no `size`/`ariaLabel`, and the panel says SUB has no machine).

- [ ] **Step 3: Implement**

`web/src/ui/Knob.tsx`:
- add the props `size?: 'md' | 'sm'` and `ariaLabel?: string` (documented)
- `const px = size === 'sm' ? 40 : 56`
- the svg uses `width={px} height={px}` (the viewBox is unchanged)
- the slider's `aria-label={ariaLabel ?? label}`, and the label button gets `aria-label={ariaLabel ?? label}`
- the value text class becomes `size === 'sm' ? 'text-[10px] tabular-nums' : 'text-sm tabular-nums'`

`web/src/ui/ParamKnob.tsx`:
```tsx
import { effectiveOf } from '@/audio/snapshot'
import type { ParamMeta } from '@/state/kickParams'
import { effectiveValue, modAmountFor, routeIndexFor, rowParams, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { Knob } from './Knob'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
  row: number
  param: number
  meta: ParamMeta
  size?: 'md' | 'sm'
  ariaLabel?: string
  selected?: boolean
  onSelect?(): void
}

/** A knob bound to (row, param): edits the base or the armed macro endpoint, shows live value, takes modulators. */
export function ParamKnob({ state, frame, store, row, param: p, meta, size, ariaLabel, selected, onSelect }: Props) {
  const learn = state.learn
  const marker = state.macros[state.selectedMacro].targets.find((x) => x.track === row && x.param === p)
  const learnTarget = learn ? state.macros[learn.macro].targets.find((x) => x.track === row && x.param === p) : undefined
  const base = rowParams(state, row)[p] ?? meta.default
  const value = learn ? (learnTarget ? learnTarget[learn.side] : base) : base
  const display = learn ? value : frame ? effectiveOf(frame, row, p) : effectiveValue(state, row, p)
  return (
    <Knob label={meta.name} ariaLabel={ariaLabel} size={size} value={value} display={display} defaultValue={meta.default}
      modAmount={modAmountFor(state, row, p)} markers={marker ? { a: marker.a, b: marker.b } : null}
      learning={learn !== null} selected={selected}
      onChange={(v) => store.setParam(row, p, v)}
      onSelect={onSelect}
      onDropModulator={(slot) => { store.addRoute(slot, row, p); onSelect?.() }}
      onModAmount={(delta) => {
        let idx = routeIndexFor(state, state.selectedMod, row, p)
        if (idx === -1) idx = state.routes.findIndex((r) => r !== null && r.track === row && r.param === p)
        const r = state.routes[idx]
        if (r) store.setRouteAmount(idx, r.amount + delta)
      }} />
  )
}
```

`web/src/ui/MachinePanel.tsx` (replace):
```tsx
import { useState } from 'react'
import { MACHINES, type MachineDef } from '@/state/machines'
import { modLabel } from '@/state/modulation'
import type { Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { MacroFaders } from './MacroFaders'
import { ParamKnob } from './ParamKnob'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

const btn = 'rounded border border-zinc-700 px-1.5 text-zinc-300 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc disabled:opacity-40'

export function MachinePanel({ state, frame, store }: Props) {
  const t = state.selected
  const machine = MACHINES[t]
  return (
    <aside aria-label="Machine" className="flex min-h-0 flex-col">
      {machine ? (
        // keyed by track so page and selected param reset when switching tracks
        <MachineBody key={t} state={state} frame={frame} store={store} track={t} machine={machine} />
      ) : (
        <p className="p-3 text-zinc-400"><b className="text-acc">{state.tracks[t].name}</b>: nincs még machine (későbbi terv).</p>
      )}
      <MacroFaders state={state} store={store} />
    </aside>
  )
}

interface BodyProps extends Props {
  track: number
  machine: MachineDef
}

function MachineBody({ state, frame, store, track: t, machine }: BodyProps) {
  const [page, setPage] = useState(0)
  const [selParam, setSelParam] = useState(machine.pages[0].params[0])
  const [addSrc, setAddSrc] = useState(0)
  const routes = state.routes.flatMap((r, i) => (r && r.track === t && r.param === selParam ? [{ r, i }] : []))
  const active = state.modulators.flatMap((m, i) => (m.kind !== 0 ? [{ m, i }] : []))
  const src = active.some((a) => a.i === addSrc) ? addSrc : active[0]?.i
  const label = (slot: number) => (state.modulators[slot].kind === 0 ? `MOD${slot + 1} (off)` : modLabel(slot, state.modulators[slot]))

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-800 p-2">
        <b className="text-acc">{state.tracks[t].name}</b>
        <span className="text-zinc-400">{machine.name}</span>
      </div>
      <div role="tablist" className="flex border-b border-zinc-800">
        {machine.pages.map((pg, i) => (
          <button key={pg.name} type="button" role="tab" aria-selected={page === i}
            onClick={() => { setPage(i); setSelParam(pg.params[0]) }}
            className={`flex-1 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${page === i ? 'text-acc shadow-[inset_0_-2px_0_var(--color-acc)]' : 'text-zinc-400'}`}>
            {pg.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-y-2 p-2">
        {machine.pages[page].params.map((p) => (
          <ParamKnob key={p} state={state} frame={frame} store={store} row={t} param={p} meta={machine.params[p]}
            selected={selParam === p} onSelect={() => setSelParam(p)} />
        ))}
      </div>
      <div className="flex flex-col gap-1 border-t border-zinc-800 p-2">
        <span className="text-[9px] tracking-wider text-zinc-400 uppercase">mod on {machine.params[selParam].name}</span>
        {routes.length === 0 && <p className="text-zinc-400">húzz rá egy modulátort a gombra, vagy add hozzá itt</p>}
        {routes.map(({ r, i }) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-16 text-mod">{label(r.src)}</span>
            <input type="range" min={-100} max={100} value={Math.round(r.amount * 100)} aria-label={`${label(r.src)} amount`}
              onChange={(e) => store.setRouteAmount(i, Number(e.target.value) / 100)} className="flex-1 accent-sky-400" />
            <span className="w-8 text-right tabular-nums">{Math.round(r.amount * 100)}</span>
            <button type="button" aria-label={`Remove ${label(r.src)} route`} onClick={() => store.removeRoute(i)} className={btn}>×</button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <select aria-label="Modulator to add" value={src ?? ''} onChange={(e) => setAddSrc(Number(e.target.value))}
            className="rounded bg-zinc-900 px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc">
            {active.map(({ m, i }) => <option key={i} value={i}>{modLabel(i, m)}</option>)}
          </select>
          <button type="button" className={btn} disabled={src === undefined} aria-disabled={src === undefined}
            onClick={() => { if (src !== undefined) store.addRoute(src, t, selParam) }}>+ route</button>
        </div>
      </div>
    </>
  )
}
```

`web/src/ui/MacroFaders.tsx`:
- replace the `KICK_PARAMS` import with `import { paramLabel } from '@/state/machines'`
- replace the local `paramName` with `const paramName = (row: number, p: number) => paramLabel(state.tracks.map((t) => t.name), row, p)`

- [ ] **Step 4: Run all web tests**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: all green, including the existing MachinePanel tests (route list, drop, learn, OFF label, add-route fallback).

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/Knob.tsx web/src/ui/Knob.test.tsx web/src/ui/ParamKnob.tsx web/src/ui/MachinePanel.tsx web/src/ui/MachinePanel.test.tsx web/src/ui/MacroFaders.tsx
git commit -m "feat(web): table-driven machine panel for kick, sub and mid with shared param knob

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 13: Sequencer TRIG/NOTE mode

**Files:**
- Replace: `web/src/ui/SequencerMatrix.tsx`
- Create: `web/src/ui/SequencerMatrix.test.tsx`
- Modify: `web/src/App.tsx` (pass the new props)

**Interfaces:**
- Produces: `SequencerMatrix` props `{ state, playheads, onToggle, onSetLength, onSetSpeed, onSelect, onSetMode(mode), onSetNote(t, s, note) }`.
- In NOTE mode, on melodic tracks:
  - ↑/↓ moves the note ±1 (⇧ ±12); the wheel moves ±1; vertical drag moves 1 semitone per 8 px.
  - Click does not toggle; ⌥+click still sets the length.
  - Trig steps show their note name.
- Steps of non-melodic tracks are `aria-disabled` in NOTE mode and inert.

- [ ] **Step 1: Write the failing tests** in `web/src/ui/SequencerMatrix.test.tsx`

```tsx
// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { createStore, type Store } from '@/state/store'
import { SequencerMatrix } from './SequencerMatrix'

afterEach(cleanup)

const IDLE = Array<number>(13).fill(-1)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return (
    <SequencerMatrix state={state} playheads={IDLE} onToggle={store.toggleStep} onSetLength={store.setLength}
      onSetSpeed={store.setSpeed} onSelect={store.select} onSetMode={store.setEditMode} onSetNote={store.setStepNote} />
  )
}

function setup() {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('the mode switch toggles between TRIG and NOTE', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'NOTE' }))
  expect(store.getState().editMode).toBe('note')
  expect(screen.getByRole('button', { name: 'NOTE' }).getAttribute('aria-pressed')).toBe('true')
})

test('arrow keys move a SUB step note in NOTE mode', () => {
  const store = setup()
  act(() => store.setEditMode('note'))
  const step = screen.getByRole('button', { name: /^SUB step 1,/ })
  fireEvent.keyDown(step, { key: 'ArrowUp' })
  expect(store.getState().tracks[7].steps[0].note).toBe(42)
  fireEvent.keyDown(step, { key: 'ArrowUp', shiftKey: true })
  expect(store.getState().tracks[7].steps[0].note).toBe(54)
})

test('clicking a step in NOTE mode does not toggle it', () => {
  const store = setup()
  act(() => store.setEditMode('note'))
  fireEvent.click(screen.getByRole('button', { name: /^SUB step 2,/ }))
  expect(store.getState().tracks[7].steps[1].trig).toBe(false)
})

test('kick steps ignore note edits', () => {
  const store = setup()
  act(() => store.setEditMode('note'))
  const kick = screen.getByRole('button', { name: 'KICK step 1' })
  expect(kick.getAttribute('aria-disabled')).toBe('true')
  fireEvent.keyDown(kick, { key: 'ArrowUp' })
  expect(store.getState().tracks[0].steps[0].note).toBe(41)
})

test('trig steps show their note name in NOTE mode', () => {
  const store = setup()
  act(() => store.toggleStep(7, 0))
  act(() => store.setEditMode('note'))
  expect(screen.getByRole('button', { name: 'SUB step 1, F2' }).textContent).toBe('F2')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/ui/SequencerMatrix.test.tsx`
Expected: FAIL (there is no mode switch).

- [ ] **Step 3: Implement** `web/src/ui/SequencerMatrix.tsx` (replace)

```tsx
import { useRef, type KeyboardEvent } from 'react'
import { isMelodic, noteName } from '@/state/machines'
import type { AppState } from '@/state/types'

export const SPEEDS = [
  { code: 0, label: '1/32' }, { code: 1, label: '1/16' }, { code: 2, label: '1/8' }, { code: 3, label: '1/4' },
  { code: 4, label: '1 BAR' }, { code: 5, label: '1/16T' }, { code: 6, label: '1/8T' },
]
const VISIBLE = 16
const PX_PER_SEMITONE = 8

interface Props {
  state: AppState
  playheads: number[]
  onToggle(track: number, step: number): void
  onSetLength(track: number, length: number): void
  onSetSpeed(track: number, code: number): void
  onSelect(track: number): void
  onSetMode(mode: 'trig' | 'note'): void
  onSetNote(track: number, step: number, note: number): void
}

/** TRIG: click = trig, ⌥+click = track ends here. NOTE: ↑↓ / wheel / drag = semitone, ⇧ = octave. */
export function SequencerMatrix({ state, playheads, onToggle, onSetLength, onSetSpeed, onSelect, onSetMode, onSetNote }: Props) {
  const noteMode = state.editMode === 'note'
  const drag = useRef<{ t: number; s: number; y: number; note: number } | null>(null)

  const onNoteKey = (e: KeyboardEvent, t: number, s: number, note: number) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const step = e.shiftKey ? 12 : 1
    onSetNote(t, s, note + (e.key === 'ArrowUp' ? step : -step))
  }

  return (
    <section aria-label="Sequencer" className="flex min-h-0 flex-1 flex-col gap-[3px] border-r border-zinc-800 p-2">
      <div role="group" aria-label="Edit mode" className="flex items-center gap-1 pb-1 text-[10px]">
        {(['trig', 'note'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={state.editMode === m} onClick={() => onSetMode(m)}
            className={`rounded border px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${state.editMode === m ? 'border-acc text-acc' : 'border-zinc-700 text-zinc-400'}`}>
            {m.toUpperCase()}
          </button>
        ))}
        <span className="ml-2 text-zinc-400">{noteMode ? '↑↓ / görgő / húzás = hang · ⇧ = oktáv' : '⌥+klikk = sávhossz'}</span>
      </div>
      {state.tracks.map((tr, t) => {
        const newBus = t > 0 && state.tracks[t - 1].bus !== tr.bus
        const selected = state.selected === t
        const melodic = isMelodic(t)
        const inert = noteMode && !melodic
        return (
          <div key={tr.name}
            className={`grid min-h-0 flex-1 grid-cols-[52px_repeat(16,1fr)_150px] items-stretch gap-[3px] rounded ${newBus ? 'mt-1.5' : ''} ${selected ? 'bg-zinc-900 ring-1 ring-acc/30' : ''}`}>
            <button type="button" onClick={() => onSelect(t)} aria-pressed={selected}
              className={`rounded px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-acc ${selected ? 'text-acc' : 'text-zinc-400'}`}>
              {tr.name}
            </button>
            {tr.steps.slice(0, VISIBLE).map((st, s) => {
              const beyond = s >= tr.length
              const isEnd = s === tr.length - 1
              const isHead = playheads[t] === s
              const showNote = noteMode && melodic
              return (
                <button key={s} type="button" aria-pressed={st.trig} aria-disabled={inert || undefined}
                  aria-label={showNote ? `${tr.name} step ${s + 1}, ${noteName(st.note)}` : `${tr.name} step ${s + 1}`}
                  onClick={(e) => {
                    if (e.altKey) onSetLength(t, s + 1)
                    else if (!noteMode) onToggle(t, s)
                  }}
                  onKeyDown={(e) => { if (showNote) onNoteKey(e, t, s, st.note) }}
                  onWheel={(e) => { if (showNote) onSetNote(t, s, st.note + (e.deltaY < 0 ? 1 : -1)) }}
                  onPointerDown={(e) => {
                    if (!showNote) return
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                    drag.current = { t, s, y: e.clientY, note: st.note }
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current
                    if (!d || d.t !== t || d.s !== s) return
                    const semis = Math.round((d.y - e.clientY) / PX_PER_SEMITONE)
                    if (d.note + semis !== st.note) onSetNote(t, s, d.note + semis)
                  }}
                  onPointerUp={() => { drag.current = null }}
                  onPointerCancel={() => { drag.current = null }}
                  className={[
                    'relative overflow-hidden rounded-sm text-[9px] leading-none text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-acc',
                    st.trig ? 'bg-acc/70' : 'bg-zinc-900',
                    beyond ? 'opacity-30 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,#27272a_3px_6px)]' : '',
                    inert ? 'opacity-40' : '',
                    showNote ? 'cursor-ns-resize touch-none' : '',
                    s % 4 === 0 ? 'ml-0.5' : '',
                    isEnd ? 'border-r-2 border-acc' : '',
                    isHead ? 'ring-1 ring-zinc-200' : '',
                  ].join(' ')}>
                  {showNote && st.trig ? noteName(st.note) : null}
                </button>
              )
            })}
            <div className="flex items-center justify-end gap-1 pl-2 text-[10px] text-zinc-400">
              <button type="button" aria-label={`${tr.name} shorter`} onClick={() => onSetLength(t, tr.length - 1)}
                className="rounded px-1 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc">−</button>
              <span className="w-6 text-center tabular-nums text-zinc-100" aria-label={`${tr.name} length`}>{tr.length}</span>
              <button type="button" aria-label={`${tr.name} longer`} onClick={() => onSetLength(t, tr.length + 1)}
                className="rounded px-1 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc">+</button>
              <select aria-label={`${tr.name} speed`} value={tr.speed} onChange={(e) => onSetSpeed(t, Number(e.target.value))}
                className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-300 focus-visible:ring-2 focus-visible:ring-acc">
                {SPEEDS.map((sp) => <option key={sp.code} value={sp.code}>{sp.label}</option>)}
              </select>
            </div>
          </div>
        )
      })}
    </section>
  )
}
```

`web/src/App.tsx`: pass `onSetMode={store.setEditMode} onSetNote={store.setStepNote}` to `SequencerMatrix`. In `TransportBar.tsx`, remove the trailing `⌥+klikk = sávhossz` span (the hint moved into the sequencer header).

- [ ] **Step 4: Run all web tests**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/SequencerMatrix.tsx web/src/ui/SequencerMatrix.test.tsx web/src/App.tsx web/src/ui/TransportBar.tsx
git commit -m "feat(web): trig/note edit mode in the sequencer

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 14: Mixer row (8 bus strips + master) and layout

**Files:**
- Create: `web/src/ui/VFader.tsx`, `web/src/ui/Mixer.tsx`, `web/src/ui/Mixer.test.tsx`
- Modify: `web/src/ui/MacroFaders.tsx` (use `VFader`), `web/src/App.tsx` (grid row for the mixer)

**Interfaces:**
- Produces:
  - `VFader({ label, pos, empty?, valueText?, onPos })`: vertical ARIA slider. Pointer: click or drag sets the absolute position. Keys: ↑/→ +0.01, ↓/← −0.01 (⇧ ±0.1), Home/End. Its accessible name is `label`.
  - `Mixer({ state, frame, store })`, with 8 strips. Each strip has:
    - name and live dB
    - FLT and DRV `ParamKnob`s (`size="sm"`, ARIA names `"<BUS> filter"` / `"<BUS> drive"`)
    - a level `VFader` (`"<BUS> level"`, learn-aware) with a peak meter
    - a MUTE button (`"Mute <BUS>"`, `aria-pressed`, showing a `· Q` hint while pending)
  - The master section has:
    - a MUTE Q toggle
    - knobs COMP, ATK, REL, MIX, SAT, CURVE, TILT, LOW CUT, CEIL (names `"MASTER <NAME>"`)
    - a MODE button (`LIMIT`/`CLIP`)
    - a LEVEL fader (`"MASTER level"`)
    - L/R meters, LUFS and GR readouts

- [ ] **Step 1: Write the failing tests** in `web/src/ui/Mixer.test.tsx`

```tsx
// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { MOD_DRAG_TYPE } from '@/state/modulation'
import { createStore, type Store } from '@/state/store'
import { Mixer } from './Mixer'

afterEach(cleanup)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return <Mixer state={state} frame={null} store={store} />
}

const setup = () => {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('eight strips with mute buttons', () => {
  setup()
  expect(screen.getAllByRole('button', { name: /^Mute / })).toHaveLength(8)
})

test('mute toggles the bus', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Mute BASS' }))
  expect(store.getState().buses[3].muted).toBe(true)
  expect(screen.getByRole('button', { name: 'Mute BASS' }).getAttribute('aria-pressed')).toBe('true')
})

test('level fader sets the bus LEVEL param and shows dB', () => {
  const store = setup()
  fireEvent.keyDown(screen.getByRole('slider', { name: 'KICK level' }), { key: 'End' })
  expect(store.getState().buses[0].params[2]).toBe(1)
  expect(screen.getByText('+6.0 dB')).toBeTruthy()
})

test('dropping a modulator on a bus filter routes to that bus row', () => {
  const store = setup()
  const dataTransfer = { types: [MOD_DRAG_TYPE], getData: () => '0' }
  fireEvent.drop(screen.getByRole('slider', { name: 'BASS filter' }), { dataTransfer })
  expect(store.getState().routes[0]).toMatchObject({ src: 0, track: 16, param: 0 })
})

test('master MODE switches between limiter and clip', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Master mode LIMIT' }))
  expect(store.getState().master.params[9]).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Master mode CLIP' }))
  expect(store.getState().master.params[9]).toBe(0)
})

test('MUTE Q toggles quantized mutes', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'MUTE Q' }))
  expect(store.getState().muteQuantize).toBe(false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/ui/Mixer.test.tsx`
Expected: FAIL, `./Mixer` cannot be resolved.

- [ ] **Step 3: Implement**

`web/src/ui/VFader.tsx`:
```tsx
import type { KeyboardEvent, PointerEvent } from 'react'

interface Props {
  label: string
  pos: number
  empty?: boolean
  valueText?: string
  onPos(pos: number): void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Vertical fader: click/drag = absolute position, arrows ±0.01 (⇧ ±0.1), Home/End. */
export function VFader({ label, pos, empty = false, valueText, onPos }: Props) {
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onPos(clamp01(1 - (e.clientY - r.top) / r.height))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const keys: Record<string, number> = {
      ArrowUp: pos + step, ArrowRight: pos + step, ArrowDown: pos - step, ArrowLeft: pos - step, Home: 0, End: 1,
    }
    if (e.key in keys) {
      e.preventDefault()
      onPos(clamp01(keys[e.key]))
    }
  }
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(pos * 100)} aria-valuetext={valueText}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); fromPointer(e) }}
      onPointerMove={(e) => { if (e.buttons) fromPointer(e) }}
      onKeyDown={onKey}
      className="relative flex h-full min-h-10 w-full cursor-ns-resize touch-none justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-acc">
      <div className={`h-full w-2 rounded ${empty ? 'bg-zinc-800' : 'bg-gradient-to-t from-zinc-700 to-sky-900'}`} />
      <div className="absolute left-1/2 h-3 w-7 -translate-x-1/2 rounded-sm bg-zinc-200 shadow" style={{ bottom: `calc(${pos * 100}% - 6px)` }} />
    </div>
  )
}
```

`web/src/ui/MacroFaders.tsx`: delete the local `Fader` component and its now-unused `PointerEvent`/`KeyboardEvent` imports. Then `import { VFader } from './VFader'` and render `<VFader label={`${mac.name} macro`} pos={mac.pos} empty={mac.targets.length === 0} onPos={(p) => store.setMacroPos(m, p)} />`.

`web/src/ui/Mixer.tsx`:
```tsx
import { busMeterOf, busMutedOf, effectiveOf, masterMeterOf } from '@/audio/snapshot'
import { BUS_FILTER, BUS_DRIVE, BUS_LEVEL, BUS_PARAMS, busRow, faderDb, MASTER_LEVEL, MASTER_MODE, MASTER_PARAMS, MASTER_ROW } from '@/state/machines'
import { effectiveValue, rowParams, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { ParamKnob } from './ParamKnob'
import { VFader } from './VFader'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

const toggle = (on: boolean) =>
  `rounded border px-1.5 py-0.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-acc ${on ? 'border-acc text-acc' : 'border-zinc-700 text-zinc-300'}`

/** Peak meter: −60…0 dBFS mapped to the bar height. */
function Meter({ label, peak }: { label: string; peak: number }) {
  const db = peak > 0 ? 20 * Math.log10(peak) : -60
  const h = Math.min(100, Math.max(0, ((db + 60) / 60) * 100))
  return (
    <div role="img" aria-label={`${label} ${db <= -60 ? '−∞' : db.toFixed(1)} dB`} className="relative w-1.5 overflow-hidden rounded bg-zinc-900">
      <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500" style={{ height: `${h}%` }} />
    </div>
  )
}

export function Mixer({ state, frame, store }: Props) {
  // The fader edits the base (or the armed macro endpoint), like every knob.
  const editValue = (row: number, p: number) => {
    const learn = state.learn
    const base = rowParams(state, row)[p]
    if (!learn) return base
    const t = state.macros[learn.macro].targets.find((x) => x.track === row && x.param === p)
    return t ? t[learn.side] : base
  }
  const live = (row: number, p: number) => (frame ? effectiveOf(frame, row, p) : effectiveValue(state, row, p))
  const master = frame ? masterMeterOf(frame) : { peakL: 0, peakR: 0, lufs: -70, gr: 0 }
  const clip = state.master.params[MASTER_MODE] >= 0.5

  return (
    <section aria-label="Mixer" className="grid h-full min-h-0 grid-cols-[repeat(8,minmax(0,1fr))_minmax(0,2.4fr)] border-t border-zinc-800 text-[10px]">
      {state.buses.map((bus, b) => {
        const row = busRow(b)
        const meter = frame ? busMeterOf(frame, b) : { peak: 0, rms: 0 }
        const applied = frame ? busMutedOf(frame, b) : bus.muted
        const pending = applied !== bus.muted
        return (
          <div key={bus.name} className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] gap-1 border-r border-zinc-800 p-1.5">
            <div className="flex justify-between">
              <b>{bus.name}</b>
              <span className="tabular-nums text-zinc-400">{faderDb(live(row, BUS_LEVEL))}</span>
            </div>
            <div className="flex justify-center gap-1">
              <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_FILTER} meta={BUS_PARAMS[BUS_FILTER]} size="sm" ariaLabel={`${bus.name} filter`} />
              <ParamKnob state={state} frame={frame} store={store} row={row} param={BUS_DRIVE} meta={BUS_PARAMS[BUS_DRIVE]} size="sm" ariaLabel={`${bus.name} drive`} />
            </div>
            <div className="flex min-h-0 justify-center gap-1.5">
              <div className="w-8"><VFader label={`${bus.name} level`} pos={editValue(row, BUS_LEVEL)} valueText={faderDb(editValue(row, BUS_LEVEL))} onPos={(p) => store.setParam(row, BUS_LEVEL, p)} /></div>
              <Meter label={`${bus.name} peak`} peak={meter.peak} />
            </div>
            <button type="button" aria-label={`Mute ${bus.name}`} aria-pressed={bus.muted} onClick={() => store.toggleMute(b)}
              className={`rounded border py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${bus.muted ? 'border-red-600 bg-red-600 text-white' : 'border-zinc-700 text-zinc-300'}`}>
              {bus.muted ? 'MUTED' : 'MUTE'}{pending ? ' · Q' : ''}
            </button>
          </div>
        )
      })}
      <div className="grid min-h-0 grid-cols-[1fr_auto] gap-2 p-1.5">
        <div className="flex min-h-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <b>MASTER</b>
            <button type="button" className={toggle(state.muteQuantize)} aria-pressed={state.muteQuantize} onClick={() => store.setMuteQuantize(!state.muteQuantize)}>MUTE Q</button>
            <button type="button" className={toggle(clip)} aria-label={`Master mode ${clip ? 'CLIP' : 'LIMIT'}`}
              onClick={() => store.setParam(MASTER_ROW, MASTER_MODE, clip ? 0 : 1)}>{clip ? 'CLIP' : 'LIMIT'}</button>
            <span className="ml-auto tabular-nums text-zinc-300">{master.lufs.toFixed(1)} LUFS · GR {master.gr.toFixed(1)} dB</span>
          </div>
          <div className="grid grid-cols-5 gap-x-1 gap-y-0.5">
            {MASTER_PARAMS.map((meta, p) => (p === MASTER_MODE || p === MASTER_LEVEL ? null : (
              <ParamKnob key={meta.name} state={state} frame={frame} store={store} row={MASTER_ROW} param={p} meta={meta} size="sm" ariaLabel={`MASTER ${meta.name}`} />
            )))}
          </div>
        </div>
        <div className="flex min-h-0 gap-1">
          <div className="w-8"><VFader label="MASTER level" pos={editValue(MASTER_ROW, MASTER_LEVEL)} valueText={faderDb(editValue(MASTER_ROW, MASTER_LEVEL))} onPos={(p) => store.setParam(MASTER_ROW, MASTER_LEVEL, p)} /></div>
          <Meter label="MASTER L" peak={master.peakL} />
          <Meter label="MASTER R" peak={master.peakR} />
        </div>
      </div>
    </section>
  )
}
```

`web/src/App.tsx`:
- the root grid becomes `grid-rows-[auto_1fr_200px]`
- after `</main>`, add `<Mixer state={state} frame={frame} store={store} />` (import it)
- the mod-strip wrapper height stays `h-[190px]`

The test `level fader sets the bus LEVEL param and shows dB` expects `+6.0 dB` to be visible. It shows in the strip header, which reads the effective value (equal to the base without a frame).

- [ ] **Step 4: Run every automated check**

Run: `source "$HOME/.cargo/env" && cargo test && cd web && source ~/.nvm/nvm.sh && npm run wasm && npm test && npx tsc --noEmit && npm run build` (delete `web/dist` afterwards).
Expected: all green.

- [ ] **Step 5: Preview smoke check.** Start `npm run preview` in the background and run `curl -sI http://localhost:4173/` (COOP/COEP present). Stop the server. The human does the listening check at the end:
1. In NOTE mode, set SUB steps to a few notes. Play: the sub rings under the kick.
2. Set MID LINK, and turn CUTOFF and ENV AMT.
3. Use the BASS filter (LP ↔ HP), the drive, and a fader to −∞.
4. With MUTE Q on, mute KICK: the mute lands on the bar.
5. Master: COMP and SAT change the glue, LIMIT holds peaks, and the LUFS reading moves.

- [ ] **Step 6: Commit**

```bash
git add web/src/ui/VFader.tsx web/src/ui/Mixer.tsx web/src/ui/Mixer.test.tsx web/src/ui/MacroFaders.tsx web/src/App.tsx
git commit -m "feat(web): mixer row with bus strips, quantized mutes, meters and master section

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

## Deliberately deferred (not gaps)

- **To plan 1c-b:** send A (reverb, Erbe-Verb-style) and send B (tape/BBD delay), THROW, the FX RTN input, and SC.KICK and ENV.F modulators.
- **To sub-project 3:** SUB/MID FOLLOW (chord root / chord tones) and scale-quantised notes.
- **To plan 1d:**
  - stereo pan/width per track
  - the full edit-mode set (PROB/COND/LOCK/µTIME/RETRIG)
  - persistence of mixer state
- The modulator-drag interaction refinement the user asked to postpone.
