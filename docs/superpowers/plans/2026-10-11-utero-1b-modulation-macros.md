# utero 1b: Modulation + A/B macros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 16 global modulators (LFO with SIN/GLIDE/S&H first, then TRI/SAW/RAMP/SQR/EXP/DRIFT, plus NOISE~ and STEP) that are drag-routed onto any KICK parameter. 8 Octatrack-style A/B macro faders with LEARN. The parked BPM-field bug from 1a is also fixed.

**Architecture:**
- **Core (`crates/core`)**
  - `modulation.rs`: `Modulator` and `ModMatrix`. Routes fade in and out over about 10 ms, and per-target sums are recomputed every sample.
  - `macros.rs`: `Macros`, absolute A→B overrides with a smoothed fader position.
  - `Engine` runs every parameter per sample: smoothed base norm → macro override → + modulation sum → clamp → map to units. Kick envelopes become recursive, so modulating DECAY or S.TIME never jumps.
  - The engine writes one flat snapshot array (playheads, modulator outputs, effective norms). The worklet copies it into the shared buffer once per block.
- **UI**
  - A modulator strip under the sequencer: an editor plus 16 draggable tiles.
  - Knobs gain a modulation ring, a live value dot, A/B markers and a drop target.
  - The machine panel gains a "mod on <param>" route list and the 8 macro faders.

**Tech Stack:** Rust 2021 (wasm32-unknown-unknown), Vite + React 19 + TypeScript, Tailwind v4 + shadcn/ui, Vitest. New dev deps: jsdom and @testing-library/react for component tests.

**Spec:** [docs/superpowers/specs/2026-10-11-utero-design.md](../specs/2026-10-11-utero-design.md). This plan covers §8 (moduláció, macrók), the §9 "recursive envelope" follow-up from the 1a final review, and the parked BPM-field ruling. It builds on plan 1a ([2026-10-11-utero-1a-engine-kick.md](2026-10-11-utero-1a-engine-kick.md)).

**Product rulings taken for this plan.** The spec is silent on these, or this plan narrows it:
1. RANDOM is not a separate type: GLIDE, S&H and DRIFT are LFO shapes. The types are LFO, NOISE and STEP. ENV.F and SC.KICK need buses, so they move to plan 1c.
2. All routes run at audio rate. The spec's 32-sample control rate is a performance allowance that is not needed at this scale; the benchmark in Task 6 guards it.
3. Route amounts fade over about 10 ms, so adding, editing or removing a route never clicks.
4. A macro overrides the base value absolutely (Octatrack). If two macros target the same parameter, the higher macro index wins.
5. While LEARN A or LEARN B is armed, turning a knob writes that macro endpoint instead of the base value. A new target starts with A = B = the current base.
6. Deferred: the ✎ DRAW shape, ★ favourite pinning (the favourites are fixed: SIN, GLIDE, S&H), and mutate on STEP (plan 1e).

## Global Constraints

- Audio: 48 kHz, Web Audio block = 128 frames; no allocation, locks or I/O inside `Engine::process` (spec §5).
- 16 modulator slots per scene, max 64 routes, 8 macros, max 16 targets per macro (spec §8; targets-per-macro chosen here).
- The default LFO rate is **4 bar** (sync index 6). The sync list is `1/16, 1/8, 1/4, 1/2, 1, 2, 4, 8, 16, 32` bars, and Hz mode spans 0.01–40 Hz (spec §8).
- Shape codes: 0 SIN, 1 GLIDE, 2 S&H, 3 TRI, 4 SAW, 5 RAMP, 6 SQR, 7 EXP, 8 DRIFT. Kind codes: 0 OFF, 1 LFO, 2 NOISE, 3 STEP. Noise colours: 0 WHITE, 1 PINK, 2 CRACKLE. Trigger modes: 0 FREE, 1 RETRIG, 2 ONESHOT. Rust and TS must agree on all of these.
- Parameter order per sample: base (smoothed) → macro → + Σ route amount × modulator output → clamp 0..1 → map (spec §8).
- Every UI action works with mouse and keyboard. Drag-and-drop routing has a select + button alternative, and the knobs and faders are ARIA sliders with arrow/Home/End keys (spec §4, user CLAUDE.md WCAG 2.1 AA).
- Dark UI, accent tokens `acc` (#f59e0b) and `mod` (#38bdf8). Orange means value or selection, blue means modulation, red means armed LEARN (spec §4).
- Commits: conventional messages. Stage specific files, never `git add .`. End with a `Co-Authored-By:` line naming the model that wrote the commit.
- Commands: Rust via `source "$HOME/.cargo/env" && …`; web via `cd web && source ~/.nvm/nvm.sh && …`. After any Rust change used by the web tests, run `npm run wasm` before `npm test`.

## Review Focus

1. **Garbage modulation commands from JS:** rate index 255, NaN hz, phase, depth or amount, slot 99, route 999. The engine must ignore or sanitize them and never trap, because a trap silences the show. Covered by Task 3 `sanitized_settings_are_safe`, Task 4 `invalid_routes_are_ignored`, Task 5 `invalid_input_is_ignored`, and Task 7 `garbage modulation commands do not trap`.
2. **Removing a route that is modulating LEVEL or TUNE:** the contribution must fade, not step. Covered by Task 4 `removed_route_fades_out_without_jump`.
3. **Stacked routes push a parameter past 1:** the effective value is clamped to 0..1. Covered by Task 6 `modulation_is_clamped_to_range`.
4. **LEARN armed and the user touches a knob, then clicks the same LEARN button again:** the target is recorded for the right track and side, the base stays unchanged, and a second click disarms. Covered by Task 8 `learn records endpoints without touching the base` and `arming the same side again disarms`.
5. **The Rust and TS snapshot layouts drift apart:** the UI must fail loudly, not show wrong values. Covered by Task 7 `engine snapshot layout matches the UI` and the worklet's mismatch error.

---

## File Structure

```
crates/core/src/kick.rs            MODIFY  norm-space smoothing API, recursive envelopes
crates/core/src/modulation.rs      CREATE  ModSettings, Modulator, ModMatrix, ParamRef, Route
crates/core/src/macros.rs          CREATE  Macros (A/B targets, smoothed positions)
crates/core/src/lib.rs             MODIFY  module list
crates/core/src/engine.rs          MODIFY  integrate mods + macros, snapshot array, new commands
crates/core/tests/render.rs        MODIFY  full-modulation benchmark
crates/wasm/src/lib.rs             MODIFY  new exports
web/src/state/types.ts             REPLACE add modulator / route / macro / learn state
web/src/state/modulation.ts        CREATE  UI mirrors of codes, defaults, labels, previews (Task 7)
web/src/state/store.ts             REPLACE modulation + macro actions, learn, helpers
web/src/audio/exports.ts           REPLACE new export types
web/src/audio/ops.ts               REPLACE CMD_WORDS 16, new ops + builders
web/src/audio/dispatch.ts          REPLACE new cases
web/src/audio/snapshot.ts          REPLACE layout mirror + accessors
web/src/audio/worklet.ts           REPLACE copy engine snapshot, layout check
web/src/ui/bpmDraft.ts             CREATE  parse helper
web/src/ui/TransportBar.tsx        REPLACE BPM draft fix
web/src/ui/useEngineFrame.ts       CREATE  per-frame snapshot copy
web/src/ui/usePlayheads.ts         DELETE  (Task 11)
web/src/ui/Knob.tsx                REPLACE mod ring, live dot, A/B markers, drop target, keys
web/src/ui/ModStrip.tsx            CREATE  modulator editor + 16 tiles
web/src/ui/MacroFaders.tsx         CREATE  8 A/B faders with LEARN
web/src/ui/MachinePanel.tsx        REPLACE knobs wired to mods/macros, route list, macros
web/src/ui/SequencerMatrix.tsx     MODIFY  section grows to fill its column
web/src/App.tsx                    REPLACE layout: matrix + mod strip | machine panel
tests: *.test.ts(x) next to each file
```

---

### Task 1: BPM field fix + component test setup

**Files:**
- Create: `web/src/ui/bpmDraft.ts`, `web/src/ui/bpmDraft.test.ts`, `web/src/ui/TransportBar.test.tsx`
- Replace: `web/src/ui/TransportBar.tsx`
- Modify: `web/package.json`, `web/package-lock.json` (dev deps)

**Interfaces:**
- Produces: `parseBpmDraft(draft: string): number | null` (null for empty or non-numeric input). `TransportBar` keeps its props `{ bpm, playing, starting, error, onTogglePlay, onBpm }`.
- Produces test setup: component tests start with the docblock `// @vitest-environment jsdom` and call `afterEach(cleanup)`.

- [ ] **Step 1: Install the component-test dependencies**

```bash
cd web && source ~/.nvm/nvm.sh && npm install -D jsdom @testing-library/react @testing-library/dom
```

- [ ] **Step 2: Write the failing tests**

`web/src/ui/bpmDraft.test.ts`:
```ts
import { expect, test } from 'vitest'
import { parseBpmDraft } from './bpmDraft'

test('parses decimal numbers', () => {
  expect(parseBpmDraft('140')).toBe(140)
  expect(parseBpmDraft(' 127.5 ')).toBe(127.5)
})

test('rejects empty and non-numeric drafts', () => {
  expect(parseBpmDraft('')).toBeNull()
  expect(parseBpmDraft('   ')).toBeNull()
  expect(parseBpmDraft('abc')).toBeNull()
  expect(parseBpmDraft('1e999')).toBeNull()
})
```

`web/src/ui/TransportBar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TransportBar } from './TransportBar'

afterEach(cleanup)

function setup(bpm = 128) {
  const onBpm = vi.fn()
  render(<TransportBar bpm={bpm} playing={false} starting={false} error={null} onTogglePlay={() => {}} onBpm={onBpm} />)
  const input = screen.getByLabelText('BPM') as HTMLInputElement
  return { onBpm, input }
}

test('typing does not change the tempo until Enter/blur', () => {
  const { onBpm, input } = setup()
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '1' } })
  fireEvent.change(input, { target: { value: '14' } })
  fireEvent.change(input, { target: { value: '140' } })
  expect(onBpm).not.toHaveBeenCalled()
  fireEvent.blur(input)
  expect(onBpm).toHaveBeenCalledWith(140)
})

test('Escape cancels the typed value', () => {
  const { onBpm, input } = setup()
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '90' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  fireEvent.blur(input)
  expect(onBpm).not.toHaveBeenCalled()
  expect(input.value).toBe('128')
})

test('an empty field restores the current tempo instead of jumping to 20', () => {
  const { onBpm, input } = setup()
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.blur(input)
  expect(onBpm).not.toHaveBeenCalled()
  expect(input.value).toBe('128')
})

test('arrow keys nudge the tempo live (shift = 1 BPM)', () => {
  const { onBpm, input } = setup(128)
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  expect(onBpm).toHaveBeenLastCalledWith(128.1)
  fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true })
  expect(onBpm).toHaveBeenLastCalledWith(127)
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/ui`
Expected: FAIL. `./bpmDraft` cannot be resolved, and TransportBar calls `onBpm` while typing / Escape commits.

- [ ] **Step 4: Implement**

`web/src/ui/bpmDraft.ts`:
```ts
export function parseBpmDraft(draft: string): number | null {
  if (draft.trim() === '') return null
  const n = Number(draft)
  return Number.isFinite(n) ? n : null
}
```

`web/src/ui/TransportBar.tsx` (replace):
```tsx
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { parseBpmDraft } from './bpmDraft'

interface Props {
  bpm: number
  playing: boolean
  starting: boolean
  error: string | null
  onTogglePlay(): void
  onBpm(bpm: number): void
}

/** The BPM field commits on Enter/blur only, so a half-typed value never reaches the live tempo. */
export function TransportBar({ bpm, playing, starting, error, onTogglePlay, onBpm }: Props) {
  const [draft, setDraft] = useState(String(bpm))
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false)
  useEffect(() => {
    if (!editing) setDraft(String(bpm))
  }, [bpm, editing])

  const commit = () => {
    setEditing(false)
    const value = parseBpmDraft(draft)
    if (cancelled.current || value === null) {
      cancelled.current = false
      setDraft(String(bpm))
      return
    }
    onBpm(value)
  }

  const nudge = (delta: number) => onBpm(Math.round((bpm + delta) * 10) / 10)

  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1.5">
      <b>utero</b>
      <Button size="sm" variant={playing ? 'default' : 'outline'} onClick={onTogglePlay} disabled={starting} aria-busy={starting} aria-label={playing ? 'Stop' : 'Play'}>
        {playing ? '■ STOP' : '▶ PLAY'}
      </Button>
      <label className="flex items-center gap-1 text-zinc-400">
        BPM
        <input type="text" inputMode="decimal" value={draft}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              cancelled.current = true
              e.currentTarget.blur()
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const step = e.shiftKey ? 1 : 0.1
              nudge(e.key === 'ArrowUp' ? step : -step)
            }
          }}
          className="w-16 rounded bg-zinc-900 px-1 py-0.5 text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc" />
      </label>
      {error && <span role="alert" className="text-red-400">{error}</span>}
      <span className="ml-auto text-zinc-500">⌥+klikk = sávhossz</span>
    </header>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/ui && npx tsc --noEmit`
Expected: bpmDraft 2 and TransportBar 4 pass; tsc reports no errors.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/ui/bpmDraft.ts web/src/ui/bpmDraft.test.ts web/src/ui/TransportBar.tsx web/src/ui/TransportBar.test.tsx
git commit -m "fix(web): bpm field commits on enter/blur, escape cancels, empty restores

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 2: Kick: normalised-space smoothing and recursive envelopes

**Files:**
- Modify: `crates/core/src/kick.rs`

**Interfaces:**
- Consumes: `dsp::{Smoother, Drive2x, one_pole_coef}`, `params::ParamDesc`, `rng::Rng` (unchanged).
- Produces (changed `KickParams` API):
  - `KickParams::new(sample_rate)`
  - `.set_norm(i, norm)`: base target in normalised space; bad index or non-finite norm is ignored
  - `.next_norms() -> [f32; KICK_PARAM_COUNT]`: one smoothing step of the base norms
  - `.apply_norms(&[f32; KICK_PARAM_COUNT])`: maps final norms to units
  - `.advance()`: `next_norms` + `apply_norms`, with no macros or modulation
  - `.get(i) -> f32`
- Produces: `KickVoice::envelope(&self) -> f32` (current amplitude envelope, for tests and later UI). The `KickVoice` render/trigger signatures are unchanged.

- [ ] **Step 1: Write the failing tests.** Append inside `mod tests` in `kick.rs`.

```rust
    #[test]
    fn apply_norms_maps_final_values() {
        let mut p = KickParams::new(SR);
        p.apply_norms(&[1.0; KICK_PARAM_COUNT]);
        assert_eq!(p.get(TUNE), 120.0);
        assert_eq!(p.get(DECAY), 2000.0);
        p.apply_norms(&[0.0; KICK_PARAM_COUNT]);
        assert_eq!(p.get(TUNE), 30.0);
    }

    #[test]
    fn next_norms_smooths_towards_base() {
        let mut p = KickParams::new(SR);
        p.set_norm(TUNE, 1.0);
        let first = p.next_norms()[TUNE];
        assert!(first > KICK_PARAMS[TUNE].default_norm && first < 0.4, "first {first}");
        for _ in 0..48_000 {
            p.next_norms();
        }
        assert!((p.next_norms()[TUNE] - 1.0).abs() < 1e-4);
    }

    #[test]
    fn non_finite_norm_is_ignored() {
        let mut p = KickParams::new(SR);
        p.set_norm(TUNE, f32::NAN);
        for _ in 0..1000 {
            p.advance();
        }
        assert!((p.get(TUNE) - 45.0).abs() < 0.5);
    }

    #[test]
    fn amp_envelope_never_rises_when_decay_is_modulated() {
        let mut v = KickVoice::new(SR, 1);
        let mut p = KickParams::new(SR);
        v.trigger(1.0, &mut Rng::new(3));
        let mut prev = v.envelope();
        for i in 0..24_000 {
            if i % 1000 == 0 {
                p.set_norm(DECAY, if (i / 1000) % 2 == 0 { 1.0 } else { 0.0 });
            }
            p.advance();
            v.render(&p);
            let e = v.envelope();
            assert!(e <= prev, "envelope rose at sample {i}: {prev} -> {e}");
            prev = e;
        }
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core kick`
Expected: compile errors (`apply_norms`, `next_norms`, `envelope` not found).

- [ ] **Step 3: Replace the `KickParams` struct + impl** (everything from `pub struct KickParams` to the end of its `impl`)

```rust
/// Base values are smoothed in normalised space so macros and modulation can be added before mapping.
pub struct KickParams {
    smooth: [Smoother; KICK_PARAM_COUNT],
    values: [f32; KICK_PARAM_COUNT],
}

impl KickParams {
    pub fn new(sample_rate: f32) -> Self {
        let smooth = core::array::from_fn(|i| Smoother::new(KICK_PARAMS[i].default_norm, 10.0, sample_rate));
        let values = core::array::from_fn(|i| KICK_PARAMS[i].map(KICK_PARAMS[i].default_norm));
        KickParams { smooth, values }
    }

    pub fn set_norm(&mut self, i: usize, norm: f32) {
        if !norm.is_finite() {
            return;
        }
        if let Some(s) = self.smooth.get_mut(i) {
            s.set(norm.clamp(0.0, 1.0));
        }
    }

    pub fn next_norms(&mut self) -> [f32; KICK_PARAM_COUNT] {
        core::array::from_fn(|i| self.smooth[i].next())
    }

    pub fn apply_norms(&mut self, norms: &[f32; KICK_PARAM_COUNT]) {
        for i in 0..KICK_PARAM_COUNT {
            self.values[i] = KICK_PARAMS[i].map(norms[i]);
        }
    }

    pub fn advance(&mut self) {
        let norms = self.next_norms();
        self.apply_norms(&norms);
    }

    pub fn get(&self, i: usize) -> f32 {
        self.values[i]
    }
}
```

- [ ] **Step 4: Replace `KickVoice`** (struct + impl) with the recursive-envelope version

```rust
pub struct KickVoice {
    sample_rate: f32,
    phase: f32,
    t: u32,
    active: bool,
    vel: f32,
    drift: f32,
    amp: f32,
    pitch_env: f32,
    click_env: f32,
    click_coef: f32,
    lp: f32,
    drive: Drive2x,
    rng: Rng,
}

impl KickVoice {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        KickVoice {
            sample_rate,
            phase: 0.0,
            t: 0,
            active: false,
            vel: 0.0,
            drift: 0.0,
            amp: 0.0,
            pitch_env: 0.0,
            click_env: 0.0,
            click_coef: (-1.0 / (0.002 * sample_rate)).exp(),
            lp: 0.0,
            drive: Drive2x::new(),
            rng: Rng::new(seed),
        }
    }

    pub fn trigger(&mut self, vel: f32, rng: &mut Rng) {
        self.t = 0;
        self.phase = 0.0;
        self.active = true;
        self.amp = 1.0;
        self.pitch_env = 1.0;
        self.click_env = 1.0;
        self.lp = 0.0;
        self.drive = Drive2x::new();
        self.vel = vel.clamp(0.0, 1.0);
        // ±1% pitch per hit: no two kicks are identical, like an analog circuit.
        self.drift = rng.bipolar() * 0.01;
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn envelope(&self) -> f32 {
        self.amp
    }

    pub fn render(&mut self, p: &KickParams) -> f32 {
        if !self.active {
            return 0.0;
        }
        let sr = self.sample_rate;
        let noise = self.rng.bipolar();
        let nz = p.get(NOISE);

        // NOISE both adds a layer and micro-modulates pitch and amplitude.
        let semis = p.get(SWEEP) * self.pitch_env;
        let freq = p.get(TUNE) * (1.0 + self.drift) * (semis / 12.0).exp2() * (1.0 + noise * nz * 0.02);
        self.phase += freq / sr;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let body = (self.phase * TAU).sin() * self.amp * (1.0 + noise * nz * 0.3);
        let impulse = if self.t == 0 { 1.0 } else { 0.0 };
        let click = (impulse + noise * 0.6) * self.click_env * p.get(CLICK);
        let layer = noise * nz * 0.15 * self.amp;

        let x = self.drive.process(body + click + layer, p.get(DRIVE));
        self.lp += (x - self.lp) * one_pole_coef(p.get(TONE), sr);
        if !self.lp.is_finite() {
            self.lp = 0.0;
            self.drive = Drive2x::new();
        }
        let out = self.lp * self.vel * p.get(LEVEL);

        // Recursive envelopes: modulating DECAY/S.TIME bends the curve, never jumps or swells.
        self.amp *= (-1.0 / (p.get(DECAY) * 0.001 * sr)).exp();
        self.pitch_env *= (-1.0 / (p.get(STIME) * 0.001 * sr)).exp();
        self.click_env *= self.click_coef;
        self.t = self.t.saturating_add(1);
        if self.amp < 1.0e-4 && self.t as f32 > 0.01 * sr {
            self.active = false;
        }
        out
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core`
Expected: all pass, including the existing kick, engine and render tests and the 4 new ones, with no warnings.

- [ ] **Step 6: Commit**

```bash
git add crates/core/src/kick.rs
git commit -m "feat(core): smooth kick params in normalised space and use recursive envelopes

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 3: Modulator DSP

**Files:**
- Create: `crates/core/src/modulation.rs` (first half)
- Modify: `crates/core/src/lib.rs` (add `pub mod modulation;` alphabetically)

**Interfaces:**
- Consumes: `rng::Rng`.
- Produces:
  - Constants:
    - `STEP_COUNT = 16`
    - `SYNC_BARS: [f32; 10] = [0.0625, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0]`
  - Enums with `from_code(u8)`; unknown codes map to the first variant:
    - `ModKind { Off, Lfo, Noise, Step }` (codes 0–3)
    - `Shape { Sin, Glide, SampleHold, Tri, Saw, Ramp, Sqr, Exp, Drift }` (codes 0–8)
    - `NoiseColor { White, Pink, Crackle }`
    - `TrigMode { Free, Retrig, OneShot }`
  - `ModSettings { kind, shape, color, sync: bool, rate_index: u8, hz: f32, phase: f32, bipolar: bool, trig_mode, trig_src: i8, smooth: f32, depth: f32 }`
    - `Default`: Off, Sin, White, sync true, rate_index 6, hz 1.0, phase 0, bipolar true, Free, trig_src −1, smooth 0, depth 1
    - `.sanitized()`
  - `Modulator::new(seed: u32)`, with methods:
    - `.settings()`, `.set_settings(ModSettings)`
    - `.set_step(i, v)`, `.set_step_len(len)`
    - `.restart()`, `.on_trigger()`
    - `.next(inc: f32) -> f32`, where `inc` is cycles per sample
    - `.output() -> f32`
  - Output semantics: bipolar gives −1..1 × depth; unipolar gives 0..1 × depth. S&H with `trig_src >= 0` changes value only on triggers.

- [ ] **Step 1: Write the failing tests.** Create `crates/core/src/modulation.rs` containing only the test module for now. Step 3 puts the implementation above it.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn lfo(shape: Shape) -> Modulator {
        let mut m = Modulator::new(7);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape, ..ModSettings::default() });
        m
    }

    fn run(m: &mut Modulator, n: usize, inc: f32) -> Vec<f32> {
        (0..n).map(|_| m.next(inc)).collect()
    }

    #[test]
    fn off_outputs_zero() {
        let mut m = Modulator::new(1);
        assert!(run(&mut m, 100, 0.01).iter().all(|&v| v == 0.0));
    }

    #[test]
    fn sin_peaks_at_quarter_cycle() {
        let mut m = lfo(Shape::Sin);
        let out = run(&mut m, 100, 1.0 / 400.0);
        assert!((out[99] - 1.0).abs() < 1e-3, "{}", out[99]);
    }

    #[test]
    fn every_shape_stays_in_range() {
        for code in 0..9 {
            let mut m = lfo(Shape::from_code(code));
            for v in run(&mut m, 10_000, 0.01) {
                assert!(v.is_finite() && v.abs() <= 1.0 + 1e-6, "shape {code}: {v}");
            }
        }
    }

    #[test]
    fn unipolar_and_depth_scale_output() {
        let mut m = Modulator::new(1);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape: Shape::Sqr, bipolar: false, depth: 0.5, ..ModSettings::default() });
        let out = run(&mut m, 200, 0.01);
        assert!(out.iter().all(|&v| (0.0..=0.5).contains(&v)));
        assert!(out.iter().any(|&v| v == 0.5) && out.iter().any(|&v| v == 0.0));
    }

    #[test]
    fn sample_hold_holds_within_a_cycle() {
        let mut m = lfo(Shape::SampleHold);
        run(&mut m, 150, 0.01); // past the first wrap, mid-cycle
        let cycle = run(&mut m, 40, 0.01);
        assert!(cycle.windows(2).all(|w| w[0] == w[1]));
    }

    #[test]
    fn sample_hold_with_trigger_source_changes_only_on_trigger() {
        let mut m = Modulator::new(3);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape: Shape::SampleHold, trig_src: 0, ..ModSettings::default() });
        m.on_trigger();
        let held = run(&mut m, 1000, 0.05);
        assert!(held.windows(2).all(|w| w[0] == w[1]));
        let before = m.output();
        m.on_trigger();
        assert_ne!(m.next(0.05), before);
    }

    #[test]
    fn retrig_restarts_phase() {
        let mut m = Modulator::new(1);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, trig_mode: TrigMode::Retrig, ..ModSettings::default() });
        run(&mut m, 50, 0.01);
        m.on_trigger();
        assert!((m.next(0.01) - (-0.98)).abs() < 1e-3);
    }

    #[test]
    fn one_shot_holds_the_end_value() {
        let mut m = Modulator::new(1);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, trig_mode: TrigMode::OneShot, ..ModSettings::default() });
        let out = run(&mut m, 300, 0.01);
        assert!(out[150] > 0.99 && out[299] > 0.99);
    }

    #[test]
    fn step_sequence_plays_its_values() {
        let mut m = Modulator::new(1);
        m.set_settings(ModSettings { kind: ModKind::Step, ..ModSettings::default() });
        m.set_step(0, -1.0);
        m.set_step(1, 1.0);
        m.set_step_len(2);
        let out = run(&mut m, 100, 0.01);
        assert_eq!(out[10], -1.0);
        assert_eq!(out[60], 1.0);
    }

    #[test]
    fn noise_colours_are_bounded() {
        for code in 0..3 {
            let mut m = Modulator::new(9);
            m.set_settings(ModSettings { kind: ModKind::Noise, color: NoiseColor::from_code(code), ..ModSettings::default() });
            assert!(run(&mut m, 48_000, 0.0).iter().all(|v| v.is_finite() && v.abs() <= 1.0));
        }
    }

    #[test]
    fn smoothing_slows_changes() {
        let mut m = Modulator::new(1);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape: Shape::Sqr, smooth: 1.0, ..ModSettings::default() });
        let out = run(&mut m, 2000, 0.01);
        assert!(out.windows(2).all(|w| (w[1] - w[0]).abs() < 0.01));
    }

    #[test]
    fn sanitized_settings_are_safe() {
        let s = ModSettings { rate_index: 255, hz: f32::NAN, phase: f32::INFINITY, smooth: -3.0, depth: 9.0, trig_src: -100, ..ModSettings::default() }.sanitized();
        assert_eq!(s.rate_index, 9);
        assert_eq!(s.hz, 1.0);
        assert_eq!(s.phase, 0.0);
        assert_eq!(s.smooth, 0.0);
        assert_eq!(s.depth, 1.0);
        assert_eq!(s.trig_src, -1);
    }

    #[test]
    fn same_seed_is_deterministic() {
        let a = run(&mut lfo(Shape::Glide), 5000, 0.01);
        let b = run(&mut lfo(Shape::Glide), 5000, 0.01);
        assert_eq!(a, b);
    }
}
```

Add to `crates/core/src/lib.rs` (alphabetical): `pub mod modulation;`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core modulation`
Expected: compile errors (`Modulator`, `ModSettings` not found).

- [ ] **Step 3: Implement** (above the tests)

```rust
use core::f32::consts::{PI, TAU};

use crate::rng::Rng;

pub const STEP_COUNT: usize = 16;

/// Sync rates in 4/4 bars. Index order is mirrored by SYNC_LABELS in web/src/state/modulation.ts.
pub const SYNC_BARS: [f32; 10] = [0.0625, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModKind {
    Off,
    Lfo,
    Noise,
    Step,
}

impl ModKind {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => ModKind::Lfo,
            2 => ModKind::Noise,
            3 => ModKind::Step,
            _ => ModKind::Off,
        }
    }
}

/// Codes mirror SHAPES in web/src/state/modulation.ts; the favourites come first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Sin,
    Glide,
    SampleHold,
    Tri,
    Saw,
    Ramp,
    Sqr,
    Exp,
    Drift,
}

impl Shape {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => Shape::Glide,
            2 => Shape::SampleHold,
            3 => Shape::Tri,
            4 => Shape::Saw,
            5 => Shape::Ramp,
            6 => Shape::Sqr,
            7 => Shape::Exp,
            8 => Shape::Drift,
            _ => Shape::Sin,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoiseColor {
    White,
    Pink,
    Crackle,
}

impl NoiseColor {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => NoiseColor::Pink,
            2 => NoiseColor::Crackle,
            _ => NoiseColor::White,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrigMode {
    Free,
    Retrig,
    OneShot,
}

impl TrigMode {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => TrigMode::Retrig,
            2 => TrigMode::OneShot,
            _ => TrigMode::Free,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ModSettings {
    pub kind: ModKind,
    pub shape: Shape,
    pub color: NoiseColor,
    pub sync: bool,
    pub rate_index: u8,
    pub hz: f32,
    pub phase: f32,
    pub bipolar: bool,
    pub trig_mode: TrigMode,
    pub trig_src: i8,
    pub smooth: f32,
    pub depth: f32,
}

impl Default for ModSettings {
    fn default() -> Self {
        ModSettings {
            kind: ModKind::Off,
            shape: Shape::Sin,
            color: NoiseColor::White,
            sync: true,
            rate_index: 6,
            hz: 1.0,
            phase: 0.0,
            bipolar: true,
            trig_mode: TrigMode::Free,
            trig_src: -1,
            smooth: 0.0,
            depth: 1.0,
        }
    }
}

impl ModSettings {
    /// Values arrive from JS unchecked; this keeps every later index and division safe.
    pub fn sanitized(self) -> Self {
        let finite_or = |v: f32, d: f32| if v.is_finite() { v } else { d };
        ModSettings {
            rate_index: self.rate_index.min((SYNC_BARS.len() - 1) as u8),
            hz: finite_or(self.hz, 1.0).clamp(0.01, 40.0),
            phase: finite_or(self.phase, 0.0).rem_euclid(1.0),
            smooth: finite_or(self.smooth, 0.0).clamp(0.0, 1.0),
            depth: finite_or(self.depth, 1.0).clamp(0.0, 1.0),
            trig_src: self.trig_src.max(-1),
            ..self
        }
    }
}

pub struct Modulator {
    settings: ModSettings,
    steps: [f32; STEP_COUNT],
    step_len: u8,
    phase: f32,
    from: f32,
    to: f32,
    smoothed: f32,
    pink: [f32; 3],
    crackle: f32,
    done: bool,
    out: f32,
    rng: Rng,
}

impl Modulator {
    pub fn new(seed: u32) -> Self {
        let mut rng = Rng::new(seed);
        let to = rng.bipolar();
        Modulator {
            settings: ModSettings::default(),
            steps: [0.0; STEP_COUNT],
            step_len: STEP_COUNT as u8,
            phase: 0.0,
            from: 0.0,
            to,
            smoothed: 0.0,
            pink: [0.0; 3],
            crackle: 0.0,
            done: false,
            out: 0.0,
            rng,
        }
    }

    pub fn settings(&self) -> ModSettings {
        self.settings
    }

    pub fn set_settings(&mut self, s: ModSettings) {
        self.settings = s.sanitized();
    }

    pub fn set_step(&mut self, i: usize, v: f32) {
        if let (Some(x), true) = (self.steps.get_mut(i), v.is_finite()) {
            *x = v.clamp(-1.0, 1.0);
        }
    }

    pub fn set_step_len(&mut self, len: u8) {
        self.step_len = len.clamp(1, STEP_COUNT as u8);
    }

    pub fn restart(&mut self) {
        self.phase = self.settings.phase;
        self.done = false;
        self.new_target();
    }

    /// Called when the track named in `trig_src` fires.
    pub fn on_trigger(&mut self) {
        match self.settings.trig_mode {
            TrigMode::Retrig | TrigMode::OneShot => self.restart(),
            TrigMode::Free => {
                if self.settings.shape == Shape::SampleHold {
                    self.new_target();
                }
            }
        }
    }

    pub fn output(&self) -> f32 {
        self.out
    }

    /// Advances by `inc` cycles and returns the output (bipolar −1..1 or unipolar 0..1, times depth).
    pub fn next(&mut self, inc: f32) -> f32 {
        let s = self.settings;
        let raw = match s.kind {
            ModKind::Off => {
                self.out = 0.0;
                return 0.0;
            }
            ModKind::Lfo => self.lfo(s, inc),
            ModKind::Noise => self.noise(s.color),
            ModKind::Step => {
                self.advance_phase(inc);
                let len = self.step_len as usize;
                self.steps[((self.phase * len as f32) as usize).min(len - 1)]
            }
        };
        let k = 1.0 / (1.0 + s.smooth * 2000.0);
        self.smoothed += (raw - self.smoothed) * k;
        let v = if s.bipolar { self.smoothed } else { (self.smoothed + 1.0) * 0.5 };
        self.out = v * s.depth;
        self.out
    }

    fn new_target(&mut self) {
        self.from = self.to;
        self.to = if self.settings.shape == Shape::Drift {
            (self.to + self.rng.bipolar() * 0.5).clamp(-1.0, 1.0)
        } else {
            self.rng.bipolar()
        };
    }

    /// Returns true when the phase wrapped on this sample.
    fn advance_phase(&mut self, inc: f32) -> bool {
        if self.done {
            return false;
        }
        self.phase += inc;
        if self.phase < 1.0 {
            return false;
        }
        if self.settings.trig_mode == TrigMode::OneShot {
            self.phase = 1.0 - f32::EPSILON;
            self.done = true;
            return false;
        }
        self.phase -= self.phase.floor();
        true
    }

    fn lfo(&mut self, s: ModSettings, inc: f32) -> f32 {
        let wrapped = self.advance_phase(inc);
        let random = matches!(s.shape, Shape::Glide | Shape::SampleHold | Shape::Drift);
        let trigger_driven = s.shape == Shape::SampleHold && s.trig_src >= 0;
        if wrapped && random && !trigger_driven {
            self.new_target();
        }
        let p = self.phase;
        match s.shape {
            Shape::Sin => (p * TAU).sin(),
            Shape::Tri => 1.0 - 4.0 * (p - 0.5).abs(),
            Shape::Saw => 1.0 - 2.0 * p,
            Shape::Ramp => 2.0 * p - 1.0,
            Shape::Sqr => {
                if p < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            Shape::Exp => 2.0 * (-5.0 * p).exp() - 1.0,
            Shape::SampleHold => self.to,
            Shape::Glide | Shape::Drift => {
                let t = 0.5 - 0.5 * (p * PI).cos();
                self.from + (self.to - self.from) * t
            }
        }
    }

    fn noise(&mut self, color: NoiseColor) -> f32 {
        let w = self.rng.bipolar();
        match color {
            NoiseColor::White => w,
            NoiseColor::Pink => {
                self.pink[0] = 0.99765 * self.pink[0] + w * 0.099_046;
                self.pink[1] = 0.963 * self.pink[1] + w * 0.296_516_4;
                self.pink[2] = 0.57 * self.pink[2] + w * 1.052_691_3;
                ((self.pink[0] + self.pink[1] + self.pink[2] + w * 0.1848) * 0.25).clamp(-1.0, 1.0)
            }
            NoiseColor::Crackle => {
                // Sparse vinyl-like impulses that die out fast.
                if self.rng.next_f32() < 0.0015 {
                    self.crackle = self.rng.bipolar();
                } else {
                    self.crackle *= 0.9;
                }
                self.crackle
            }
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core modulation`
Expected: 13 passed, no warnings. If a test fails because of a number in this plan rather than your code, report BLOCKED with the measured value. Do not change the tests on your own.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/modulation.rs
git commit -m "feat(core): add modulator with lfo shapes, noise and step sequence

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 4: Modulation matrix with fading routes

**Files:**
- Modify: `crates/core/src/modulation.rs` (append the matrix above the test module, and add tests)

**Interfaces:**
- Consumes: Task 3 `Modulator`, `ModSettings`, `SYNC_BARS`.
- Produces:
  - Constants: `MOD_SLOTS = 16`, `MAX_ROUTES = 64`, `MOD_TRACKS = 13`, `MOD_PARAMS = 16`
  - Types:
    - `ParamRef { track: u8, param: u8 }` (Copy, Eq)
    - `Route { src: u8, target: ParamRef, amount: f32 }`
  - `ModMatrix::new()` (and `Default`), with methods:
    - Configuration: `.set_modulator(slot, ModSettings)`, `.set_step(slot, i, v)`, `.set_step_len(slot, len)`
    - Routes: `.set_route(index, Route)`, `.clear_route(index)`
    - Triggers: `.restart()`, `.on_track_trigger(track)`
    - Per sample: `.advance(bpm: f32, sample_rate: f32)`
    - Readout: `.sum(track, param) -> f32`, `.output(slot) -> f32`
  - Semantics:
    - Route amounts are clamped to ±1.
    - The applied amount fades towards the target at 0.002 per sample, about 10 ms.
    - A cleared route fades to 0 and then frees its index.
    - Invalid input is ignored.

- [ ] **Step 1: Write the failing tests.** Append inside `mod tests`.

```rust
    fn square_mod(m: &mut ModMatrix, slot: usize) {
        // Unsynced 0.01 Hz square: stays at +1 for the first 50 s.
        m.set_modulator(slot, ModSettings { kind: ModKind::Lfo, shape: Shape::Sqr, sync: false, hz: 0.01, ..ModSettings::default() });
    }

    fn advance(m: &mut ModMatrix, n: usize) {
        for _ in 0..n {
            m.advance(120.0, 48_000.0);
        }
    }

    fn route(src: u8, track: u8, param: u8, amount: f32) -> Route {
        Route { src, target: ParamRef { track, param }, amount }
    }

    #[test]
    fn route_adds_scaled_output_after_fade_in() {
        let mut m = ModMatrix::new();
        square_mod(&mut m, 0);
        m.set_route(0, route(0, 0, 3, 0.5));
        advance(&mut m, 1);
        assert!(m.sum(0, 3) < 0.01, "fades in, does not jump");
        advance(&mut m, 4800);
        assert!((m.sum(0, 3) - 0.5).abs() < 0.01);
        assert_eq!(m.sum(0, 2), 0.0);
    }

    #[test]
    fn routes_to_the_same_target_add_up() {
        let mut m = ModMatrix::new();
        square_mod(&mut m, 0);
        square_mod(&mut m, 1);
        m.set_route(0, route(0, 1, 0, 0.25));
        m.set_route(1, route(1, 1, 0, 0.5));
        advance(&mut m, 4800);
        assert!((m.sum(1, 0) - 0.75).abs() < 0.01);
    }

    #[test]
    fn removed_route_fades_out_without_jump() {
        let mut m = ModMatrix::new();
        square_mod(&mut m, 0);
        m.set_route(0, route(0, 0, 0, 1.0));
        advance(&mut m, 4800);
        let mut prev = m.sum(0, 0);
        m.clear_route(0);
        for _ in 0..4800 {
            m.advance(120.0, 48_000.0);
            let s = m.sum(0, 0);
            assert!((prev - s).abs() <= 0.0021, "step {prev} -> {s}");
            prev = s;
        }
        advance(&mut m, 48_000);
        assert_eq!(m.sum(0, 0), 0.0);
    }

    #[test]
    fn invalid_routes_are_ignored() {
        let mut m = ModMatrix::new();
        square_mod(&mut m, 0);
        m.set_route(0, route(99, 0, 0, 0.5));
        m.set_route(1, route(0, 99, 0, 0.5));
        m.set_route(2, route(0, 0, 99, 0.5));
        m.set_route(3, route(0, 0, 0, f32::NAN));
        m.set_route(999, route(0, 0, 0, 0.5));
        m.clear_route(999);
        m.set_modulator(99, ModSettings::default());
        m.set_step(99, 0, 1.0);
        m.set_step_len(99, 4);
        advance(&mut m, 4800);
        assert_eq!(m.sum(0, 0), 0.0);
        assert_eq!(m.sum(99, 99), 0.0);
        assert_eq!(m.output(99), 0.0);
    }

    #[test]
    fn amounts_are_clamped() {
        let mut m = ModMatrix::new();
        square_mod(&mut m, 0);
        m.set_route(0, route(0, 0, 0, 5.0));
        advance(&mut m, 48_000);
        assert!((m.sum(0, 0) - 1.0).abs() < 0.01);
    }

    #[test]
    fn sync_rate_follows_bpm() {
        let mut m = ModMatrix::new();
        // Unipolar ramp = phase; 1 bar at 120 bpm = 2 s = 96 000 samples.
        m.set_modulator(0, ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, bipolar: false, rate_index: 4, ..ModSettings::default() });
        advance(&mut m, 48_000);
        assert!((m.output(0) - 0.5).abs() < 0.01, "{}", m.output(0));
    }

    #[test]
    fn track_trigger_only_restarts_matching_modulators() {
        let mut m = ModMatrix::new();
        for (slot, src) in [(0, 0), (1, 1)] {
            m.set_modulator(slot, ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, bipolar: false, sync: false, hz: 1.0, trig_mode: TrigMode::Retrig, trig_src: src, ..ModSettings::default() });
        }
        advance(&mut m, 24_000);
        m.on_track_trigger(1);
        advance(&mut m, 1);
        assert!(m.output(1) < 0.01);
        assert!(m.output(0) > 0.4);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core modulation`
Expected: compile errors (`ModMatrix`, `Route`, `ParamRef` not found).

- [ ] **Step 3: Implement.** Append above `#[cfg(test)]`.

```rust
pub const MOD_SLOTS: usize = 16;
pub const MAX_ROUTES: usize = 64;
pub const MOD_TRACKS: usize = 13;
pub const MOD_PARAMS: usize = 16;

/// Per-sample fade of route amounts (~10 ms at 48 kHz): adding or removing a route never clicks.
const ROUTE_FADE: f32 = 0.002;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParamRef {
    pub track: u8,
    pub param: u8,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Route {
    pub src: u8,
    pub target: ParamRef,
    pub amount: f32,
}

#[derive(Clone, Copy, Debug)]
struct RouteSlot {
    route: Route,
    current: f32,
    live: bool,
}

pub struct ModMatrix {
    mods: [Modulator; MOD_SLOTS],
    routes: [Option<RouteSlot>; MAX_ROUTES],
    sums: [[f32; MOD_PARAMS]; MOD_TRACKS],
}

impl Default for ModMatrix {
    fn default() -> Self {
        Self::new()
    }
}

impl ModMatrix {
    pub fn new() -> Self {
        ModMatrix {
            mods: core::array::from_fn(|i| Modulator::new(0x000A_11CE + i as u32)),
            routes: [None; MAX_ROUTES],
            sums: [[0.0; MOD_PARAMS]; MOD_TRACKS],
        }
    }

    pub fn set_modulator(&mut self, slot: usize, s: ModSettings) {
        if let Some(m) = self.mods.get_mut(slot) {
            m.set_settings(s);
        }
    }

    pub fn set_step(&mut self, slot: usize, i: usize, v: f32) {
        if let Some(m) = self.mods.get_mut(slot) {
            m.set_step(i, v);
        }
    }

    pub fn set_step_len(&mut self, slot: usize, len: u8) {
        if let Some(m) = self.mods.get_mut(slot) {
            m.set_step_len(len);
        }
    }

    pub fn set_route(&mut self, index: usize, route: Route) {
        let valid = (route.src as usize) < MOD_SLOTS
            && (route.target.track as usize) < MOD_TRACKS
            && (route.target.param as usize) < MOD_PARAMS
            && route.amount.is_finite();
        let Some(slot) = self.routes.get_mut(index) else { return };
        if !valid {
            return;
        }
        let route = Route { amount: route.amount.clamp(-1.0, 1.0), ..route };
        match slot {
            Some(rs) if rs.route.src == route.src && rs.route.target == route.target => {
                rs.route.amount = route.amount;
                rs.live = true;
            }
            _ => *slot = Some(RouteSlot { route, current: 0.0, live: true }),
        }
    }

    pub fn clear_route(&mut self, index: usize) {
        if let Some(Some(rs)) = self.routes.get_mut(index) {
            rs.live = false;
        }
    }

    pub fn restart(&mut self) {
        for m in &mut self.mods {
            m.restart();
        }
    }

    pub fn on_track_trigger(&mut self, track: usize) {
        for m in &mut self.mods {
            let src = m.settings().trig_src;
            if src >= 0 && src as usize == track {
                m.on_trigger();
            }
        }
    }

    /// One sample: advances every modulator and rebuilds the per-target sums.
    pub fn advance(&mut self, bpm: f32, sample_rate: f32) {
        let samples_per_bar = 4.0 * 60.0 / bpm.max(1.0) * sample_rate;
        for m in &mut self.mods {
            let s = m.settings();
            let inc = if s.sync { 1.0 / (SYNC_BARS[s.rate_index as usize] * samples_per_bar) } else { s.hz / sample_rate };
            m.next(inc);
        }
        self.sums = [[0.0; MOD_PARAMS]; MOD_TRACKS];
        for slot in &mut self.routes {
            let Some(rs) = slot else { continue };
            let target = if rs.live { rs.route.amount } else { 0.0 };
            rs.current += (target - rs.current) * ROUTE_FADE;
            if !rs.live && rs.current.abs() < 1.0e-4 {
                *slot = None;
                continue;
            }
            let t = rs.route.target;
            self.sums[t.track as usize][t.param as usize] += rs.current * self.mods[rs.route.src as usize].output();
        }
    }

    pub fn sum(&self, track: usize, param: usize) -> f32 {
        self.sums.get(track).and_then(|row| row.get(param)).copied().unwrap_or(0.0)
    }

    pub fn output(&self, slot: usize) -> f32 {
        self.mods.get(slot).map_or(0.0, |m| m.output())
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core modulation`
Expected: 20 passed, no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/modulation.rs
git commit -m "feat(core): add modulation matrix with fading routes

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 5: A/B macros

**Files:**
- Create: `crates/core/src/macros.rs`
- Modify: `crates/core/src/lib.rs` (add `pub mod macros;` alphabetically)

**Interfaces:**
- Consumes: `dsp::Smoother`, `modulation::ParamRef`.
- Produces:
  - Constants: `MACROS = 8`, `MACRO_TARGETS = 16`
  - `MacroTarget { target: ParamRef, a: f32, b: f32 }`
  - `Macros::new(sample_rate)`, with methods:
    - `.set_target(m, i, MacroTarget)`, `.clear_target(m, i)`
    - `.set_pos(m, pos)`
    - `.advance()`: one smoothing step per sample, 15 ms
    - `.apply(track: u8, norms: &mut [f32])`
  - Semantics:
    - `a` and `b` are clamped to 0..1, and a non-finite input is ignored.
    - `apply` overrides with `a + (b − a) × pos`; on a shared target the later macro wins.

- [ ] **Step 1: Write the failing tests** in `crates/core/src/macros.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn target(track: u8, param: u8, a: f32, b: f32) -> MacroTarget {
        MacroTarget { target: ParamRef { track, param }, a, b }
    }

    fn settle(m: &mut Macros) {
        for _ in 0..48_000 {
            m.advance();
        }
    }

    #[test]
    fn no_targets_leave_values_alone() {
        let m = Macros::new(SR);
        let mut v = [0.3_f32; 9];
        m.apply(0, &mut v);
        assert_eq!(v, [0.3; 9]);
    }

    #[test]
    fn interpolates_between_a_and_b() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 2, 0.2, 0.8));
        m.set_pos(0, 0.5);
        settle(&mut m);
        let mut v = [0.0_f32; 9];
        m.apply(0, &mut v);
        assert!((v[2] - 0.5).abs() < 1e-3);
    }

    #[test]
    fn position_is_smoothed() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 0, 0.0, 1.0));
        m.set_pos(0, 1.0);
        m.advance();
        let mut v = [0.0_f32; 9];
        m.apply(0, &mut v);
        assert!(v[0] < 0.1, "{}", v[0]);
    }

    #[test]
    fn other_tracks_are_untouched() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(1, 0, 0.9, 0.9));
        settle(&mut m);
        let mut v = [0.1_f32; 9];
        m.apply(0, &mut v);
        assert_eq!(v[0], 0.1);
    }

    #[test]
    fn later_macro_wins_on_shared_target() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 4, 0.1, 0.1));
        m.set_target(3, 0, target(0, 4, 0.7, 0.7));
        settle(&mut m);
        let mut v = [0.0_f32; 9];
        m.apply(0, &mut v);
        assert!((v[4] - 0.7).abs() < 1e-6);
    }

    #[test]
    fn cleared_target_stops_overriding() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 1, 0.9, 0.9));
        m.clear_target(0, 0);
        let mut v = [0.2_f32; 9];
        m.apply(0, &mut v);
        assert_eq!(v[1], 0.2);
    }

    #[test]
    fn invalid_input_is_ignored() {
        let mut m = Macros::new(SR);
        m.set_target(9, 0, target(0, 0, 0.5, 0.5));
        m.set_target(0, 99, target(0, 0, 0.5, 0.5));
        m.set_target(0, 0, target(0, 0, f32::NAN, 0.5));
        m.set_target(0, 1, target(0, 200, 0.5, 0.5));
        m.set_pos(0, f32::NAN);
        m.set_pos(42, 1.0);
        m.clear_target(99, 99);
        settle(&mut m);
        let mut v = [0.2_f32; 9];
        m.apply(0, &mut v);
        assert_eq!(v, [0.2; 9]);
    }

    #[test]
    fn endpoints_are_clamped() {
        let mut m = Macros::new(SR);
        m.set_target(0, 0, target(0, 0, -2.0, 3.0));
        m.set_pos(0, 1.0);
        settle(&mut m);
        let mut v = [0.5_f32; 9];
        m.apply(0, &mut v);
        assert!((v[0] - 1.0).abs() < 1e-3);
    }
}
```

Add to lib.rs: `pub mod macros;`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core macros`
Expected: compile errors (`Macros` not found).

- [ ] **Step 3: Implement** (above the tests)

```rust
use crate::dsp::Smoother;
use crate::modulation::ParamRef;

pub const MACROS: usize = 8;
pub const MACRO_TARGETS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MacroTarget {
    pub target: ParamRef,
    pub a: f32,
    pub b: f32,
}

/// Octatrack-style macros: each target is an absolute A→B pair the fader interpolates.
pub struct Macros {
    targets: [[Option<MacroTarget>; MACRO_TARGETS]; MACROS],
    pos: [Smoother; MACROS],
    current: [f32; MACROS],
}

impl Macros {
    pub fn new(sample_rate: f32) -> Self {
        Macros {
            targets: [[None; MACRO_TARGETS]; MACROS],
            pos: core::array::from_fn(|_| Smoother::new(0.0, 15.0, sample_rate)),
            current: [0.0; MACROS],
        }
    }

    pub fn set_target(&mut self, m: usize, i: usize, t: MacroTarget) {
        if !(t.a.is_finite() && t.b.is_finite()) {
            return;
        }
        if let Some(slot) = self.targets.get_mut(m).and_then(|row| row.get_mut(i)) {
            *slot = Some(MacroTarget { a: t.a.clamp(0.0, 1.0), b: t.b.clamp(0.0, 1.0), ..t });
        }
    }

    pub fn clear_target(&mut self, m: usize, i: usize) {
        if let Some(slot) = self.targets.get_mut(m).and_then(|row| row.get_mut(i)) {
            *slot = None;
        }
    }

    pub fn set_pos(&mut self, m: usize, pos: f32) {
        if let (Some(s), true) = (self.pos.get_mut(m), pos.is_finite()) {
            s.set(pos.clamp(0.0, 1.0));
        }
    }

    pub fn advance(&mut self) {
        for i in 0..MACROS {
            self.current[i] = self.pos[i].next();
        }
    }

    /// Overrides base norms of `track` with each target's A→B value; later macros win on shared targets.
    pub fn apply(&self, track: u8, norms: &mut [f32]) {
        for (m, row) in self.targets.iter().enumerate() {
            for t in row.iter().flatten() {
                if t.target.track != track {
                    continue;
                }
                if let Some(v) = norms.get_mut(t.target.param as usize) {
                    *v = t.a + (t.b - t.a) * self.current[m];
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core macros`
Expected: 8 passed, no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/macros.rs
git commit -m "feat(core): add octatrack-style a/b macros

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 6: Engine integration and snapshot array

**Files:**
- Modify: `crates/core/src/engine.rs` (replace everything above `#[cfg(test)]`; append tests)
- Modify: `crates/core/tests/render.rs` (append a benchmark)

**Interfaces:**
- Consumes:
  - `ModMatrix`, `ModSettings`, `Route`, `ParamRef`, `MOD_SLOTS`, `MOD_TRACKS`, `MOD_PARAMS` (Task 4)
  - `Macros`, `MacroTarget` (Task 5)
  - The `KickParams` norm API (Task 2)
- Produces:
  - Snapshot layout:
    - `SNAP_TICK = 0`, `SNAP_PLAYHEADS = 1`
    - `SNAP_MODS = 14`, `SNAP_EFFECTIVE = 30` (row-major `track × MOD_PARAMS + param`)
    - `SNAP_LEN = 238`
    - Public field `snapshot: [f32; SNAP_LEN]`, written at the end of every `process`.
  - New `Engine` methods:
    - Modulators: `set_modulator(slot, ModSettings)`, `set_mod_step(slot, i, v)`, `set_mod_step_len(slot, len: u8)`
    - Routes: `set_route(index, Route)`, `clear_route(index)`
    - Macros: `set_macro_target(m, i, MacroTarget)`, `clear_macro_target(m, i)`, `set_macro_pos(m, pos)`
    - Readout: `mod_output(slot) -> f32`, `effective_norm(track, param) -> f32`. The latter returns −1 for a non-kick track or bad param.
  - Behaviour:
    - `play()` also restarts all modulators.
    - Every firing track calls `mods.on_track_trigger(t)`.

- [ ] **Step 1: Write the failing tests.** Append inside `mod tests` in `engine.rs`.

```rust
    use crate::macros::MacroTarget;
    use crate::modulation::{ModKind, ModSettings, ParamRef, Route, Shape, TrigMode};

    fn square(e: &mut Engine, slot: usize) {
        e.set_modulator(slot, ModSettings { kind: ModKind::Lfo, shape: Shape::Sqr, sync: false, hz: 0.01, ..ModSettings::default() });
    }

    fn route(src: u8, track: u8, param: u8, amount: f32) -> Route {
        Route { src, target: ParamRef { track, param }, amount }
    }

    #[test]
    fn routed_lfo_moves_the_effective_value() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 0);
        e.set_route(0, route(0, 0, DECAY as u8, 0.3));
        render_seconds(&mut e, 0.2);
        let expected = crate::kick::KICK_PARAMS[DECAY].default_norm + 0.3;
        assert!((e.effective_norm(0, DECAY) - expected).abs() < 0.01, "{}", e.effective_norm(0, DECAY));
    }

    #[test]
    fn modulation_is_clamped_to_range() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 0);
        square(&mut e, 1);
        e.set_route(0, route(0, 0, 8, 1.0));
        e.set_route(1, route(1, 0, 8, 1.0));
        render_seconds(&mut e, 0.5);
        assert_eq!(e.effective_norm(0, 8), 1.0);
    }

    #[test]
    fn macro_overrides_the_base_value() {
        let mut e = Engine::new(48_000.0);
        e.set_macro_target(0, 0, MacroTarget { target: ParamRef { track: 1, param: 0 }, a: 0.0, b: 1.0 });
        e.set_macro_pos(0, 1.0);
        render_seconds(&mut e, 0.5);
        assert!((e.effective_norm(1, 0) - 1.0).abs() < 1e-3);
        assert!((e.effective_norm(0, 0) - crate::kick::KICK_PARAMS[0].default_norm).abs() < 1e-3);
    }

    #[test]
    fn firing_track_restarts_its_retrig_modulator() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0);
        e.set_modulator(0, ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, bipolar: false, sync: false, hz: 0.1, trig_mode: TrigMode::Retrig, trig_src: 0, ..ModSettings::default() });
        e.set_step(0, 8, Step { trig: true, ..Step::default() }); // fires at sample 48 000
        e.play();
        for _ in 0..375 {
            e.process(BLOCK);
        }
        assert!(e.mod_output(0) > 0.05);
        e.process(BLOCK);
        assert!(e.mod_output(0) < 0.01);
    }

    #[test]
    fn snapshot_mirrors_engine_state() {
        let mut e = Engine::new(48_000.0);
        square(&mut e, 2);
        e.play();
        render_seconds(&mut e, 0.3);
        assert_eq!(e.snapshot[SNAP_TICK], e.ticks() as f32);
        assert_eq!(e.snapshot[SNAP_PLAYHEADS], e.playhead(0) as f32);
        assert_eq!(e.snapshot[SNAP_MODS + 2], e.mod_output(2));
        assert_eq!(e.snapshot[SNAP_EFFECTIVE + DECAY], e.effective_norm(0, DECAY));
        assert_eq!(SNAP_LEN, 238);
    }

    #[test]
    fn bad_modulation_commands_are_ignored() {
        let mut e = Engine::new(48_000.0);
        e.set_modulator(99, ModSettings::default());
        e.set_mod_step(99, 0, 1.0);
        e.set_mod_step_len(99, 3);
        e.set_route(999, route(0, 0, 0, 0.5));
        e.clear_route(999);
        e.set_macro_target(99, 0, MacroTarget { target: ParamRef { track: 0, param: 0 }, a: 0.0, b: 1.0 });
        e.clear_macro_target(99, 99);
        e.set_macro_pos(99, 1.0);
        assert_eq!(e.mod_output(99), 0.0);
        assert_eq!(e.effective_norm(5, 0), -1.0);
        assert_eq!(e.effective_norm(0, 50), -1.0);
        e.play();
        render_seconds(&mut e, 0.1);
        assert!(e.out_l.iter().all(|s| s.is_finite()));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core engine`
Expected: compile errors (`set_modulator`, `SNAP_TICK` and so on not found).

- [ ] **Step 3: Replace everything above `#[cfg(test)]`** in `engine.rs`

```rust
use crate::kick::{KickParams, KickVoice, KICK_PARAMS, KICK_PARAM_COUNT};
use crate::macros::{MacroTarget, Macros};
use crate::modulation::{ModMatrix, ModSettings, Route, MOD_PARAMS, MOD_SLOTS, MOD_TRACKS};
use crate::rng::Rng;
use crate::seq::{CondCtx, Step, Track};
use crate::transport::Transport;

pub const BLOCK: usize = 128;
pub const TRACKS: usize = 13;
pub const KICK_TRACKS: usize = 2;

/// Snapshot layout, mirrored in web/src/audio/snapshot.ts.
pub const SNAP_TICK: usize = 0;
pub const SNAP_PLAYHEADS: usize = 1;
pub const SNAP_MODS: usize = SNAP_PLAYHEADS + TRACKS;
pub const SNAP_EFFECTIVE: usize = SNAP_MODS + MOD_SLOTS;
pub const SNAP_LEN: usize = SNAP_EFFECTIVE + TRACKS * MOD_PARAMS;

const _: () = assert!(TRACKS == MOD_TRACKS && KICK_PARAM_COUNT <= MOD_PARAMS);

pub struct Engine {
    pub out_l: [f32; BLOCK],
    pub out_r: [f32; BLOCK],
    pub snapshot: [f32; SNAP_LEN],
    sample_rate: f32,
    transport: Transport,
    tracks: [Track; TRACKS],
    kicks: [KickVoice; KICK_TRACKS],
    kick_params: [KickParams; KICK_TRACKS],
    effective: [[f32; KICK_PARAM_COUNT]; KICK_TRACKS],
    mods: ModMatrix,
    macros: Macros,
    rng: Rng,
    fill: bool,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        Engine {
            out_l: [0.0; BLOCK],
            out_r: [0.0; BLOCK],
            snapshot: [0.0; SNAP_LEN],
            sample_rate,
            transport: Transport::new(sample_rate),
            tracks: [Track::new(); TRACKS],
            kicks: core::array::from_fn(|i| KickVoice::new(sample_rate, 0x00C0_FFEE + i as u32)),
            kick_params: core::array::from_fn(|_| KickParams::new(sample_rate)),
            effective: [core::array::from_fn(|i| KICK_PARAMS[i].default_norm); KICK_TRACKS],
            mods: ModMatrix::new(),
            macros: Macros::new(sample_rate),
            rng: Rng::new(0x5EED),
            fill: false,
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

    pub fn set_param(&mut self, track: usize, param: usize, norm: f32) {
        if let Some(p) = self.kick_params.get_mut(track) {
            p.set_norm(param, norm);
        }
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

    pub fn effective_norm(&self, track: usize, param: usize) -> f32 {
        self.effective.get(track).and_then(|row| row.get(param)).copied().unwrap_or(-1.0)
    }

    pub fn playhead(&self, track: usize) -> i32 {
        self.tracks.get(track).map_or(-1, |t| t.playhead() as i32)
    }

    pub fn ticks(&self) -> u64 {
        self.transport.ticks()
    }

    pub fn process(&mut self, frames: usize) {
        let bpm = self.transport.bpm() as f32;
        for i in 0..frames.min(BLOCK) {
            if let Some(tick) = self.transport.tick() {
                self.on_tick(tick);
            }
            self.mods.advance(bpm, self.sample_rate);
            self.macros.advance();
            let mut s = 0.0;
            for k in 0..KICK_TRACKS {
                // base (smoothed) → macro override → + modulation → clamp → map
                let mut norms = self.kick_params[k].next_norms();
                self.macros.apply(k as u8, &mut norms);
                for (p, v) in norms.iter_mut().enumerate() {
                    *v = (*v + self.mods.sum(k, p)).clamp(0.0, 1.0);
                }
                self.kick_params[k].apply_norms(&norms);
                self.effective[k] = norms;
                s += self.kicks[k].render(&self.kick_params[k]);
            }
            let y = if s.is_finite() { s.clamp(-1.0, 1.0) } else { 0.0 };
            self.out_l[i] = y;
            self.out_r[i] = y;
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
        for k in 0..KICK_TRACKS {
            for p in 0..KICK_PARAM_COUNT {
                self.snapshot[SNAP_EFFECTIVE + k * MOD_PARAMS + p] = self.effective[k][p];
            }
        }
    }

    fn on_tick(&mut self, tick: u64) {
        let mut neighbor = false;
        for t in 0..TRACKS {
            let mut ctx = CondCtx { fill: self.fill, neighbor, rng: &mut self.rng };
            if let Some(vel) = self.tracks[t].on_tick(tick, &mut ctx) {
                if t < KICK_TRACKS {
                    self.kicks[t].trigger(vel, &mut self.rng);
                }
                self.mods.on_track_trigger(t);
            }
            neighbor = self.tracks[t].last_cond();
        }
    }
}
```

The old `set_param` checked `norm.is_finite()`; that check now lives in `KickParams::set_norm` (Task 2).

- [ ] **Step 4: Append the benchmark** to `crates/core/tests/render.rs`

```rust
#[test]
#[ignore = "benchmark: run with cargo test --release -- --ignored"]
fn full_modulation_runs_under_quarter_of_realtime() {
    use utero_core::macros::MacroTarget;
    use utero_core::modulation::{ModKind, ModSettings, ParamRef, Route, Shape};
    let mut e = groove();
    for slot in 0..16 {
        e.set_modulator(slot, ModSettings { kind: ModKind::Lfo, shape: Shape::from_code((slot % 9) as u8), sync: false, hz: 0.5 + slot as f32, ..ModSettings::default() });
    }
    for i in 0..64 {
        e.set_route(i, Route { src: (i % 16) as u8, target: ParamRef { track: (i % 2) as u8, param: (i % 9) as u8 }, amount: 0.05 });
    }
    for m in 0..8 {
        e.set_macro_target(m, 0, MacroTarget { target: ParamRef { track: 0, param: m as u8 }, a: 0.2, b: 0.8 });
        e.set_macro_pos(m, 0.5);
    }
    let start = Instant::now();
    render(&mut e, 10.0);
    let elapsed = start.elapsed().as_secs_f32();
    println!("10 s with 16 mods / 64 routes / 8 macros took {elapsed:.3} s");
    assert!(elapsed < 2.5, "took {elapsed:.3} s");
}
```

- [ ] **Step 5: Run the tests and the benchmarks**

Run: `source "$HOME/.cargo/env" && cargo test -p utero-core && cargo test -p utero-core --release --test render -- --ignored --nocapture`
Expected: everything passes with no warnings. Both benchmarks pass; record the printed time in your report.

- [ ] **Step 6: Commit**

```bash
git add crates/core/src/engine.rs crates/core/tests/render.rs
git commit -m "feat(core): wire modulation and macros into the engine with a snapshot array

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 7: WASM exports and the web audio plumbing

**Files:**
- Modify: `crates/wasm/src/lib.rs` (append exports)
- Replace: `web/src/audio/exports.ts`, `web/src/audio/ops.ts`, `web/src/audio/dispatch.ts`, `web/src/audio/snapshot.ts`, `web/src/audio/worklet.ts`, `web/src/state/types.ts`
- Create: `web/src/state/modulation.ts`
- Modify: `web/src/audio/ring.test.ts` (two tests), `web/src/audio/dispatch.test.ts` (replace), `web/src/audio/wasm.test.ts` (append)

**Interfaces:**
- Consumes: the Engine API from Task 6.
- Produces wasm exports, in exactly this argument order:
  - `utero_set_modulator(slot, kind, shape, color, sync, rate_index, hz: f32, phase: f32, bipolar, trig_mode, trig_src: i32, smooth: f32, depth: f32)`
  - `utero_set_mod_step(slot, index, value: f32)`, `utero_set_mod_step_len(slot, len)`
  - `utero_set_route(index, src, track, param, amount: f32)`, `utero_clear_route(index)`
  - `utero_set_macro_target(macro, index, track, param, a: f32, b: f32)`, `utero_clear_macro_target(macro, index)`, `utero_set_macro_pos(macro, pos: f32)`
  - `utero_snapshot() -> *const f32`, `utero_snapshot_len() -> u32`
- Produces TS:
  - `CMD_WORDS = 16`
  - Opcodes 9–16: `SetModulator, SetModStep, SetModStepLen, SetRoute, ClearRoute, SetMacroTarget, ClearMacroTarget, SetMacroPos`
  - Builders: `cmdSetModulator(slot, m: ModulatorState)`, `cmdSetModStep(slot, i, v)`, `cmdSetModStepLen(slot, len)`, `cmdSetRoute(index, r: RouteState)`, `cmdClearRoute(index)`, `cmdSetMacroTarget(m, i, t: MacroTargetState)`, `cmdClearMacroTarget(m, i)`, `cmdSetMacroPos(m, pos)`
  - `snapshot.ts`:
    - Constants: `SNAP_TRACKS = 13`, `SNAP_MOD_SLOTS = 16`, `SNAP_PARAMS = 16`, `SNAP_PLAYHEADS = 1`, `SNAP_MODS = 14`, `SNAP_EFFECTIVE = 30`, `SNAP_FLOATS = 238`
    - Accessors: `playheadOf(snap, t)`, `modOutputOf(snap, slot)`, `effectiveOf(snap, t, p)`
  - `types.ts`: adds `ModKind`, `ModulatorState`, `RouteState`, `MacroTargetState`, `MacroState`, `LearnState`, and new `AppState` fields `modulators`, `routes`, `macros`, `selectedMod`, `selectedMacro`, `learn`. `store.ts` is updated in Task 8; until then `tsc` fails only in `store.ts` (`initialState` misses the new fields). This is expected for this task.
  - `modulation.ts`: the UI mirror of codes, defaults, labels and previews (full content in Step 8).

- [ ] **Step 1: Replace `web/src/state/types.ts`**

```ts
/** Same codes as Cond::from_code in crates/core/src/seq.rs. */
export type CondCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface StepState {
  trig: boolean
  vel: number
  prob: number
  cond: CondCode
  a: number
  b: number
  /** 1/24 of a step, −11..11 */
  micro: number
}

export interface TrackState {
  name: string
  bus: string
  length: number
  speed: number
  steps: StepState[]
  params: number[]
}

/** 0 OFF, 1 LFO, 2 NOISE, 3 STEP (ModKind::from_code). */
export type ModKind = 0 | 1 | 2 | 3

export interface ModulatorState {
  kind: ModKind
  /** Shape::from_code: 0 SIN 1 GLIDE 2 S&H 3 TRI 4 SAW 5 RAMP 6 SQR 7 EXP 8 DRIFT */
  shape: number
  /** NoiseColor::from_code: 0 WHITE 1 PINK 2 CRACKLE */
  color: number
  sync: boolean
  rateIndex: number
  hz: number
  phase: number
  bipolar: boolean
  /** TrigMode::from_code: 0 FREE 1 RETRIG 2 ONESHOT */
  trigMode: number
  /** track index, −1 = none */
  trigSrc: number
  smooth: number
  depth: number
  steps: number[]
  stepLen: number
}

export interface RouteState {
  src: number
  track: number
  param: number
  /** −1..1 */
  amount: number
}

export interface MacroTargetState {
  track: number
  param: number
  a: number
  b: number
}

export interface MacroState {
  name: string
  pos: number
  targets: MacroTargetState[]
}

export interface LearnState {
  macro: number
  side: 'a' | 'b'
}

export interface AppState {
  bpm: number
  playing: boolean
  selected: number
  tracks: TrackState[]
  modulators: ModulatorState[]
  /** index = engine route slot */
  routes: (RouteState | null)[]
  macros: MacroState[]
  selectedMod: number
  selectedMacro: number
  learn: LearnState | null
}
```

- [ ] **Step 2: Replace `web/src/audio/ops.ts`**

```ts
import type { MacroTargetState, ModulatorState, RouteState, StepState } from '@/state/types'

export const Op = {
  SetParam: 1, SetStep: 2, SetLength: 3, SetSpeed: 4, Play: 5, Stop: 6, SetBpm: 7, SetFill: 8,
  SetModulator: 9, SetModStep: 10, SetModStepLen: 11, SetRoute: 12, ClearRoute: 13,
  SetMacroTarget: 14, ClearMacroTarget: 15, SetMacroPos: 16,
} as const
export const CMD_WORDS = 16

export const cmdSetParam = (t: number, p: number, v: number) => [Op.SetParam, t, p, v]
export const cmdSetStep = (t: number, s: number, st: StepState) =>
  [Op.SetStep, t, s, st.trig ? 1 : 0, st.vel, st.prob, st.cond, st.a, st.b, st.micro]
export const cmdSetLength = (t: number, len: number) => [Op.SetLength, t, len]
export const cmdSetSpeed = (t: number, code: number) => [Op.SetSpeed, t, code]
export const cmdPlay = () => [Op.Play]
export const cmdStop = () => [Op.Stop]
export const cmdSetBpm = (bpm: number) => [Op.SetBpm, bpm]
export const cmdSetFill = (on: boolean) => [Op.SetFill, on ? 1 : 0]
export const cmdSetModulator = (slot: number, m: ModulatorState) => [
  Op.SetModulator, slot, m.kind, m.shape, m.color, m.sync ? 1 : 0, m.rateIndex, m.hz, m.phase,
  m.bipolar ? 1 : 0, m.trigMode, m.trigSrc, m.smooth, m.depth,
]
export const cmdSetModStep = (slot: number, i: number, v: number) => [Op.SetModStep, slot, i, v]
export const cmdSetModStepLen = (slot: number, len: number) => [Op.SetModStepLen, slot, len]
export const cmdSetRoute = (index: number, r: RouteState) => [Op.SetRoute, index, r.src, r.track, r.param, r.amount]
export const cmdClearRoute = (index: number) => [Op.ClearRoute, index]
export const cmdSetMacroTarget = (m: number, i: number, t: MacroTargetState) => [Op.SetMacroTarget, m, i, t.track, t.param, t.a, t.b]
export const cmdClearMacroTarget = (m: number, i: number) => [Op.ClearMacroTarget, m, i]
export const cmdSetMacroPos = (m: number, pos: number) => [Op.SetMacroPos, m, pos]
```

- [ ] **Step 3: Replace `web/src/audio/exports.ts`**

```ts
export interface EngineExports {
  utero_set_param(track: number, param: number, value: number): void
  utero_set_step(track: number, step: number, trig: number, vel: number, prob: number, cond: number, a: number, b: number, micro: number): void
  utero_set_length(track: number, len: number): void
  utero_set_speed(track: number, code: number): void
  utero_play(): void
  utero_stop(): void
  utero_set_bpm(bpm: number): void
  utero_set_fill(on: number): void
  utero_set_modulator(slot: number, kind: number, shape: number, color: number, sync: number, rateIndex: number, hz: number,
    phase: number, bipolar: number, trigMode: number, trigSrc: number, smooth: number, depth: number): void
  utero_set_mod_step(slot: number, index: number, value: number): void
  utero_set_mod_step_len(slot: number, len: number): void
  utero_set_route(index: number, src: number, track: number, param: number, amount: number): void
  utero_clear_route(index: number): void
  utero_set_macro_target(macro: number, index: number, track: number, param: number, a: number, b: number): void
  utero_clear_macro_target(macro: number, index: number): void
  utero_set_macro_pos(macro: number, pos: number): void
}

export interface WasmExports extends EngineExports {
  memory: WebAssembly.Memory
  utero_init(sampleRate: number): void
  utero_process(frames: number): void
  utero_out_l(): number
  utero_out_r(): number
  utero_tick(): number
  utero_playhead(track: number): number
  utero_snapshot(): number
  utero_snapshot_len(): number
}
```

- [ ] **Step 4: Replace `web/src/audio/dispatch.ts`**

```ts
import type { EngineExports } from './exports'
import { Op } from './ops'

export function dispatch(ex: EngineExports, c: ArrayLike<number>): void {
  switch (c[0]) {
    case Op.SetParam: ex.utero_set_param(c[1], c[2], c[3]); break
    case Op.SetStep: ex.utero_set_step(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9]); break
    case Op.SetLength: ex.utero_set_length(c[1], c[2]); break
    case Op.SetSpeed: ex.utero_set_speed(c[1], c[2]); break
    case Op.Play: ex.utero_play(); break
    case Op.Stop: ex.utero_stop(); break
    case Op.SetBpm: ex.utero_set_bpm(c[1]); break
    case Op.SetFill: ex.utero_set_fill(c[1]); break
    case Op.SetModulator:
      ex.utero_set_modulator(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], c[12], c[13]); break
    case Op.SetModStep: ex.utero_set_mod_step(c[1], c[2], c[3]); break
    case Op.SetModStepLen: ex.utero_set_mod_step_len(c[1], c[2]); break
    case Op.SetRoute: ex.utero_set_route(c[1], c[2], c[3], c[4], c[5]); break
    case Op.ClearRoute: ex.utero_clear_route(c[1]); break
    case Op.SetMacroTarget: ex.utero_set_macro_target(c[1], c[2], c[3], c[4], c[5], c[6]); break
    case Op.ClearMacroTarget: ex.utero_clear_macro_target(c[1], c[2]); break
    case Op.SetMacroPos: ex.utero_set_macro_pos(c[1], c[2]); break
  }
}
```

- [ ] **Step 5: Replace `web/src/audio/snapshot.ts`**

```ts
/** Layout mirrors SNAP_* in crates/core/src/engine.rs. */
export const SNAP_TRACKS = 13
export const SNAP_MOD_SLOTS = 16
export const SNAP_PARAMS = 16
export const SNAP_PLAYHEADS = 1
export const SNAP_MODS = SNAP_PLAYHEADS + SNAP_TRACKS
export const SNAP_EFFECTIVE = SNAP_MODS + SNAP_MOD_SLOTS
export const SNAP_FLOATS = SNAP_EFFECTIVE + SNAP_TRACKS * SNAP_PARAMS

export const playheadOf = (snap: Float32Array, track: number) => snap[SNAP_PLAYHEADS + track]
export const modOutputOf = (snap: Float32Array, slot: number) => snap[SNAP_MODS + slot]
export const effectiveOf = (snap: Float32Array, track: number, param: number) => snap[SNAP_EFFECTIVE + track * SNAP_PARAMS + param]
```

- [ ] **Step 6: Replace `web/src/audio/worklet.ts`**

```ts
import { dispatch } from './dispatch'
import type { WasmExports } from './exports'
import { CMD_WORDS } from './ops'
import { CommandRing } from './ring'
import { SNAP_FLOATS } from './snapshot'

interface Options {
  module: WebAssembly.Module
  ring: SharedArrayBuffer
  snap: SharedArrayBuffer
}

class UteroProcessor extends AudioWorkletProcessor {
  private readonly ex: WasmExports
  private readonly ring: CommandRing
  private readonly snap: Float32Array
  private readonly cmd = new Float32Array(CMD_WORDS)
  private mem: ArrayBuffer | null = null
  private outL = new Float32Array(0)
  private outR = new Float32Array(0)
  private snapView = new Float32Array(0)

  constructor(options: AudioWorkletNodeOptions) {
    super()
    const { module, ring, snap } = options.processorOptions as Options
    this.ex = new WebAssembly.Instance(module, {}).exports as unknown as WasmExports
    // A stale utero.wasm next to a newer UI would show wrong values; fail loudly instead.
    if (this.ex.utero_snapshot_len() !== SNAP_FLOATS) {
      throw new Error(`snapshot layout mismatch: engine ${this.ex.utero_snapshot_len()} vs UI ${SNAP_FLOATS}`)
    }
    this.ex.utero_init(sampleRate)
    this.ring = CommandRing.attach(ring)
    this.snap = new Float32Array(snap)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    while (this.ring.pop(this.cmd)) dispatch(this.ex, this.cmd)
    const out = outputs[0]
    const left = out[0]
    const n = left.length
    this.ex.utero_process(n)
    // Re-create views only if wasm memory grew; avoids per-block allocation.
    if (this.mem !== this.ex.memory.buffer || this.outL.length !== n) {
      this.mem = this.ex.memory.buffer
      this.outL = new Float32Array(this.mem, this.ex.utero_out_l(), n)
      this.outR = new Float32Array(this.mem, this.ex.utero_out_r(), n)
      this.snapView = new Float32Array(this.mem, this.ex.utero_snapshot(), SNAP_FLOATS)
    }
    left.set(this.outL)
    out[1]?.set(this.outR)
    this.snap.set(this.snapView)
    return true
  }
}

registerProcessor('utero-engine', UteroProcessor)
```

- [ ] **Step 7: Append the wasm exports** to `crates/wasm/src/lib.rs`

Change the imports at the top to:
```rust
use utero_core::engine::{Engine, SNAP_LEN};
use utero_core::macros::MacroTarget;
use utero_core::modulation::{ModKind, ModSettings, NoiseColor, ParamRef, Route, Shape, TrigMode};
use utero_core::seq::{Cond, Step};
```

Append:
```rust
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn utero_set_modulator(
    slot: u32, kind: u32, shape: u32, color: u32, sync: u32, rate_index: u32, hz: f32, phase: f32,
    bipolar: u32, trig_mode: u32, trig_src: i32, smooth: f32, depth: f32,
) {
    let s = ModSettings {
        kind: ModKind::from_code(byte(kind)),
        shape: Shape::from_code(byte(shape)),
        color: NoiseColor::from_code(byte(color)),
        sync: sync != 0,
        rate_index: byte(rate_index),
        hz,
        phase,
        bipolar: bipolar != 0,
        trig_mode: TrigMode::from_code(byte(trig_mode)),
        trig_src: trig_src.clamp(-1, 127) as i8,
        smooth,
        depth,
    };
    eng().set_modulator(slot as usize, s);
}

#[no_mangle]
pub extern "C" fn utero_set_mod_step(slot: u32, index: u32, value: f32) {
    eng().set_mod_step(slot as usize, index as usize, value);
}

#[no_mangle]
pub extern "C" fn utero_set_mod_step_len(slot: u32, len: u32) {
    eng().set_mod_step_len(slot as usize, byte(len));
}

#[no_mangle]
pub extern "C" fn utero_set_route(index: u32, src: u32, track: u32, param: u32, amount: f32) {
    let r = Route { src: byte(src), target: ParamRef { track: byte(track), param: byte(param) }, amount };
    eng().set_route(index as usize, r);
}

#[no_mangle]
pub extern "C" fn utero_clear_route(index: u32) {
    eng().clear_route(index as usize);
}

#[no_mangle]
pub extern "C" fn utero_set_macro_target(m: u32, index: u32, track: u32, param: u32, a: f32, b: f32) {
    let t = MacroTarget { target: ParamRef { track: byte(track), param: byte(param) }, a, b };
    eng().set_macro_target(m as usize, index as usize, t);
}

#[no_mangle]
pub extern "C" fn utero_clear_macro_target(m: u32, index: u32) {
    eng().clear_macro_target(m as usize, index as usize);
}

#[no_mangle]
pub extern "C" fn utero_set_macro_pos(m: u32, pos: f32) {
    eng().set_macro_pos(m as usize, pos);
}

#[no_mangle]
pub extern "C" fn utero_snapshot() -> *const f32 {
    eng().snapshot.as_ptr()
}

#[no_mangle]
pub extern "C" fn utero_snapshot_len() -> u32 {
    SNAP_LEN as u32
}
```

Note: `utero_snapshot_len` must not call `eng()`, because the worklet calls it before `utero_init`. The code above already avoids this; keep it that way.

- [ ] **Step 8: Update the web audio tests**

In `web/src/audio/ring.test.ts`, replace the last two tests:
```ts
  test('attach sees the same queue (other thread view)', () => {
    const a = CommandRing.create(8)
    const b = CommandRing.attach(a.sab)
    a.push([7, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    const o = out()
    expect(b.pop(o)).toBe(true)
    expect(Array.from(o)).toEqual([7, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  test('zero-fills unused command words when a slot is reused', () => {
    const r = CommandRing.create(2)
    r.push(Array.from({ length: CMD_WORDS }, (_, i) => i + 1))
    r.pop(out())
    r.push([9])
    r.pop(out())
    r.push([6]) // lands in slot 0 again
    const o = out()
    r.pop(o)
    expect(Array.from(o)).toEqual([6, ...Array(CMD_WORDS - 1).fill(0)])
  })
```

Replace `web/src/audio/dispatch.test.ts`:
```ts
import { expect, test } from 'vitest'
import { defaultModulator } from '@/state/modulation'
import type { EngineExports } from './exports'
import { dispatch } from './dispatch'
import {
  cmdClearMacroTarget, cmdClearRoute, cmdPlay, cmdSetBpm, cmdSetFill, cmdSetLength, cmdSetMacroPos, cmdSetMacroTarget,
  cmdSetModStep, cmdSetModStepLen, cmdSetModulator, cmdSetParam, cmdSetRoute, cmdSetSpeed, cmdSetStep, cmdStop, CMD_WORDS,
} from './ops'

function fake() {
  const calls: [string, number[]][] = []
  const rec = (name: string) => (...args: number[]) => { calls.push([name, args]) }
  const ex: EngineExports = {
    utero_set_param: rec('set_param'),
    utero_set_step: rec('set_step'),
    utero_set_length: rec('set_length'),
    utero_set_speed: rec('set_speed'),
    utero_play: rec('play'),
    utero_stop: rec('stop'),
    utero_set_bpm: rec('set_bpm'),
    utero_set_fill: rec('set_fill'),
    utero_set_modulator: rec('set_modulator'),
    utero_set_mod_step: rec('set_mod_step'),
    utero_set_mod_step_len: rec('set_mod_step_len'),
    utero_set_route: rec('set_route'),
    utero_clear_route: rec('clear_route'),
    utero_set_macro_target: rec('set_macro_target'),
    utero_clear_macro_target: rec('clear_macro_target'),
    utero_set_macro_pos: rec('set_macro_pos'),
  }
  return { ex, calls }
}

test('every command builder reaches the matching export with its arguments in order', () => {
  const { ex, calls } = fake()
  const step = { trig: true, vel: 0.5, prob: 60, cond: 1 as const, a: 2, b: 4, micro: -3 }
  const mod = { ...defaultModulator(), kind: 1 as const, shape: 2, color: 1, sync: false, rateIndex: 3, hz: 0.5, phase: 0.25, bipolar: false, trigMode: 1, trigSrc: 4, smooth: 0.3, depth: 0.8 }
  for (const cmd of [
    cmdSetParam(1, 2, 0.25), cmdSetStep(0, 5, step), cmdSetLength(1, 13), cmdSetSpeed(1, 2),
    cmdPlay(), cmdStop(), cmdSetBpm(128), cmdSetFill(true),
    cmdSetModulator(3, mod), cmdSetModStep(3, 7, -0.5), cmdSetModStepLen(3, 8),
    cmdSetRoute(10, { src: 3, track: 0, param: 4, amount: -0.25 }), cmdClearRoute(10),
    cmdSetMacroTarget(2, 1, { track: 1, param: 0, a: 0.1, b: 0.9 }), cmdClearMacroTarget(2, 1), cmdSetMacroPos(2, 0.75),
  ]) {
    expect(cmd.length).toBeLessThanOrEqual(CMD_WORDS)
    dispatch(ex, cmd)
  }
  expect(calls).toEqual([
    ['set_param', [1, 2, 0.25]],
    ['set_step', [0, 5, 1, 0.5, 60, 1, 2, 4, -3]],
    ['set_length', [1, 13]],
    ['set_speed', [1, 2]],
    ['play', []],
    ['stop', []],
    ['set_bpm', [128]],
    ['set_fill', [1]],
    ['set_modulator', [3, 1, 2, 1, 0, 3, 0.5, 0.25, 0, 1, 4, 0.3, 0.8]],
    ['set_mod_step', [3, 7, -0.5]],
    ['set_mod_step_len', [3, 8]],
    ['set_route', [10, 3, 0, 4, -0.25]],
    ['clear_route', [10]],
    ['set_macro_target', [2, 1, 1, 0, 0.1, 0.9]],
    ['clear_macro_target', [2, 1]],
    ['set_macro_pos', [2, 0.75]],
  ])
})

test('unknown opcode is ignored', () => {
  const { ex, calls } = fake()
  dispatch(ex, [99, 1, 2])
  expect(calls).toEqual([])
})
```

This test imports `defaultModulator` from `@/state/modulation`. Create that file now with exactly this content. Task 8 adds its tests:

`web/src/state/modulation.ts`:
```ts
import type { MacroState, ModulatorState } from './types'

export const MOD_SLOTS = 16
export const MAX_ROUTES = 64
export const STEP_COUNT = 16
export const MACROS = 8
export const MACRO_TARGETS = 16
export const MOD_DRAG_TYPE = 'application/x-utero-mod'

/** Index order mirrors SYNC_BARS in crates/core/src/modulation.rs. */
export const SYNC_LABELS = ['1/16', '1/8', '1/4', '1/2', '1 BAR', '2 BAR', '4 BAR', '8 BAR', '16 BAR', '32 BAR']
/** Codes mirror Shape::from_code; the favourites (SIN, GLIDE, S&H) come first. */
export const SHAPES = [
  { code: 0, label: 'SIN' }, { code: 1, label: 'GLIDE' }, { code: 2, label: 'S&H' },
  { code: 3, label: 'TRI' }, { code: 4, label: 'SAW' }, { code: 5, label: 'RAMP' },
  { code: 6, label: 'SQR' }, { code: 7, label: 'EXP' }, { code: 8, label: 'DRIFT' },
]
export const FAVORITE_SHAPE_COUNT = 3
export const MOD_KINDS = ['OFF', 'LFO', 'NOISE', 'STEP']
export const NOISE_COLORS = ['WHITE', 'PINK', 'CRACKLE']
export const TRIG_MODES = ['FREE', 'RETRIG', 'ONESHOT']

export function defaultModulator(): ModulatorState {
  return {
    kind: 0, shape: 0, color: 0, sync: true, rateIndex: 6, hz: 1, phase: 0, bipolar: true,
    trigMode: 0, trigSrc: -1, smooth: 0, depth: 1, steps: Array(STEP_COUNT).fill(0), stepLen: STEP_COUNT,
  }
}

export function initialModulators(): ModulatorState[] {
  const mods = Array.from({ length: MOD_SLOTS }, defaultModulator)
  mods[0] = { ...mods[0], kind: 1, shape: 0, rateIndex: 6 }
  mods[1] = { ...mods[1], kind: 1, shape: 1, rateIndex: 7 }
  mods[2] = { ...mods[2], kind: 1, shape: 2, rateIndex: 2 }
  mods[3] = { ...mods[3], kind: 2, color: 1 }
  return mods
}

export function initialMacros(): MacroState[] {
  return Array.from({ length: MACROS }, (_, i) => ({ name: `M${i + 1}`, pos: 0, targets: [] }))
}

export function modLabel(slot: number, m: ModulatorState): string {
  return m.kind === 0 ? '+ add' : `${MOD_KINDS[m.kind]}${slot + 1}`
}

export function rateLabel(m: ModulatorState): string {
  if (m.kind === 2) return NOISE_COLORS[m.color]
  return m.sync ? SYNC_LABELS[m.rateIndex] : `${m.hz.toFixed(2)} Hz`
}

const FIXED_RANDOM = [0.3, -0.7, 0.8, -0.2, 0.5, -0.9, 0.1, 0.6]

/** One cycle for tile/editor previews, values −1..1; random shapes use a fixed pattern. */
export function previewShape(m: ModulatorState, n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const p = i / (n - 1)
    if (m.kind === 2) return FIXED_RANDOM[i % FIXED_RANDOM.length]
    if (m.kind === 3) return m.steps[Math.min(m.stepLen - 1, Math.floor(p * m.stepLen))]
    switch (m.shape) {
      case 0: return Math.sin(p * 2 * Math.PI)
      case 2: return FIXED_RANDOM[Math.min(3, Math.floor(p * 4))]
      case 3: return 1 - 4 * Math.abs(p - 0.5)
      case 4: return 1 - 2 * p
      case 5: return 2 * p - 1
      case 6: return p < 0.5 ? 1 : -1
      case 7: return 2 * Math.exp(-5 * p) - 1
      default: {
        const seg = Math.min(3, Math.floor(p * 4))
        const t = p * 4 - seg
        const a = FIXED_RANDOM[seg]
        const b = FIXED_RANDOM[seg + 1]
        return a + (b - a) * (0.5 - 0.5 * Math.cos(t * Math.PI))
      }
    }
  })
}
```

Append to `web/src/audio/wasm.test.ts`:
```ts
import { SNAP_EFFECTIVE, SNAP_FLOATS } from './snapshot'

test('engine snapshot layout matches the UI', async () => {
  const ex = await load()
  expect(ex.utero_snapshot_len()).toBe(SNAP_FLOATS)
})

test('a routed LFO moves the effective value in the snapshot', async () => {
  const ex = await load()
  ex.utero_init(48000)
  // slot 0: LFO square, unsynced 0.01 Hz → output stays +1 during the test
  ex.utero_set_modulator(0, 1, 6, 0, 0, 6, 0.01, 0, 1, 0, -1, 0, 1)
  ex.utero_set_route(0, 0, 0, 3, 0.3)
  for (let i = 0; i < 100; i++) ex.utero_process(128)
  const snap = new Float32Array(ex.memory.buffer, ex.utero_snapshot(), SNAP_FLOATS)
  expect(snap[SNAP_EFFECTIVE + 3]).toBeCloseTo(0.5637 + 0.3, 1)
})

test('garbage modulation commands do not trap', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_modulator(99, 9, 99, 9, 1, 255, NaN, NaN, 1, 9, 999, NaN, NaN)
  ex.utero_set_modulator(0, 1, 0, 0, 1, 255, NaN, NaN, 1, 9, 999, NaN, NaN)
  ex.utero_set_route(999, 99, 99, 99, NaN)
  ex.utero_set_route(0, 0, 0, 0, Infinity)
  ex.utero_clear_route(999)
  ex.utero_set_mod_step(0, 99, NaN)
  ex.utero_set_mod_step_len(0, 0)
  ex.utero_set_macro_target(99, 99, 0, 0, 0, 1)
  ex.utero_set_macro_target(0, 0, 99, 99, NaN, 1)
  ex.utero_set_macro_pos(0, NaN)
  ex.utero_clear_macro_target(99, 99)
  ex.utero_play()
  for (let i = 0; i < 10; i++) ex.utero_process(128)
  const out = new Float32Array(ex.memory.buffer, ex.utero_out_l(), 128)
  expect(out.every(Number.isFinite)).toBe(true)
})
```
(Move the new `import` line to the top of the file with the other imports.)

- [ ] **Step 9: Build and run the tests**

Run: `source "$HOME/.cargo/env" && cargo test && cd web && source ~/.nvm/nvm.sh && npm run wasm && npx vitest run src/audio`
Expected: Rust all green. Vitest audio: ring 5, dispatch 2, isolation 2, wasm 5 pass. (`tsc` fails on `store.ts` until Task 8; do not run it as a gate here.)

- [ ] **Step 10: Commit**

```bash
git add crates/wasm/src/lib.rs web/src/state/types.ts web/src/state/modulation.ts web/src/audio/exports.ts web/src/audio/ops.ts web/src/audio/dispatch.ts web/src/audio/snapshot.ts web/src/audio/worklet.ts web/src/audio/ring.test.ts web/src/audio/dispatch.test.ts web/src/audio/wasm.test.ts
git commit -m "feat(wasm): expose modulation, routes, macros and the snapshot array

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 8: Store: modulators, routes, macros, LEARN

**Files:**
- Create: `web/src/state/modulation.test.ts`, `web/src/state/store.mod.test.ts` (`web/src/state/modulation.ts` exists from Task 7)
- Replace: `web/src/state/store.ts`

**Interfaces:**
- Consumes: `types.ts` and the command builders in `ops.ts` (Task 7).
- Produces from `modulation.ts` (created in Task 7, tested here):
  - Constants: `MOD_SLOTS = 16`, `MAX_ROUTES = 64`, `STEP_COUNT = 16`, `MACROS = 8`, `MACRO_TARGETS = 16`, `MOD_DRAG_TYPE = 'application/x-utero-mod'`
  - Labels: `SYNC_LABELS`, `SHAPES` (`{ code, label }[]`, favourites first), `FAVORITE_SHAPE_COUNT = 3`, `MOD_KINDS`, `NOISE_COLORS`, `TRIG_MODES`
  - Functions: `defaultModulator()`, `initialModulators()`, `initialMacros()`, `modLabel(slot, m)`, `rateLabel(m)`, `previewShape(m, n)`
- Produces from `store.ts`:
  - `initialState()` and `KICK_TRACKS = 2`
  - Helpers: `effectiveValue(state, t, p)`, `modAmountFor(state, t, p)`, `routeIndexFor(state, src, t, p): number` (−1 when none)
  - `createStore()` returning `Store`. Existing actions plus:
    - Modulators: `selectMod(slot)`, `updateModulator(slot, patch: Partial<Omit<ModulatorState, 'steps'>>)`, `setModStep(slot, i, v)`
    - Routes: `addRoute(src, t, p, amount = 0.25): number` (route index, or −1 when full), `setRouteAmount(index, amount)`, `removeRoute(index)`
    - Macros: `selectMacro(m)`, `setMacroPos(m, pos)`, `armLearn(m, side)`, `renameMacro(m, name)`, `removeMacroTarget(m, i)`
  - `setParam` records into the armed macro while LEARN is active.

- [ ] **Step 1: Check `web/src/state/modulation.ts`** — Task 7 already created it (codes, defaults, labels, previews). Read it; do not change it unless a test below proves it wrong.

- [ ] **Step 2: Write the failing tests**

`web/src/state/modulation.test.ts`:
```ts
import { expect, test } from 'vitest'
import { defaultModulator, initialModulators, modLabel, previewShape, rateLabel, SHAPES } from './modulation'

test('defaults: 4 bar sync, bipolar, off', () => {
  const m = defaultModulator()
  expect([m.kind, m.sync, m.rateIndex, m.bipolar, m.depth]).toEqual([0, true, 6, true, 1])
})

test('initial bank has LFO SIN, GLIDE, S&H and pink NOISE', () => {
  const mods = initialModulators()
  expect(mods.slice(0, 4).map((m) => [m.kind, m.shape, m.color])).toEqual([[1, 0, 0], [1, 1, 0], [1, 2, 0], [2, 0, 1]])
  expect(mods.slice(4).every((m) => m.kind === 0)).toBe(true)
})

test('labels', () => {
  const mods = initialModulators()
  expect(modLabel(0, mods[0])).toBe('LFO1')
  expect(modLabel(3, mods[3])).toBe('NOISE4')
  expect(modLabel(9, mods[9])).toBe('+ add')
  expect(rateLabel(mods[0])).toBe('4 BAR')
  expect(rateLabel({ ...mods[0], sync: false, hz: 0.5 })).toBe('0.50 Hz')
  expect(rateLabel(mods[3])).toBe('PINK')
})

test('favourite shapes come first', () => {
  expect(SHAPES.slice(0, 3).map((s) => s.label)).toEqual(['SIN', 'GLIDE', 'S&H'])
})

test('previews stay within −1..1 for every shape and kind', () => {
  for (const s of SHAPES) {
    const v = previewShape({ ...defaultModulator(), kind: 1, shape: s.code }, 24)
    expect(v).toHaveLength(24)
    expect(v.every((x) => x >= -1 && x <= 1)).toBe(true)
  }
  expect(previewShape({ ...defaultModulator(), kind: 3, steps: Array(16).fill(0.5), stepLen: 4 }, 10).every((x) => x === 0.5)).toBe(true)
})
```

`web/src/state/store.mod.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { Op } from '@/audio/ops'
import { KICK_PARAMS } from './kickParams'
import { MAX_ROUTES } from './modulation'
import { createStore, effectiveValue, modAmountFor, routeIndexFor } from './store'

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

describe('sync', () => {
  test('connect sends all 16 modulators and the 8 macro positions', () => {
    const { sent } = connected()
    expect(sent.filter((c) => c[0] === Op.SetModulator)).toHaveLength(16)
    expect(sent.filter((c) => c[0] === Op.SetMacroPos)).toHaveLength(8)
    expect(sent.filter((c) => c[0] === Op.SetRoute)).toHaveLength(0)
  })
})

describe('routes', () => {
  test('addRoute creates one route and sends it', () => {
    const { store, sent } = fresh()
    const i = store.addRoute(0, 0, 3)
    expect(i).toBe(0)
    expect(store.getState().routes[0]).toEqual({ src: 0, track: 0, param: 3, amount: 0.25 })
    expect(sent).toEqual([[Op.SetRoute, 0, 0, 0, 3, 0.25]])
  })

  test('the same source and target are not added twice', () => {
    const { store, sent } = fresh()
    store.addRoute(1, 0, 2)
    expect(store.addRoute(1, 0, 2)).toBe(0)
    expect(sent).toHaveLength(1)
  })

  test('addRoute returns −1 when all slots are used', () => {
    const { store } = fresh()
    // 64 unique (src, track, param) triples
    for (let i = 0; i < MAX_ROUTES; i++) store.addRoute(i % 16, Math.floor(i / 16) % 2, Math.floor(i / 32))
    expect(store.getState().routes.every(Boolean)).toBe(true)
    expect(store.addRoute(15, 1, 15)).toBe(-1)
  })

  test('setRouteAmount clamps to ±1 and removeRoute clears', () => {
    const { store, sent } = fresh()
    const i = store.addRoute(0, 0, 3)
    store.setRouteAmount(i, 4)
    expect(store.getState().routes[i]?.amount).toBe(1)
    store.removeRoute(i)
    expect(store.getState().routes[i]).toBeNull()
    expect(sent.slice(-2)).toEqual([[Op.SetRoute, i, 0, 0, 3, 1], [Op.ClearRoute, i]])
  })

  test('helpers sum amounts and find a route', () => {
    const { store } = fresh()
    store.addRoute(0, 0, 3, 0.25)
    store.addRoute(1, 0, 3, -0.5)
    expect(modAmountFor(store.getState(), 0, 3)).toBeCloseTo(-0.25)
    expect(routeIndexFor(store.getState(), 1, 0, 3)).toBe(1)
    expect(routeIndexFor(store.getState(), 2, 0, 3)).toBe(-1)
  })
})

describe('modulators', () => {
  test('updateModulator merges and sends the full settings', () => {
    const { store, sent } = fresh()
    store.updateModulator(5, { kind: 1, shape: 2, rateIndex: 3 })
    const m = store.getState().modulators[5]
    expect([m.kind, m.shape, m.rateIndex, m.bipolar]).toEqual([1, 2, 3, true])
    expect(sent).toEqual([[Op.SetModulator, 5, 1, 2, 0, 1, 3, 1, 0, 1, 0, -1, 0, 1]])
  })

  test('stepLen changes also send SetModStepLen; steps are clamped', () => {
    const { store, sent } = fresh()
    store.updateModulator(4, { kind: 3, stepLen: 8 })
    store.setModStep(4, 2, 3)
    expect(store.getState().modulators[4].steps[2]).toBe(1)
    expect(sent.map((c) => c[0])).toEqual([Op.SetModulator, Op.SetModStepLen, Op.SetModStep])
  })
})

describe('macros and learn', () => {
  test('arming selects the macro, jumps the fader and sends the position', () => {
    const { store, sent } = fresh()
    store.armLearn(2, 'b')
    expect(store.getState().learn).toEqual({ macro: 2, side: 'b' })
    expect(store.getState().selectedMacro).toBe(2)
    expect(store.getState().macros[2].pos).toBe(1)
    expect(sent).toEqual([[Op.SetMacroPos, 2, 1]])
  })

  test('arming the same side again disarms', () => {
    const { store } = fresh()
    store.armLearn(0, 'a')
    store.armLearn(0, 'a')
    expect(store.getState().learn).toBeNull()
  })

  test('learn records endpoints without touching the base', () => {
    const { store, sent } = fresh()
    const base = store.getState().tracks[0].params[5]
    store.armLearn(0, 'a')
    store.setParam(0, 5, 0.1)
    store.armLearn(0, 'b')
    store.setParam(0, 5, 0.9)
    expect(store.getState().tracks[0].params[5]).toBe(base)
    expect(store.getState().macros[0].targets).toEqual([{ track: 0, param: 5, a: 0.1, b: 0.9 }])
    expect(sent.filter((c) => c[0] === Op.SetMacroTarget).at(-1)).toEqual([Op.SetMacroTarget, 0, 0, 0, 5, 0.1, 0.9])
    expect(sent.some((c) => c[0] === Op.SetParam)).toBe(false)
  })

  test('a new target starts with both ends at the base', () => {
    const { store } = fresh()
    const base = store.getState().tracks[1].params[0]
    store.armLearn(3, 'b')
    store.setParam(1, 0, 0.7)
    expect(store.getState().macros[3].targets[0]).toEqual({ track: 1, param: 0, a: base, b: 0.7 })
  })

  test('removeMacroTarget shifts later targets and resends them', () => {
    const { store, sent } = fresh()
    store.armLearn(0, 'a')
    store.setParam(0, 1, 0.1)
    store.setParam(0, 2, 0.2)
    store.setParam(0, 3, 0.3)
    sent.length = 0
    store.removeMacroTarget(0, 0)
    expect(store.getState().macros[0].targets.map((t) => t.param)).toEqual([2, 3])
    expect(sent.map((c) => [c[0], c[2]])).toEqual([[Op.SetMacroTarget, 0], [Op.SetMacroTarget, 1], [Op.ClearMacroTarget, 2]])
  })

  test('effectiveValue applies the macro interpolation', () => {
    const { store } = fresh()
    store.armLearn(0, 'a')
    store.setParam(0, 0, 0.2)
    store.armLearn(0, 'b')
    store.setParam(0, 0, 0.6)
    store.armLearn(0, 'b') // disarm
    store.setMacroPos(0, 0.5)
    expect(effectiveValue(store.getState(), 0, 0)).toBeCloseTo(0.4)
    expect(effectiveValue(store.getState(), 0, 1)).toBe(KICK_PARAMS[1].default)
  })

  test('renameMacro trims and ignores empty names', () => {
    const { store } = fresh()
    store.renameMacro(1, '  DIRT ')
    store.renameMacro(1, '   ')
    expect(store.getState().macros[1].name).toBe('DIRT')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/state`
Expected: FAIL. `addRoute`, `armLearn` etc. are not functions, and the helpers are not exported.

- [ ] **Step 4: Replace `web/src/state/store.ts`**

```ts
import {
  cmdClearMacroTarget, cmdClearRoute, cmdPlay, cmdSetBpm, cmdSetLength, cmdSetMacroPos, cmdSetMacroTarget,
  cmdSetModStep, cmdSetModStepLen, cmdSetModulator, cmdSetParam, cmdSetRoute, cmdSetSpeed, cmdSetStep, cmdStop,
} from '@/audio/ops'
import { KICK_PARAMS } from './kickParams'
import { initialMacros, initialModulators, MACRO_TARGETS, MAX_ROUTES, STEP_COUNT } from './modulation'
import type { AppState, MacroState, ModulatorState, StepState, TrackState } from './types'

export const KICK_TRACKS = 2

const TRACK_DEFS: [name: string, bus: string][] = [
  ['KICK', 'KICK'], ['KCK2', 'KICK'], ['HH', 'HATS'], ['OH', 'HATS'], ['SNR', 'PERC'], ['NOIS', 'PERC'], ['SMPL', 'PERC'],
  ['SUB', 'BASS'], ['MID', 'BASS'], ['LD1', 'LEAD'], ['LD2', 'LEAD'], ['PAD', 'PAD'], ['ORN', 'ORN'],
]

const emptyStep = (): StepState => ({ trig: false, vel: 1, prob: 100, cond: 0, a: 1, b: 2, micro: 0 })
const isDefault = (s: StepState) => !s.trig && s.vel === 1 && s.prob === 100 && s.cond === 0 && s.micro === 0
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function initialState(): AppState {
  const tracks: TrackState[] = TRACK_DEFS.map(([name, bus], i) => ({
    name,
    bus,
    length: 16,
    speed: 1,
    steps: Array.from({ length: 64 }, emptyStep),
    params: i < KICK_TRACKS ? KICK_PARAMS.map((p) => p.default) : [],
  }))
  for (const s of [0, 4, 8, 12]) tracks[0].steps[s].trig = true
  return {
    bpm: 128, playing: false, selected: 0, tracks,
    modulators: initialModulators(), routes: Array(MAX_ROUTES).fill(null), macros: initialMacros(),
    selectedMod: 0, selectedMacro: 0, learn: null,
  }
}

/** Base value with macro overrides applied (later macro wins), without modulation. */
export function effectiveValue(state: AppState, t: number, p: number): number {
  let v = state.tracks[t].params[p] ?? 0
  for (const m of state.macros) {
    for (const x of m.targets) if (x.track === t && x.param === p) v = x.a + (x.b - x.a) * m.pos
  }
  return v
}

export function modAmountFor(state: AppState, t: number, p: number): number {
  return state.routes.reduce((sum, r) => (r && r.track === t && r.param === p ? sum + r.amount : sum), 0)
}

export function routeIndexFor(state: AppState, src: number, t: number, p: number): number {
  return state.routes.findIndex((r) => r !== null && r.src === src && r.track === t && r.param === p)
}

type Send = (cmd: number[]) => void
type ModulatorPatch = Partial<Omit<ModulatorState, 'steps'>>

export function createStore(initial: AppState = initialState()) {
  let state = initial
  let send: Send = () => {}
  const listeners = new Set<() => void>()

  const set = (next: AppState) => {
    state = next
    listeners.forEach((l) => l())
  }
  const updateTrack = (t: number, fn: (tr: TrackState) => TrackState) =>
    set({ ...state, tracks: state.tracks.map((tr, i) => (i === t ? fn(tr) : tr)) })
  const updateMacro = (m: number, fn: (mac: MacroState) => MacroState) =>
    set({ ...state, macros: state.macros.map((x, i) => (i === m ? fn(x) : x)) })
  const updateMod = (slot: number, next: ModulatorState) =>
    set({ ...state, modulators: state.modulators.map((x, i) => (i === slot ? next : x)) })

  const syncAll = () => {
    send(cmdSetBpm(state.bpm))
    state.tracks.forEach((tr, t) => {
      send(cmdSetLength(t, tr.length))
      send(cmdSetSpeed(t, tr.speed))
      tr.steps.forEach((st, s) => { if (!isDefault(st)) send(cmdSetStep(t, s, st)) })
      tr.params.forEach((v, p) => send(cmdSetParam(t, p, v)))
    })
    state.modulators.forEach((m, slot) => {
      send(cmdSetModulator(slot, m))
      m.steps.forEach((v, i) => { if (v !== 0) send(cmdSetModStep(slot, i, v)) })
      if (m.stepLen !== STEP_COUNT) send(cmdSetModStepLen(slot, m.stepLen))
    })
    state.routes.forEach((r, i) => { if (r) send(cmdSetRoute(i, r)) })
    state.macros.forEach((mac, m) => {
      mac.targets.forEach((t, i) => send(cmdSetMacroTarget(m, i, t)))
      send(cmdSetMacroPos(m, mac.pos))
    })
  }

  const setRoute = (index: number, amount: number) => {
    const r = state.routes[index]
    if (!r) return
    const next = { ...r, amount: clamp(amount, -1, 1) }
    set({ ...state, routes: state.routes.map((x, i) => (i === index ? next : x)) })
    send(cmdSetRoute(index, next))
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    connect(next: Send) {
      send = next
      syncAll()
    },
    toggleStep(t: number, s: number) {
      const step = { ...state.tracks[t].steps[s], trig: !state.tracks[t].steps[s].trig }
      updateTrack(t, (tr) => ({ ...tr, steps: tr.steps.map((st, i) => (i === s ? step : st)) }))
      send(cmdSetStep(t, s, step))
    },
    setLength(t: number, len: number) {
      const length = clamp(Math.round(len), 1, 64)
      updateTrack(t, (tr) => ({ ...tr, length }))
      send(cmdSetLength(t, length))
    },
    setSpeed(t: number, code: number) {
      updateTrack(t, (tr) => ({ ...tr, speed: code }))
      send(cmdSetSpeed(t, code))
    },
    /** While LEARN is armed this writes the macro endpoint instead of the base value. */
    setParam(t: number, p: number, v: number) {
      const value = clamp(v, 0, 1)
      const learn = state.learn
      if (learn) {
        const mac = state.macros[learn.macro]
        let idx = mac.targets.findIndex((x) => x.track === t && x.param === p)
        const base = state.tracks[t].params[p]
        if (idx === -1) {
          if (mac.targets.length >= MACRO_TARGETS) return
          idx = mac.targets.length
        }
        const prev = mac.targets[idx] ?? { track: t, param: p, a: base, b: base }
        const target = { ...prev, [learn.side]: value }
        updateMacro(learn.macro, (x) => ({
          ...x,
          targets: idx < x.targets.length ? x.targets.map((y, i) => (i === idx ? target : y)) : [...x.targets, target],
        }))
        send(cmdSetMacroTarget(learn.macro, idx, target))
        return
      }
      updateTrack(t, (tr) => ({ ...tr, params: tr.params.map((x, i) => (i === p ? value : x)) }))
      send(cmdSetParam(t, p, value))
    },
    setBpm(bpm: number) {
      if (!Number.isFinite(bpm)) return
      const next = clamp(bpm, 20, 300)
      set({ ...state, bpm: next })
      send(cmdSetBpm(next))
    },
    play() {
      set({ ...state, playing: true })
      send(cmdPlay())
    },
    stop() {
      set({ ...state, playing: false })
      send(cmdStop())
    },
    select(t: number) {
      set({ ...state, selected: t })
    },
    selectMod(slot: number) {
      set({ ...state, selectedMod: slot })
    },
    updateModulator(slot: number, patch: ModulatorPatch) {
      const next = { ...state.modulators[slot], ...patch }
      updateMod(slot, next)
      send(cmdSetModulator(slot, next))
      if (patch.stepLen !== undefined) send(cmdSetModStepLen(slot, next.stepLen))
    },
    setModStep(slot: number, i: number, v: number) {
      const value = clamp(v, -1, 1)
      const m = state.modulators[slot]
      updateMod(slot, { ...m, steps: m.steps.map((x, k) => (k === i ? value : x)) })
      send(cmdSetModStep(slot, i, value))
    },
    addRoute(src: number, t: number, p: number, amount = 0.25): number {
      const existing = routeIndexFor(state, src, t, p)
      if (existing !== -1) return existing
      const index = state.routes.findIndex((r) => r === null)
      if (index === -1) return -1
      const route = { src, track: t, param: p, amount: clamp(amount, -1, 1) }
      set({ ...state, routes: state.routes.map((r, i) => (i === index ? route : r)) })
      send(cmdSetRoute(index, route))
      return index
    },
    setRouteAmount(index: number, amount: number) {
      setRoute(index, amount)
    },
    removeRoute(index: number) {
      if (!state.routes[index]) return
      set({ ...state, routes: state.routes.map((r, i) => (i === index ? null : r)) })
      send(cmdClearRoute(index))
    },
    selectMacro(m: number) {
      set({ ...state, selectedMacro: m })
    },
    setMacroPos(m: number, pos: number) {
      const value = clamp(pos, 0, 1)
      updateMacro(m, (x) => ({ ...x, pos: value }))
      send(cmdSetMacroPos(m, value))
    },
    armLearn(m: number, side: 'a' | 'b') {
      if (state.learn?.macro === m && state.learn.side === side) {
        set({ ...state, learn: null })
        return
      }
      const pos = side === 'a' ? 0 : 1
      set({
        ...state,
        learn: { macro: m, side },
        selectedMacro: m,
        macros: state.macros.map((x, i) => (i === m ? { ...x, pos } : x)),
      })
      send(cmdSetMacroPos(m, pos))
    },
    renameMacro(m: number, name: string) {
      const trimmed = name.trim()
      if (trimmed) updateMacro(m, (x) => ({ ...x, name: trimmed }))
    },
    removeMacroTarget(m: number, i: number) {
      const old = state.macros[m].targets
      if (i < 0 || i >= old.length) return
      const next = old.filter((_, k) => k !== i)
      updateMacro(m, (x) => ({ ...x, targets: next }))
      // Engine slots mirror array indices: resend the shifted tail, clear the freed last slot.
      for (let k = i; k < next.length; k++) send(cmdSetMacroTarget(m, k, next[k]))
      send(cmdClearMacroTarget(m, old.length - 1))
    },
  }
}

export type Store = ReturnType<typeof createStore>
```

- [ ] **Step 5: Run the tests and the type-check**

Run: `cd web && npx vitest run src/state && npx tsc --noEmit`
Expected: modulation 5, store.mod all green, and the existing store 9 still pass; `tsc` reports no errors (the UI still uses only the old subset of the store API).

- [ ] **Step 6: Commit**

```bash
git add web/src/state/modulation.ts web/src/state/modulation.test.ts web/src/state/store.ts web/src/state/store.mod.test.ts
git commit -m "feat(web): store modulators, routes and a/b macros with learn

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 9: Engine frame hook + modulation-aware Knob

**Files:**
- Create: `web/src/ui/useEngineFrame.ts`, `web/src/ui/Knob.test.tsx`
- Replace: `web/src/ui/Knob.tsx`

**Interfaces:**
- Consumes: `MOD_DRAG_TYPE` (Task 7, `web/src/state/modulation.ts`).
- Produces:
  - `useEngineFrame(snapshot: Float32Array | null): Float32Array | null`: a fresh copy each animation frame.
  - `Knob` props:
    - `label`, `value` (the edited value: base, or the macro endpoint while learning), `display?` (live effective value), `defaultValue`
    - `modAmount?`, `markers?: { a: number; b: number } | null`, `learning?`, `selected?`
    - `onChange(v)`, `onModAmount?(delta)`, `onDropModulator?(slot)`, `onSelect?()`
  - Dragging inside radius 21 (in the 56 px knob) changes the value; dragging outside changes the route amount. Keyboard: Up/Right +0.01, Down/Left −0.01 (⇧ = 0.001), Home = 0, End = 1.

- [ ] **Step 1: Write the failing tests** in `web/src/ui/Knob.test.tsx`

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MOD_DRAG_TYPE } from '@/state/modulation'
import { Knob } from './Knob'

afterEach(cleanup)

function setup(extra: Partial<Parameters<typeof Knob>[0]> = {}) {
  const onChange = vi.fn()
  render(<Knob label="DECAY" value={0.5} defaultValue={0.3} onChange={onChange} {...extra} />)
  return { onChange, knob: screen.getByRole('slider', { name: 'DECAY' }) }
}

test('exposes value and live display through ARIA', () => {
  const { knob } = setup({ display: 0.62, modAmount: 0.2 })
  expect(knob.getAttribute('aria-valuenow')).toBe('50')
  expect(knob.getAttribute('aria-valuetext')).toBe('62, modulated 20')
})

test('keyboard steps the value', () => {
  const { knob, onChange } = setup()
  fireEvent.keyDown(knob, { key: 'ArrowUp' })
  expect(onChange).toHaveBeenLastCalledWith(0.51)
  fireEvent.keyDown(knob, { key: 'ArrowLeft', shiftKey: true })
  expect(onChange.mock.calls.at(-1)?.[0]).toBeCloseTo(0.509)
  fireEvent.keyDown(knob, { key: 'End' })
  expect(onChange).toHaveBeenLastCalledWith(1)
  fireEvent.keyDown(knob, { key: 'Home' })
  expect(onChange).toHaveBeenLastCalledWith(0)
})

test('double click resets to default', () => {
  const { knob, onChange } = setup()
  fireEvent.doubleClick(knob)
  expect(onChange).toHaveBeenLastCalledWith(0.3)
})

test('dropping a modulator reports its slot', () => {
  const onDropModulator = vi.fn()
  const { knob } = setup({ onDropModulator })
  const dataTransfer = { types: [MOD_DRAG_TYPE], getData: (t: string) => (t === MOD_DRAG_TYPE ? '3' : '') }
  fireEvent.dragOver(knob, { dataTransfer })
  fireEvent.drop(knob, { dataTransfer })
  expect(onDropModulator).toHaveBeenCalledWith(3)
})

test('a drop without modulator data is ignored', () => {
  const onDropModulator = vi.fn()
  const { knob } = setup({ onDropModulator })
  fireEvent.drop(knob, { dataTransfer: { types: ['text/plain'], getData: () => '' } })
  expect(onDropModulator).not.toHaveBeenCalled()
})

test('label button selects the parameter', () => {
  const onSelect = vi.fn()
  setup({ onSelect })
  fireEvent.click(screen.getByRole('button', { name: 'DECAY' }))
  expect(onSelect).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/ui/Knob.test.tsx`
Expected: FAIL. `aria-valuetext` is missing, the keys and drop are not handled, and there is no label button.

- [ ] **Step 3: Implement**

`web/src/ui/useEngineFrame.ts`:
```ts
import { useEffect, useState } from 'react'

/** Copies the shared engine snapshot once per animation frame. */
export function useEngineFrame(snapshot: Float32Array | null): Float32Array | null {
  const [frame, setFrame] = useState<Float32Array | null>(null)
  useEffect(() => {
    if (!snapshot) {
      setFrame(null)
      return
    }
    let raf = 0
    const loop = () => {
      setFrame(snapshot.slice())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [snapshot])
  return frame
}
```

`web/src/ui/Knob.tsx` (replace):
```tsx
import { useRef } from 'react'
import { MOD_DRAG_TYPE } from '@/state/modulation'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const SIZE = 56
const MID = SIZE / 2
const R = 18
const C = 2 * Math.PI * R
const RM = 24
const CM = 2 * Math.PI * RM
/** Drags beyond this radius (in knob units) edit the modulation amount. */
const MOD_RING_RADIUS = 21
const angleOf = (v: number) => 135 + v * 270
const pointAt = (v: number, r: number) => {
  const a = (angleOf(v) * Math.PI) / 180
  return { x: MID + r * Math.cos(a), y: MID + r * Math.sin(a) }
}

export interface KnobProps {
  label: string
  /** The value being edited: the base, or the macro endpoint while LEARN is armed. */
  value: number
  /** Live value after macros and modulation; defaults to `value`. */
  display?: number
  defaultValue: number
  /** Sum of route amounts on this parameter, −1..1. */
  modAmount?: number
  markers?: { a: number; b: number } | null
  learning?: boolean
  selected?: boolean
  onChange(value: number): void
  onModAmount?(delta: number): void
  onDropModulator?(slot: number): void
  onSelect?(): void
}

/** Vertical drag (⇧ = fine); outer ring drag = mod amount; double-click = default; drop a modulator to route it. */
export function Knob({
  label, value, display = value, defaultValue, modAmount = 0, markers = null, learning = false, selected = false,
  onChange, onModAmount, onDropModulator, onSelect,
}: KnobProps) {
  const drag = useRef<{ y: number; mode: 'value' | 'mod' } | null>(null)
  const current = useRef(value)
  current.current = value

  const nudge = (delta: number) => {
    const next = clamp01(current.current + delta)
    current.current = next
    onChange(next)
  }

  const modLen = Math.min(1, Math.abs(modAmount)) * 0.75 * CM
  const modRotate = modAmount >= 0 ? angleOf(value) : angleOf(value) - Math.min(1, -modAmount) * 270
  const dot = pointAt(display, R)
  const pct = (v: number) => Math.round(v * 100)

  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      <svg
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct(value)}
        aria-valuetext={`${pct(display)}${modAmount ? `, modulated ${pct(modAmount)}` : ''}`}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-acc ${learning ? 'ring-1 ring-red-500' : ''}`}
        onPointerDown={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const scale = box.width / SIZE || 1
          const dist = Math.hypot(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2)) / scale
          const mode = onModAmount && modAmount !== 0 && dist > MOD_RING_RADIUS ? 'mod' : 'value'
          e.currentTarget.setPointerCapture?.(e.pointerId)
          drag.current = { y: e.clientY, mode }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const delta = (drag.current.y - e.clientY) / (e.shiftKey ? 1000 : 200)
          drag.current.y = e.clientY
          if (drag.current.mode === 'mod') onModAmount?.(delta)
          else nudge(delta)
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onLostPointerCapture={() => { drag.current = null }}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.001 : 0.01
          const keys: Record<string, () => void> = {
            ArrowUp: () => nudge(step), ArrowRight: () => nudge(step),
            ArrowDown: () => nudge(-step), ArrowLeft: () => nudge(-step),
            Home: () => onChange(0), End: () => onChange(1),
          }
          const action = keys[e.key]
          if (action) {
            e.preventDefault()
            action()
          }
        }}
        onDragOver={(e) => {
          if (onDropModulator && Array.from(e.dataTransfer.types).includes(MOD_DRAG_TYPE)) e.preventDefault()
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(MOD_DRAG_TYPE)
          if (!onDropModulator || raw === '') return
          e.preventDefault()
          onDropModulator(Number(raw))
        }}
      >
        <circle cx={MID} cy={MID} r={R} fill="none" strokeWidth={4} className="stroke-zinc-800"
          strokeDasharray={`${0.75 * C} ${C}`} transform={`rotate(135 ${MID} ${MID})`} />
        <circle cx={MID} cy={MID} r={R} fill="none" strokeWidth={4} className="stroke-acc"
          strokeDasharray={`${0.75 * C * value} ${C}`} transform={`rotate(135 ${MID} ${MID})`} />
        {modAmount !== 0 && (
          <circle cx={MID} cy={MID} r={RM} fill="none" strokeWidth={2} className="stroke-mod"
            strokeDasharray={`${modLen} ${CM}`} transform={`rotate(${modRotate} ${MID} ${MID})`} />
        )}
        {markers && (
          <>
            <circle cx={pointAt(markers.a, RM).x} cy={pointAt(markers.a, RM).y} r={2.5} className="fill-zinc-400" />
            <circle cx={pointAt(markers.b, RM).x} cy={pointAt(markers.b, RM).y} r={2.5} className="fill-mod" />
          </>
        )}
        <circle cx={dot.x} cy={dot.y} r={2} className="fill-zinc-100" />
      </svg>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        className={`rounded text-[10px] uppercase tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-acc ${selected ? 'text-mod' : 'text-zinc-400'}`}>
        {label}
      </button>
      <span className="text-sm tabular-nums">{pct(display)}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/ui/Knob.test.tsx`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/useEngineFrame.ts web/src/ui/Knob.tsx web/src/ui/Knob.test.tsx
git commit -m "feat(web): modulation-aware knob with drop target and engine frame hook

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 10: Modulator strip (editor + 16 tiles)

**Files:**
- Create: `web/src/ui/ModStrip.tsx`, `web/src/ui/ModStrip.test.tsx`

**Interfaces:**
- Consumes:
  - From `modulation.ts`: `MOD_DRAG_TYPE`, `MOD_KINDS`, `NOISE_COLORS`, `SHAPES`, `FAVORITE_SHAPE_COUNT`, `SYNC_LABELS`, `TRIG_MODES`, `modLabel`, `rateLabel`, `previewShape`
  - `modOutputOf` (Task 7), `Store` (Task 8), `Knob` (Task 9)
- Produces: `ModStrip({ state, frame, store })`.
  - **Clicking a tile** selects it. Clicking an empty tile also turns it into an LFO.
  - **Tiles of non-OFF slots** are draggable, carrying `MOD_DRAG_TYPE` with the slot.
  - **The editor** edits the selected slot.

- [ ] **Step 1: Write the failing tests** in `web/src/ui/ModStrip.test.tsx`

```tsx
// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { MOD_DRAG_TYPE } from '@/state/modulation'
import { createStore, type Store } from '@/state/store'
import { ModStrip } from './ModStrip'

afterEach(cleanup)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return <ModStrip state={state} frame={null} store={store} />
}

function setup() {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('shows 16 tiles with the default bank', () => {
  setup()
  expect(screen.getByRole('button', { name: /^LFO1/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /^NOISE4/ })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: /empty$/ })).toHaveLength(12)
})

test('clicking an empty tile creates an LFO and selects it', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Slot 5 empty' }))
  expect(store.getState().selectedMod).toBe(4)
  expect(store.getState().modulators[4].kind).toBe(1)
})

test('shape buttons edit the selected modulator', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'GLIDE' }))
  expect(store.getState().modulators[0].shape).toBe(1)
})

test('rate select uses the sync list', () => {
  const store = setup()
  fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '9' } })
  expect(store.getState().modulators[0].rateIndex).toBe(9)
})

test('dragging a tile carries its slot', () => {
  setup()
  const data: Record<string, string> = {}
  const dataTransfer = { setData: (t: string, v: string) => { data[t] = v }, effectAllowed: '' }
  fireEvent.dragStart(screen.getByRole('button', { name: /^LFO2/ }), { dataTransfer })
  expect(data[MOD_DRAG_TYPE]).toBe('1')
})

test('target count badge follows routes', () => {
  const store = setup()
  store.addRoute(0, 0, 3)
  store.addRoute(0, 0, 4)
  expect(screen.getByRole('button', { name: 'LFO1, 2 targets' })).toBeTruthy()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/ui/ModStrip.test.tsx`
Expected: FAIL, `./ModStrip` cannot be resolved.

- [ ] **Step 3: Implement** `web/src/ui/ModStrip.tsx`

```tsx
import type { PointerEvent } from 'react'
import { modOutputOf } from '@/audio/snapshot'
import {
  FAVORITE_SHAPE_COUNT, MOD_DRAG_TYPE, MOD_KINDS, modLabel, NOISE_COLORS, previewShape, rateLabel, SHAPES, STEP_COUNT,
  SYNC_LABELS, TRIG_MODES,
} from '@/state/modulation'
import type { Store } from '@/state/store'
import type { AppState, ModKind, ModulatorState } from '@/state/types'
import { Knob } from './Knob'

const W = 100
const H = 24
const toY = (v: number) => (1 - (v + 1) / 2) * (H - 2) + 1
const pathOf = (values: number[]) =>
  values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * W).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
const select = 'rounded bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus-visible:ring-2 focus-visible:ring-acc'
const toggle = (on: boolean) =>
  `rounded border px-1.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${on ? 'border-mod text-mod' : 'border-zinc-700 text-zinc-400'}`

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

export function ModStrip({ state, frame, store }: Props) {
  const slot = state.selectedMod
  const pick = (i: number) => {
    store.selectMod(i)
    if (state.modulators[i].kind === 0) store.updateModulator(i, { kind: 1 })
  }
  return (
    <section aria-label="Modulators" className="grid h-full min-h-0 grid-cols-[340px_1fr] gap-2 border-t border-zinc-800 p-2">
      <ModEditor slot={slot} m={state.modulators[slot]} tracks={state.tracks.map((t) => t.name)} store={store} />
      <div className="grid min-h-0 grid-cols-8 grid-rows-2 gap-1">
        {state.modulators.map((m, i) => {
          const off = m.kind === 0
          const targets = state.routes.filter((r) => r?.src === i).length
          const live = frame ? modOutputOf(frame, i) : 0
          const liveY = toY(m.bipolar ? live : live * 2 - 1)
          return (
            <div key={i} role="button" tabIndex={0} draggable={!off} aria-pressed={slot === i}
              aria-label={off ? `Slot ${i + 1} empty` : `${modLabel(i, m)}, ${targets} targets`}
              onClick={() => pick(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  pick(i)
                }
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData(MOD_DRAG_TYPE, String(i))
                e.dataTransfer.effectAllowed = 'link'
              }}
              className={[
                'relative flex min-w-0 flex-col justify-between rounded border px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc',
                off ? 'cursor-pointer items-center justify-center border-dashed border-zinc-800 text-[9px] text-zinc-500'
                  : 'cursor-grab border-sky-950 bg-[#0a141a]',
                slot === i && !off ? 'ring-1 ring-mod' : '',
              ].join(' ')}>
              {off ? '+ add' : (
                <>
                  <div className="flex justify-between gap-1 text-[9px]">
                    <span className="truncate text-mod">{modLabel(i, m)}</span>
                    <span className="truncate text-sky-700">{rateLabel(m)}</span>
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-5 w-full" aria-hidden="true">
                    <path d={pathOf(previewShape(m, 24))} fill="none" className="stroke-mod" strokeWidth={1.2} />
                    <line x1={0} x2={W} y1={liveY} y2={liveY} className="stroke-zinc-100/50" strokeWidth={0.8} />
                  </svg>
                  {targets > 0 && (
                    <span className="absolute right-1 bottom-0.5 rounded-full bg-mod px-1 text-[8px] text-black">{targets}</span>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

interface EditorProps {
  slot: number
  m: ModulatorState
  tracks: string[]
  store: Store
}

function ModEditor({ slot, m, tracks, store }: EditorProps) {
  const update = (patch: Parameters<Store['updateModulator']>[1]) => store.updateModulator(slot, patch)
  const timed = m.kind === 1 || m.kind === 3
  return (
    <div className="flex min-h-0 flex-col gap-1 rounded border border-mod/60 bg-[#0a141a] p-1.5 text-[10px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-mod">{modLabel(slot, m)}</span>
        <select aria-label="Modulator type" value={m.kind} className={select}
          onChange={(e) => update({ kind: Number(e.target.value) as ModKind })}>
          {MOD_KINDS.map((k, i) => <option key={k} value={i}>{k}</option>)}
        </select>
        {timed && (
          <>
            <button type="button" className={toggle(m.sync)} aria-pressed={m.sync} onClick={() => update({ sync: !m.sync })}>
              {m.sync ? 'SYNC' : 'HZ'}
            </button>
            {m.sync ? (
              <select aria-label="Rate" value={m.rateIndex} className={select} onChange={(e) => update({ rateIndex: Number(e.target.value) })}>
                {SYNC_LABELS.map((l, i) => <option key={l} value={i}>{l}</option>)}
              </select>
            ) : (
              <input aria-label="Rate in Hz" type="number" min={0.01} max={40} step={0.01} value={m.hz} className={`${select} w-16`}
                onChange={(e) => { if (Number.isFinite(e.target.valueAsNumber)) update({ hz: e.target.valueAsNumber }) }} />
            )}
          </>
        )}
        {m.kind === 2 && (
          <select aria-label="Noise colour" value={m.color} className={select} onChange={(e) => update({ color: Number(e.target.value) })}>
            {NOISE_COLORS.map((c, i) => <option key={c} value={i}>{c}</option>)}
          </select>
        )}
        {m.kind !== 0 && (
          <button type="button" className={toggle(m.bipolar)} aria-pressed={m.bipolar} onClick={() => update({ bipolar: !m.bipolar })}>
            {m.bipolar ? 'BI' : 'UNI'}
          </button>
        )}
      </div>
      {m.kind === 1 && (
        <div role="group" aria-label="Shape" className="flex flex-wrap gap-1">
          {SHAPES.map((s, i) => (
            <button key={s.code} type="button" aria-pressed={m.shape === s.code} onClick={() => update({ shape: s.code })}
              className={[
                'rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-acc',
                i === FAVORITE_SHAPE_COUNT ? 'ml-2' : '',
                m.shape === s.code ? 'bg-sky-950 text-mod' : i < FAVORITE_SHAPE_COUNT ? 'text-zinc-200' : 'text-zinc-500',
              ].join(' ')}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {m.kind === 3 && <StepBars m={m} onStep={(i, v) => store.setModStep(slot, i, v)} onLen={(len) => update({ stepLen: len })} />}
      {m.kind !== 0 && (
        <div className="flex items-end gap-1">
          {timed && <Knob label="PHASE" value={m.phase} defaultValue={0} onChange={(v) => update({ phase: v })} />}
          <Knob label="SMOOTH" value={m.smooth} defaultValue={0} onChange={(v) => update({ smooth: v })} />
          <Knob label="DEPTH" value={m.depth} defaultValue={1} onChange={(v) => update({ depth: v })} />
          {timed && (
            <div className="flex flex-col gap-1 pb-1">
              <select aria-label="Trigger mode" value={m.trigMode} className={select} onChange={(e) => update({ trigMode: Number(e.target.value) })}>
                {TRIG_MODES.map((t, i) => <option key={t} value={i}>{t}</option>)}
              </select>
              <select aria-label="Trigger source" value={m.trigSrc} className={select} onChange={(e) => update({ trigSrc: Number(e.target.value) })}>
                <option value={-1}>TRIG —</option>
                {tracks.map((t, i) => <option key={t} value={i}>{t}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StepBars({ m, onStep, onLen }: { m: ModulatorState; onStep(i: number, v: number): void; onLen(len: number): void }) {
  const fromPointer = (e: PointerEvent<HTMLDivElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect()
    onStep(i, Math.max(-1, Math.min(1, 1 - ((e.clientY - r.top) / r.height) * 2)))
  }
  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="Step values" className="flex h-10 flex-1 gap-px">
        {m.steps.map((v, i) => (
          <div key={i} role="slider" tabIndex={0} aria-label={`Step ${i + 1}`} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}
            onPointerDown={(e) => fromPointer(e, i)}
            onPointerMove={(e) => { if (e.buttons) fromPointer(e, i) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') { e.preventDefault(); onStep(i, Math.min(1, v + 0.1)) }
              if (e.key === 'ArrowDown') { e.preventDefault(); onStep(i, Math.max(-1, v - 0.1)) }
            }}
            className={`relative flex-1 rounded-sm bg-zinc-900 outline-none focus-visible:ring-1 focus-visible:ring-acc ${i >= m.stepLen ? 'opacity-30' : ''}`}>
            <div className="absolute right-0 left-0 bg-mod/70"
              style={v >= 0 ? { bottom: '50%', height: `${v * 50}%` } : { top: '50%', height: `${-v * 50}%` }} />
          </div>
        ))}
      </div>
      <label className="flex items-center gap-1 text-zinc-400">
        LEN
        <select value={m.stepLen} className={select} onChange={(e) => onLen(Number(e.target.value))}>
          {Array.from({ length: STEP_COUNT }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
      </label>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/ui/ModStrip.test.tsx`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/ModStrip.tsx web/src/ui/ModStrip.test.tsx
git commit -m "feat(web): add modulator strip with editor and draggable tiles

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 11: Macro faders, machine panel wiring, layout

**Files:**
- Create: `web/src/ui/MacroFaders.tsx`, `web/src/ui/MacroFaders.test.tsx`, `web/src/ui/MachinePanel.test.tsx`
- Replace: `web/src/ui/MachinePanel.tsx`, `web/src/App.tsx`
- Modify: `web/src/ui/SequencerMatrix.tsx` (one class name)
- Delete: `web/src/ui/usePlayheads.ts` (App now uses `useEngineFrame`)

**Interfaces:**
- Consumes:
  - `Store`, `effectiveValue`, `modAmountFor`, `routeIndexFor`, `KICK_TRACKS` (Task 8)
  - `Knob`, `useEngineFrame` (Task 9), `ModStrip` (Task 10)
  - `effectiveOf`, `playheadOf`, `SNAP_TRACKS` (Task 7)
  - `KICK_PARAMS`, `KICK_PAGES`, `modLabel`
- Produces:
  - `MacroFaders({ state, store })`
  - `MachinePanel({ state, frame, store })`
  - App layout:
    - left column: sequencer matrix (flex-1) above the modulator strip (fixed height, 190 px)
    - right column (440 px): machine panel, with the knobs, the "mod on <param>" route list, and the macro faders at the bottom

- [ ] **Step 1: Write the failing tests**

`web/src/ui/MacroFaders.test.tsx`:
```tsx
// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { createStore, type Store } from '@/state/store'
import { MacroFaders } from './MacroFaders'

afterEach(cleanup)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return <MacroFaders state={state} store={store} />
}

const setup = () => {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('renders 8 vertical faders', () => {
  setup()
  expect(screen.getAllByRole('slider')).toHaveLength(8)
})

test('A and B buttons arm and disarm learn', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Learn M3 B' }))
  expect(store.getState().learn).toEqual({ macro: 2, side: 'b' })
  expect(screen.getByRole('button', { name: 'Learn M3 B' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Learn M3 B' }))
  expect(store.getState().learn).toBeNull()
})

test('keyboard moves a fader', () => {
  const store = setup()
  const fader = screen.getByRole('slider', { name: 'M1 macro' })
  fireEvent.keyDown(fader, { key: 'ArrowUp', shiftKey: true })
  expect(store.getState().macros[0].pos).toBeCloseTo(0.1)
  fireEvent.keyDown(fader, { key: 'End' })
  expect(store.getState().macros[0].pos).toBe(1)
})

test('double-click on the name renames the macro', () => {
  const store = setup()
  fireEvent.doubleClick(screen.getByRole('button', { name: 'M2' }))
  const input = screen.getByLabelText('Rename M2')
  fireEvent.change(input, { target: { value: 'DIRT' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(store.getState().macros[1].name).toBe('DIRT')
})
```

`web/src/ui/MachinePanel.test.tsx`:
```tsx
// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { MOD_DRAG_TYPE } from '@/state/modulation'
import { createStore, type Store } from '@/state/store'
import { MachinePanel } from './MachinePanel'

afterEach(cleanup)

function Harness({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return <MachinePanel state={state} frame={null} store={store} />
}

const setup = () => {
  const store = createStore()
  render(<Harness store={store} />)
  return store
}

test('a route can be added without drag and drop, then removed', () => {
  const store = setup()
  fireEvent.click(screen.getByRole('button', { name: 'DECAY' }))
  fireEvent.change(screen.getByLabelText('Modulator to add'), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: '+ route' }))
  expect(store.getState().routes[0]).toEqual({ src: 1, track: 0, param: 3, amount: 0.25 })
  fireEvent.change(screen.getByLabelText('LFO2 amount'), { target: { value: '-40' } })
  expect(store.getState().routes[0]?.amount).toBeCloseTo(-0.4)
  fireEvent.click(screen.getByRole('button', { name: 'Remove LFO2 route' }))
  expect(store.getState().routes[0]).toBeNull()
})

test('dropping a tile on a knob routes it to that parameter', () => {
  const store = setup()
  const dataTransfer = { types: [MOD_DRAG_TYPE], getData: () => '2' }
  fireEvent.drop(screen.getByRole('slider', { name: 'TUNE' }), { dataTransfer })
  expect(store.getState().routes[0]).toMatchObject({ src: 2, track: 0, param: 0 })
})

test('while learning, knobs edit the macro endpoint', () => {
  const store = setup()
  store.armLearn(0, 'b')
  fireEvent.keyDown(screen.getByRole('slider', { name: 'DRIVE' }), { key: 'End' })
  expect(store.getState().macros[0].targets[0]).toMatchObject({ track: 0, param: 5, b: 1 })
  expect(store.getState().tracks[0].params[5]).toBe(0.2)
})

test('tracks without a machine say so', () => {
  const store = setup()
  store.select(4)
  expect(screen.getByText(/nincs még machine/)).toBeTruthy()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/ui/MacroFaders.test.tsx src/ui/MachinePanel.test.tsx`
Expected: FAIL. `./MacroFaders` cannot be resolved, and MachinePanel has no `store` prop.

- [ ] **Step 3: Implement**

`web/src/ui/MacroFaders.tsx`:
```tsx
import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { KICK_PARAMS } from '@/state/kickParams'
import type { Store } from '@/state/store'
import type { AppState } from '@/state/types'

interface Props {
  state: AppState
  store: Store
}

export function MacroFaders({ state, store }: Props) {
  const [editing, setEditing] = useState<number | null>(null)
  const sel = state.macros[state.selectedMacro]
  const paramName = (t: number, p: number) => `${state.tracks[t]?.name}.${KICK_PARAMS[p]?.name ?? p}`
  const hint = state.learn
    ? `${state.macros[state.learn.macro].name} · ${state.learn.side.toUpperCase()} élesítve: amit most tekersz, az lesz a ${state.learn.side.toUpperCase()} állapot`
    : sel.targets.length
      ? `${sel.name} → ${sel.targets.map((t) => paramName(t.track, t.param)).join(', ')}`
      : `${sel.name}: nincs cél – nyomd meg az A-t vagy a B-t, és tekerj`

  return (
    <section aria-label="Macros" className="flex min-h-0 flex-1 flex-col gap-1 border-t border-zinc-800 p-2">
      <span className="text-[9px] tracking-wider text-zinc-500 uppercase">macros · A ↔ B</span>
      <div className="grid min-h-0 flex-1 grid-cols-8 gap-1.5">
        {state.macros.map((mac, m) => {
          const armed = state.learn?.macro === m ? state.learn.side : null
          return (
            <div key={m} className="grid min-h-0 grid-rows-[auto_auto_1fr_auto_auto] justify-items-center gap-1">
              <ArmButton label={`${mac.name} B`} side="b" armed={armed === 'b'} onClick={() => store.armLearn(m, 'b')} />
              {editing === m ? (
                <input aria-label={`Rename ${mac.name}`} autoFocus defaultValue={mac.name}
                  className="w-full rounded bg-zinc-900 text-center text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-acc"
                  onBlur={(e) => { store.renameMacro(m, e.target.value); setEditing(null) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditing(null)
                  }} />
              ) : (
                <button type="button" aria-pressed={state.selectedMacro === m} onClick={() => store.selectMacro(m)} onDoubleClick={() => setEditing(m)}
                  className={`max-w-full truncate rounded text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-acc ${state.selectedMacro === m ? 'text-acc' : 'text-zinc-200'}`}>
                  {mac.name}
                </button>
              )}
              <Fader name={mac.name} pos={mac.pos} empty={mac.targets.length === 0} onPos={(p) => store.setMacroPos(m, p)} />
              <ArmButton label={`${mac.name} A`} side="a" armed={armed === 'a'} onClick={() => store.armLearn(m, 'a')} />
              <span className="text-[8px] text-zinc-500">{mac.targets.length} param</span>
            </div>
          )
        })}
      </div>
      <p className="truncate text-[9px] text-zinc-500">{hint}</p>
    </section>
  )
}

function ArmButton({ label, side, armed, onClick }: { label: string; side: 'a' | 'b'; armed: boolean; onClick(): void }) {
  return (
    <button type="button" aria-label={`Learn ${label}`} aria-pressed={armed} onClick={onClick}
      className={[
        'w-full rounded border text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-acc',
        armed ? 'animate-pulse border-red-500 bg-red-500 text-white' : side === 'b' ? 'border-sky-900 text-mod' : 'border-zinc-500 text-zinc-300',
      ].join(' ')}>
      {side.toUpperCase()}
    </button>
  )
}

function Fader({ name, pos, empty, onPos }: { name: string; pos: number; empty: boolean; onPos(p: number): void }) {
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onPos(Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const keys: Record<string, number> = {
      ArrowUp: pos + step, ArrowRight: pos + step, ArrowDown: pos - step, ArrowLeft: pos - step, Home: 0, End: 1,
    }
    if (e.key in keys) {
      e.preventDefault()
      onPos(Math.min(1, Math.max(0, keys[e.key])))
    }
  }
  return (
    <div role="slider" tabIndex={0} aria-label={`${name} macro`} aria-orientation="vertical"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos * 100)}
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

`web/src/ui/MachinePanel.tsx` (replace):
```tsx
import { useState } from 'react'
import { effectiveOf } from '@/audio/snapshot'
import { KICK_PAGES, KICK_PARAMS } from '@/state/kickParams'
import { modLabel } from '@/state/modulation'
import { effectiveValue, KICK_TRACKS, modAmountFor, routeIndexFor, type Store } from '@/state/store'
import type { AppState } from '@/state/types'
import { Knob } from './Knob'
import { MacroFaders } from './MacroFaders'

interface Props {
  state: AppState
  frame: Float32Array | null
  store: Store
}

const btn = 'rounded border border-zinc-700 px-1.5 text-zinc-300 outline-none hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc'

export function MachinePanel({ state, frame, store }: Props) {
  const [page, setPage] = useState(0)
  const [selParam, setSelParam] = useState(0)
  const [addSrc, setAddSrc] = useState(0)
  const t = state.selected
  const track = state.tracks[t]

  if (t >= KICK_TRACKS) {
    return (
      <aside aria-label="Machine" className="flex flex-col">
        <p className="p-3 text-zinc-500"><b className="text-acc">{track.name}</b>: nincs még machine (későbbi terv).</p>
        <MacroFaders state={state} store={store} />
      </aside>
    )
  }

  const learn = state.learn
  const selMacro = state.macros[state.selectedMacro]
  const knob = (p: number) => {
    const marker = selMacro.targets.find((x) => x.track === t && x.param === p)
    const learnTarget = learn ? state.macros[learn.macro].targets.find((x) => x.track === t && x.param === p) : undefined
    const base = track.params[p]
    const value = learn ? (learnTarget ? learnTarget[learn.side] : base) : base
    const display = learn ? value : frame ? effectiveOf(frame, t, p) : effectiveValue(state, t, p)
    return (
      <Knob key={p} label={KICK_PARAMS[p].name} value={value} display={display} defaultValue={KICK_PARAMS[p].default}
        modAmount={modAmountFor(state, t, p)} markers={marker ? { a: marker.a, b: marker.b } : null}
        learning={learn !== null} selected={selParam === p}
        onChange={(v) => store.setParam(t, p, v)}
        onSelect={() => setSelParam(p)}
        onDropModulator={(slot) => { store.addRoute(slot, t, p); setSelParam(p) }}
        onModAmount={(delta) => {
          let idx = routeIndexFor(state, state.selectedMod, t, p)
          if (idx === -1) idx = state.routes.findIndex((r) => r !== null && r.track === t && r.param === p)
          const r = state.routes[idx]
          if (r) store.setRouteAmount(idx, r.amount + delta)
        }} />
    )
  }

  const routes = state.routes.flatMap((r, i) => (r && r.track === t && r.param === selParam ? [{ r, i }] : []))
  const active = state.modulators.flatMap((m, i) => (m.kind !== 0 ? [{ m, i }] : []))

  return (
    <aside aria-label="Machine" className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 p-2">
        <b className="text-acc">{track.name}</b>
        <span className="text-zinc-500">ANALOG BD</span>
      </div>
      <div role="tablist" className="flex border-b border-zinc-800">
        {KICK_PAGES.map((pg, i) => (
          <button key={pg.name} type="button" role="tab" aria-selected={page === i}
            onClick={() => { setPage(i); setSelParam(pg.params[0]) }}
            className={`flex-1 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${page === i ? 'text-acc shadow-[inset_0_-2px_0_var(--color-acc)]' : 'text-zinc-500'}`}>
            {pg.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-y-2 p-2">{KICK_PAGES[page].params.map(knob)}</div>
      <div className="flex flex-col gap-1 border-t border-zinc-800 p-2">
        <span className="text-[9px] tracking-wider text-zinc-500 uppercase">mod on {KICK_PARAMS[selParam].name}</span>
        {routes.length === 0 && <p className="text-zinc-500">húzz rá egy modulátort a gombra, vagy add hozzá itt</p>}
        {routes.map(({ r, i }) => {
          const name = modLabel(r.src, state.modulators[r.src])
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 text-mod">{name}</span>
              <input type="range" min={-100} max={100} value={Math.round(r.amount * 100)} aria-label={`${name} amount`}
                onChange={(e) => store.setRouteAmount(i, Number(e.target.value) / 100)} className="flex-1 accent-sky-400" />
              <span className="w-8 text-right tabular-nums">{Math.round(r.amount * 100)}</span>
              <button type="button" aria-label={`Remove ${name} route`} onClick={() => store.removeRoute(i)} className={btn}>×</button>
            </div>
          )
        })}
        <div className="flex items-center gap-2">
          <select aria-label="Modulator to add" value={addSrc} onChange={(e) => setAddSrc(Number(e.target.value))}
            className="rounded bg-zinc-900 px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-acc">
            {active.map(({ m, i }) => <option key={i} value={i}>{modLabel(i, m)}</option>)}
          </select>
          <button type="button" className={btn} onClick={() => store.addRoute(addSrc, t, selParam)}>+ route</button>
        </div>
      </div>
      <MacroFaders state={state} store={store} />
    </aside>
  )
}
```

`web/src/ui/SequencerMatrix.tsx`: in the `<section aria-label="Sequencer" …>` className, replace `flex min-h-0 flex-col` with `flex min-h-0 flex-1 flex-col`.

`web/src/App.tsx` (replace):
```tsx
import { useRef, useState, useSyncExternalStore } from 'react'
import { startEngine, type EngineHost } from '@/audio/host'
import { playheadOf, SNAP_TRACKS } from '@/audio/snapshot'
import { createStore } from '@/state/store'
import { MachinePanel } from '@/ui/MachinePanel'
import { ModStrip } from '@/ui/ModStrip'
import { SequencerMatrix } from '@/ui/SequencerMatrix'
import { TransportBar } from '@/ui/TransportBar'
import { useEngineFrame } from '@/ui/useEngineFrame'

const store = createStore()
const IDLE = Array<number>(SNAP_TRACKS).fill(-1)

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [host, setHost] = useState<EngineHost | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)
  const frame = useEngineFrame(host?.snapshot ?? null)
  const playheads = state.playing && frame ? Array.from({ length: SNAP_TRACKS }, (_, t) => playheadOf(frame, t)) : IDLE

  const togglePlay = async () => {
    if (state.playing) {
      store.stop()
      return
    }
    if (startingRef.current) return
    setError(null)
    try {
      if (!host) {
        startingRef.current = true
        setStarting(true)
        const h = await startEngine(setError)
        store.connect(h.send)
        setHost(h)
      }
      store.play()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr] bg-background font-mono text-xs text-foreground">
      <TransportBar bpm={state.bpm} playing={state.playing} starting={starting} error={error} onTogglePlay={togglePlay} onBpm={store.setBpm} />
      <main className="grid min-h-0 grid-cols-[1fr_440px]">
        <div className="flex min-h-0 flex-col">
          <SequencerMatrix state={state} playheads={playheads} onToggle={store.toggleStep} onSetLength={store.setLength}
            onSetSpeed={store.setSpeed} onSelect={store.select} />
          <div className="h-[190px] shrink-0">
            <ModStrip state={state} frame={frame} store={store} />
          </div>
        </div>
        <MachinePanel state={state} frame={frame} store={store} />
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Run every automated check**

Run: `source "$HOME/.cargo/env" && cargo test && cd web && source ~/.nvm/nvm.sh && npm run wasm && npm test && npx tsc --noEmit && npm run build`
Expected: Rust all green; all Vitest files pass (audio, state, ui); tsc reports no errors; the build succeeds. Delete `web/dist` afterwards.

- [ ] **Step 5: Preview smoke check** (no browser needed)

Run `npm run preview` in the background. Then `curl -sI http://localhost:4173/` shows COOP/COEP, and `curl -s http://localhost:4173/utero.wasm | wc -c` is greater than 0. Stop the server. The human does the real listening check at the end:
1. Drag LFO1 onto DECAY: the blue ring appears and the kick tail breathes.
2. Arm M1 B and turn DRIVE and TONE, disarm, then move the M1 fader: the sound morphs.
3. Remove the route: no click.

- [ ] **Step 6: Commit**

```bash
git add web/src/ui/MacroFaders.tsx web/src/ui/MacroFaders.test.tsx web/src/ui/MachinePanel.tsx web/src/ui/MachinePanel.test.tsx web/src/ui/SequencerMatrix.tsx web/src/App.tsx
git rm web/src/ui/usePlayheads.ts
git commit -m "feat(web): macro faders, route list and modulation layout

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

## Deliberately deferred (not gaps)

- ENV.F and SC.KICK modulator types, and modulation of buses, sends and master: plan 1c, together with the buses.
- ✎ DRAW shape, ★ favourite pinning, STEP mutate: plans 1d/1e.
- Persistence of modulators, routes and macros (IndexedDB): plan 1d.
- Coalescing of dropped ring commands: still very unlikely with 2048 slots. Revisit in 1d, when p-locks add traffic.
