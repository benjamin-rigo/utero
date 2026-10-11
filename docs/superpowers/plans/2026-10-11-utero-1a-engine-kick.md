# utero 1a: Engine, sequencer, KICK (first sound) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app where a Rust/WASM engine in an AudioWorklet plays a polymetric step sequence on two KICK tracks. The sequence supports probability, trig conditions and microtiming. A minimal UI offers a sequencer matrix, 8 knobs and transport.

**Architecture:** `crates/core` holds the platform-independent engine (transport, sequencer, kick DSP). `crates/wasm` exposes it through plain C-ABI exports, with no wasm-bindgen. The web app compiles the `.wasm` on the main thread and instantiates it inside an AudioWorklet. It sends commands through a SharedArrayBuffer ring and reads playheads from a shared snapshot buffer.

**Tech Stack:** Rust (stable, edition 2021, target `wasm32-unknown-unknown`), Node 24, Vite, React 19, TypeScript, Tailwind v4, shadcn/ui, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-11-utero-design.md](../specs/2026-10-11-utero-design.md). This is plan **1a of 5** for spec §13. It covers §2 (platform), §5 (architecture), §7 (sequencer: length/speed/playhead, probability, conditions, µtime) and §9 (KICK SRC page + LEVEL). Later plans: 1b modulation + macros, 1c SUB/MID + buses + sends + master, 1d full layout + edit modes + MIDI learn + persistence, 1e generators + random depth + mutate + FILL UI.

## Global Constraints

- Audio: 48 kHz, `latencyHint: "interactive"`, Web Audio block = 128 frames (spec §5).
- SharedArrayBuffer requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on dev and preview servers (spec §5).
- Realtime rules: no allocation, locks or I/O inside `Engine::process`. All voices and buffers are preallocated. Continuous params are smoothed (spec §5).
- Internal timing resolution: 96 PPQN (spec §5).
- Track length 1–64, speeds 1/32, 1/16, 1/8, 1/4, 1 bar, 1/16T, 1/8T (spec §7).
- Step: probability 0–100, conditions A:B, FILL, !FILL, PRE, !PRE, NEI, 1ST, µtime within ±½ step (spec §7).
- Random is seeded and reproducible (spec §7).
- Buses/tracks order: KICK, KCK2 · HH, OH · SNR, NOIS, SMPL · SUB, MID · LD1, LD2 · PAD · ORN (spec §2).
- UI: dark mode by default, shadcn/ui + Tailwind, everything operable by mouse and keyboard, accessible labels and focus rings (spec §4, user CLAUDE.md).
- Commits: conventional messages. Stage specific files, never `git add .`. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A track is shortened while playing** (e.g. 16 → 4 at step 10). The playhead must wrap inside the new length, with no out-of-bounds access and no stuck track. Covered by Task 4, test `shorter_length_wraps_playhead`.
2. **The UI sends an out-of-range index** (track 99, step 200, param 50, NaN value). The engine must ignore it silently. A Rust panic in WASM traps the worklet, and the show goes silent. Covered by Task 7, test `out_of_range_commands_are_ignored`.
3. **Fast knob drags flood the command ring.** `push` must return false when full, never overwrite unread commands, and keep FIFO order after wraparound. Covered by Task 9, tests in `ring.test.ts`.
4. **The app is served without COOP/COEP headers.** The user must see a clear error message, not a silent page. Covered by Task 9, `isolation.test.ts`, plus the error display in Task 10.
5. **BPM extremes or garbage typed in the field** (0, 1000, empty → NaN). Values are clamped to 20–300 and NaN is ignored, in both the engine and the store. Covered by Task 3 `bpm_is_clamped_and_nan_ignored` and Task 10 `setBpm clamps and ignores NaN`.

---

## File Structure

```
Cargo.toml                         Rust workspace + release profile
crates/core/Cargo.toml
crates/core/src/lib.rs             module list
crates/core/src/rng.rs             seeded xorshift RNG
crates/core/src/dsp.rs             Smoother, Drive2x, one_pole_coef
crates/core/src/params.rs          ParamDesc (range + curve mapping)
crates/core/src/transport.rs       sample-accurate 96 PPQN clock
crates/core/src/seq.rs             Step, Cond, Track (polymeter, µtime, conditions)
crates/core/src/kick.rs            KICK params + KickVoice DSP
crates/core/src/engine.rs          Engine: tracks + voices + command API + process
crates/core/tests/render.rs        offline WAV render + realtime benchmark
crates/wasm/Cargo.toml
crates/wasm/src/lib.rs             C-ABI exports over a single global Engine
scripts/build-wasm.sh              build + copy to web/public/utero.wasm
web/package.json, index.html, vite.config.ts, tsconfig.json, components.json
web/src/main.tsx, App.tsx, index.css
web/src/state/types.ts             StepState, TrackState, AppState, CondCode
web/src/state/kickParams.ts        UI mirror of KICK param names/defaults
web/src/state/store.ts             app store + actions → commands
web/src/audio/ops.ts               opcodes + command builders
web/src/audio/exports.ts           TS types of the wasm exports
web/src/audio/ring.ts              SPSC SharedArrayBuffer command ring
web/src/audio/dispatch.ts          command → wasm export call
web/src/audio/snapshot.ts          snapshot layout
web/src/audio/isolation.ts         crossOriginIsolated guard
web/src/audio/worklet-env.d.ts     AudioWorklet global types
web/src/audio/worklet.ts           AudioWorkletProcessor
web/src/audio/host.ts              startEngine()
web/src/ui/Knob.tsx, SequencerMatrix.tsx, MachinePanel.tsx, TransportBar.tsx, usePlayheads.ts
```

---

### Task 1: Toolchain, workspace scaffold, seeded RNG

**Files:**
- Create: `Cargo.toml`, `crates/core/Cargo.toml`, `crates/core/src/lib.rs`, `crates/core/src/rng.rs`
- Create: `crates/wasm/Cargo.toml`, `crates/wasm/src/lib.rs`
- Create: `web/package.json`, `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/index.css`, `web/src/sanity.test.ts`

**Interfaces:**
- Produces: `utero_core::rng::Rng` with `Rng::new(seed: u32) -> Rng`, `next_u32(&mut self) -> u32`, `next_f32(&mut self) -> f32` (in [0,1)), `bipolar(&mut self) -> f32` (in [-1,1)). `Rng` is `Clone + Copy`.

- [ ] **Step 1: Install the Rust toolchain.** Ask the user first, because this installs software into `~/.cargo` and `~/.rustup`.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown
rustc --version && cargo --version
```
Expected: versions print. `rustup target list --installed` includes `wasm32-unknown-unknown`.

- [ ] **Step 2: Create the Rust workspace**

`Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["crates/core", "crates/wasm"]

[workspace.package]
version = "0.1.0"
edition = "2021"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
```

`crates/core/Cargo.toml`:
```toml
[package]
name = "utero-core"
version.workspace = true
edition.workspace = true

[lib]
name = "utero_core"
```

`crates/wasm/Cargo.toml`:
```toml
[package]
name = "utero-wasm"
version.workspace = true
edition.workspace = true

[lib]
crate-type = ["cdylib"]

[dependencies]
utero-core = { path = "../core" }
```

`crates/wasm/src/lib.rs` (filled in Task 8):
```rust
// C-ABI exports are added in Task 8.
```

`crates/core/src/lib.rs`:
```rust
pub mod rng;
```

- [ ] **Step 3: Write the failing RNG tests** in `crates/core/src/rng.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_gives_same_sequence() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..100 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }

    #[test]
    fn zero_seed_is_not_stuck() {
        let mut r = Rng::new(0);
        assert_ne!(r.next_u32(), 0);
        assert_ne!(r.next_u32(), r.next_u32());
    }

    #[test]
    fn floats_stay_in_range() {
        let mut r = Rng::new(7);
        for _ in 0..10_000 {
            let f = r.next_f32();
            assert!((0.0..1.0).contains(&f));
            let b = r.bipolar();
            assert!((-1.0..1.0).contains(&b));
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cargo test -p utero-core rng`
Expected: compile error `cannot find type Rng`.

- [ ] **Step 5: Implement the RNG** at the top of `crates/core/src/rng.rs`

```rust
/// xorshift32: tiny, allocation-free, reproducible from a seed.
#[derive(Clone, Copy, Debug)]
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(if seed == 0 { 0x9E37_79B9 } else { seed })
    }

    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    pub fn next_f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / 16_777_216.0
    }

    pub fn bipolar(&mut self) -> f32 {
        self.next_f32() * 2.0 - 1.0
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p utero-core rng`
Expected: 3 passed.

- [ ] **Step 7: Scaffold the web app by hand** (no interactive generators)

`web/package.json`:
```json
{
  "name": "utero-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "wasm": "bash ../scripts/build-wasm.sh"
  }
}
```

Then install:
```bash
cd web
npm install react react-dom
npm install -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/node tailwindcss @tailwindcss/vite vitest
```

`web/index.html`:
```html
<!doctype html>
<html lang="hu" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>utero</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { headers: isolation },
  preview: { headers: isolation },
  test: { environment: 'node' },
})
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client", "node"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "vite.config.ts"]
}
```

`web/src/index.css`:
```css
@import "tailwindcss";
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`web/src/App.tsx` (replaced in Task 10):
```tsx
export default function App() {
  return <div className="h-dvh bg-background p-4 font-mono text-foreground">utero</div>
}
```

`web/src/sanity.test.ts`:
```ts
import { expect, test } from 'vitest'

test('SharedArrayBuffer and Atomics exist in the test runtime', () => {
  const h = new Int32Array(new SharedArrayBuffer(8))
  Atomics.store(h, 0, 5)
  expect(Atomics.load(h, 0)).toBe(5)
})
```

- [ ] **Step 8: Initialise shadcn/ui** with the zinc base colour, then add our two accent tokens

```bash
cd web
npx shadcn@latest init --yes --base-color zinc
npx shadcn@latest add button --yes
```
If the CLI rejects `--base-color`, run `npx shadcn@latest init --yes --defaults` and set `"baseColor": "zinc"` in `web/components.json`. Then append to the end of `web/src/index.css`:
```css
@theme {
  --color-acc: #f59e0b;
  --color-mod: #38bdf8;
}
```

- [ ] **Step 9: Verify that everything builds and tests run**

Run: `cargo test -p utero-core && (cd web && npm test && npx tsc --noEmit)`
Expected: Rust 3 passed, Vitest 1 passed, tsc reports no errors.
Run: `cd web && npm run dev`, open the printed URL, then in DevTools run `crossOriginIsolated`.
Expected: the page shows "utero" on a dark background and `crossOriginIsolated` is `true`. Stop the server.

- [ ] **Step 10: Commit**

```bash
git add Cargo.toml crates/core/Cargo.toml crates/core/src/lib.rs crates/core/src/rng.rs crates/wasm/Cargo.toml crates/wasm/src/lib.rs web/package.json web/package-lock.json web/index.html web/vite.config.ts web/tsconfig.json web/components.json web/src/main.tsx web/src/App.tsx web/src/index.css web/src/sanity.test.ts web/src/lib/utils.ts web/src/components/ui/button.tsx
git commit -m "chore: scaffold rust workspace and web app with seeded rng

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(If shadcn placed files elsewhere, run `git status` and stage those exact paths instead.)

---

### Task 2: DSP primitives (Smoother, Drive2x) and ParamDesc

**Files:**
- Create: `crates/core/src/dsp.rs`, `crates/core/src/params.rs`
- Modify: `crates/core/src/lib.rs`

**Interfaces:**
- Produces:
  - `dsp::Smoother::new(value: f32, time_ms: f32, sample_rate: f32)`, with `.set(target: f32)`, `.next() -> f32` and `.value() -> f32`
  - `dsp::Drive2x::new()` and `.process(x: f32, amount: f32) -> f32` (amount 0..1; 0 = bypass)
  - `dsp::one_pole_coef(cutoff_hz: f32, sample_rate: f32) -> f32`
  - `params::Curve { Lin, Exp }`
  - `params::ParamDesc { name: &'static str, min: f32, max: f32, default_norm: f32, curve: Curve }` with `.map(norm: f32) -> f32`

- [ ] **Step 1: Write the failing tests**

`crates/core/src/dsp.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoother_glides_to_target_without_jumping() {
        let mut s = Smoother::new(0.0, 10.0, 48_000.0);
        s.set(1.0);
        let first = s.next();
        assert!(first > 0.0 && first < 0.05, "first step {first}");
        for _ in 0..48_000 {
            s.next();
        }
        assert!((s.value() - 1.0).abs() < 1e-4);
    }

    #[test]
    fn smoother_with_zero_time_is_instant() {
        let mut s = Smoother::new(0.0, 0.0, 48_000.0);
        s.set(0.7);
        assert_eq!(s.next(), 0.7);
    }

    #[test]
    fn drive_zero_is_bypass() {
        let mut d = Drive2x::new();
        for x in [-0.9_f32, -0.1, 0.0, 0.3, 1.5] {
            assert_eq!(d.process(x, 0.0), x);
        }
    }

    #[test]
    fn drive_is_bounded_and_keeps_sign() {
        let mut d = Drive2x::new();
        for i in -100..=100 {
            let x = i as f32 / 10.0;
            let y = d.process(x, 1.0);
            assert!(y.abs() <= 1.0 + 1e-6, "x {x} y {y}");
            d = Drive2x::new();
            let y2 = d.process(x, 1.0);
            assert!(x == 0.0 || y2.signum() == x.signum());
        }
    }

    #[test]
    fn one_pole_coef_is_in_unit_range() {
        for fc in [20.0, 200.0, 2_000.0, 20_000.0] {
            let c = one_pole_coef(fc, 48_000.0);
            assert!(c > 0.0 && c <= 1.0);
        }
    }
}
```

`crates/core/src/params.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_maps_ends_and_middle() {
        let p = ParamDesc { name: "X", min: 0.0, max: 48.0, default_norm: 0.5, curve: Curve::Lin };
        assert_eq!(p.map(0.0), 0.0);
        assert_eq!(p.map(1.0), 48.0);
        assert_eq!(p.map(0.5), 24.0);
    }

    #[test]
    fn exponential_maps_geometric_middle() {
        let p = ParamDesc { name: "F", min: 30.0, max: 120.0, default_norm: 0.5, curve: Curve::Exp };
        assert!((p.map(0.5) - 60.0).abs() < 1e-3);
    }

    #[test]
    fn out_of_range_norm_is_clamped() {
        let p = ParamDesc { name: "X", min: 1.0, max: 2.0, default_norm: 0.0, curve: Curve::Lin };
        assert_eq!(p.map(-3.0), 1.0);
        assert_eq!(p.map(9.0), 2.0);
    }
}
```

`crates/core/src/lib.rs`:
```rust
pub mod dsp;
pub mod params;
pub mod rng;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p utero-core`
Expected: compile errors (`Smoother`, `ParamDesc` not found).

- [ ] **Step 3: Implement.** Put the code above the test modules.

`crates/core/src/dsp.rs`:
```rust
use core::f32::consts::TAU;

/// One-pole parameter smoother: avoids zipper noise on continuous params.
#[derive(Clone, Copy, Debug)]
pub struct Smoother {
    cur: f32,
    target: f32,
    coef: f32,
}

impl Smoother {
    pub fn new(value: f32, time_ms: f32, sample_rate: f32) -> Self {
        let coef = if time_ms <= 0.0 {
            1.0
        } else {
            1.0 - (-1.0 / (time_ms * 0.001 * sample_rate)).exp()
        };
        Smoother { cur: value, target: value, coef }
    }

    pub fn set(&mut self, target: f32) {
        self.target = target;
    }

    pub fn next(&mut self) -> f32 {
        self.cur += (self.target - self.cur) * self.coef;
        self.cur
    }

    pub fn value(&self) -> f32 {
        self.cur
    }
}

/// tanh drive at 2x rate (linear-interpolated midpoint, boxcar decimation) to keep aliasing down.
#[derive(Clone, Copy, Debug, Default)]
pub struct Drive2x {
    prev: f32,
}

impl Drive2x {
    pub fn new() -> Self {
        Drive2x { prev: 0.0 }
    }

    pub fn process(&mut self, x: f32, amount: f32) -> f32 {
        let mid = 0.5 * (self.prev + x);
        self.prev = x;
        if amount <= 0.0 {
            return x;
        }
        let g = 1.0 + amount.min(1.0) * 15.0;
        let norm = g.tanh();
        0.5 * ((mid * g).tanh() + (x * g).tanh()) / norm
    }
}

pub fn one_pole_coef(cutoff_hz: f32, sample_rate: f32) -> f32 {
    (1.0 - (-TAU * cutoff_hz / sample_rate).exp()).clamp(1e-6, 1.0)
}
```

`crates/core/src/params.rs`:
```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Curve {
    Lin,
    Exp,
}

/// UI sends normalised 0..1 values; the engine maps them to real units here.
#[derive(Clone, Copy, Debug)]
pub struct ParamDesc {
    pub name: &'static str,
    pub min: f32,
    pub max: f32,
    pub default_norm: f32,
    pub curve: Curve,
}

impl ParamDesc {
    pub fn map(&self, norm: f32) -> f32 {
        let n = norm.clamp(0.0, 1.0);
        match self.curve {
            Curve::Lin => self.min + (self.max - self.min) * n,
            Curve::Exp => self.min * (self.max / self.min).powf(n),
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p utero-core`
Expected: all pass (11 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/dsp.rs crates/core/src/params.rs
git commit -m "feat(core): add smoother, 2x drive and param mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sample-accurate transport (96 PPQN)

**Files:**
- Create: `crates/core/src/transport.rs`
- Modify: `crates/core/src/lib.rs` (add `pub mod transport;`)

**Interfaces:**
- Produces:
  - `transport::PPQN: u64 = 96`
  - `Transport::new(sample_rate: f32)`, defaulting to 120 BPM and stopped
  - `.set_bpm(bpm: f64)` (clamped 20–300, NaN ignored), `.bpm() -> f64`
  - `.play()` (resets to tick 0), `.stop()`, `.is_playing() -> bool`
  - `.tick() -> Option<u64>`: call once per sample; returns the tick index that starts on this sample
  - `.ticks() -> u64`: number of ticks fired since play

- [ ] **Step 1: Write the failing tests** in `crates/core/src/transport.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn fired_samples(t: &mut Transport, samples: usize) -> Vec<(usize, u64)> {
        (0..samples).filter_map(|i| t.tick().map(|k| (i, k))).collect()
    }

    #[test]
    fn first_tick_fires_on_first_sample() {
        let mut t = Transport::new(48_000.0);
        t.play();
        assert_eq!(t.tick(), Some(0));
    }

    #[test]
    fn ticks_are_spaced_by_samples_per_tick() {
        let mut t = Transport::new(48_000.0);
        t.set_bpm(120.0); // 48000*60/(120*96) = 250 samples per tick
        t.play();
        assert_eq!(fired_samples(&mut t, 1000), vec![(0, 0), (250, 1), (500, 2), (750, 3)]);
        assert_eq!(t.ticks(), 4);
    }

    #[test]
    fn stopped_transport_never_ticks() {
        let mut t = Transport::new(48_000.0);
        assert!(fired_samples(&mut t, 1000).is_empty());
        t.play();
        t.stop();
        assert!(fired_samples(&mut t, 1000).is_empty());
    }

    #[test]
    fn play_restarts_from_zero() {
        let mut t = Transport::new(48_000.0);
        t.play();
        fired_samples(&mut t, 2000);
        t.play();
        assert_eq!(t.tick(), Some(0));
    }

    #[test]
    fn bpm_is_clamped_and_nan_ignored() {
        let mut t = Transport::new(48_000.0);
        t.set_bpm(5.0);
        assert_eq!(t.bpm(), 20.0);
        t.set_bpm(1000.0);
        assert_eq!(t.bpm(), 300.0);
        t.set_bpm(128.0);
        t.set_bpm(f64::NAN);
        assert_eq!(t.bpm(), 128.0);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p utero-core transport`
Expected: compile error `cannot find type Transport`.

- [ ] **Step 3: Implement** (above the tests)

```rust
pub const PPQN: u64 = 96;

#[derive(Clone, Copy, Debug)]
pub struct Transport {
    sample_rate: f64,
    bpm: f64,
    playing: bool,
    pos: u64,
    next_at: f64,
    ticks: u64,
}

impl Transport {
    pub fn new(sample_rate: f32) -> Self {
        Transport { sample_rate: sample_rate as f64, bpm: 120.0, playing: false, pos: 0, next_at: 0.0, ticks: 0 }
    }

    pub fn set_bpm(&mut self, bpm: f64) {
        if bpm.is_finite() {
            self.bpm = bpm.clamp(20.0, 300.0);
        }
    }

    pub fn bpm(&self) -> f64 {
        self.bpm
    }

    pub fn play(&mut self) {
        self.playing = true;
        self.pos = 0;
        self.next_at = 0.0;
        self.ticks = 0;
    }

    pub fn stop(&mut self) {
        self.playing = false;
    }

    pub fn is_playing(&self) -> bool {
        self.playing
    }

    pub fn ticks(&self) -> u64 {
        self.ticks
    }

    fn samples_per_tick(&self) -> f64 {
        self.sample_rate * 60.0 / (self.bpm * PPQN as f64)
    }

    pub fn tick(&mut self) -> Option<u64> {
        if !self.playing {
            return None;
        }
        let fired = if self.pos as f64 >= self.next_at {
            let t = self.ticks;
            self.ticks += 1;
            self.next_at += self.samples_per_tick();
            Some(t)
        } else {
            None
        };
        self.pos += 1;
        fired
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p utero-core transport`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/transport.rs
git commit -m "feat(core): add sample-accurate 96 ppqn transport

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sequencer track: polymeter, speed, µtime, playhead

**Files:**
- Create: `crates/core/src/seq.rs`
- Modify: `crates/core/src/lib.rs` (add `pub mod seq;`)

**Interfaces:**
- Consumes: `rng::Rng`.
- Produces:
  - `seq::MAX_STEPS: usize = 64`
  - `Cond { None, Ab { a: u8, b: u8 }, Fill, NotFill, Pre, NotPre, Nei, First }` and `Cond::from_code(code: u8, a: u8, b: u8) -> Cond`, with codes 0 None, 1 Ab, 2 Fill, 3 NotFill, 4 Pre, 5 NotPre, 6 Nei, 7 First
  - `Step { trig: bool, vel: f32, prob: u8, cond: Cond, micro: i8 }`, `Default` = off, vel 1, prob 100, None, micro 0. `micro` is in 1/24 of a step and clamped to −11..=11.
  - `CondCtx<'a> { fill: bool, neighbor: bool, rng: &'a mut Rng }`
  - `speed_ticks(code: u8) -> u64`: 0→12 (1/32), 1→24 (1/16), 2→48 (1/8), 3→96 (1/4), 4→384 (1 bar), 5→16 (1/16T), 6→32 (1/8T), other→24
  - `Track::new()`, with `.set_step(i: usize, step: Step)`, `.set_length(len: u8)`, `.set_speed(code: u8)`, `.length() -> u8`, `.playhead() -> u16`, `.last_cond() -> bool`, `.reset()` and `.on_tick(tick: u64, ctx: &mut CondCtx) -> Option<f32>` (returns the trig velocity)

In this task `evaluate` only supports `Cond::None` with prob 100. Task 5 replaces it with the full version.

- [ ] **Step 1: Write the failing tests** in `crates/core/src/seq.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn trig() -> Step {
        Step { trig: true, ..Step::default() }
    }

    pub(crate) fn run(track: &mut Track, ticks: u64, fill: bool, neighbor: bool, rng: &mut Rng) -> Vec<u64> {
        (0..ticks)
            .filter(|&t| {
                let mut ctx = CondCtx { fill, neighbor, rng };
                track.on_tick(t, &mut ctx).is_some()
            })
            .collect()
    }

    #[test]
    fn four_on_the_floor_fires_every_quarter() {
        let mut t = Track::new();
        for s in [0, 4, 8, 12] {
            t.set_step(s, trig());
        }
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 384, false, false, &mut rng), vec![0, 96, 192, 288]);
    }

    #[test]
    fn polymeter_length_three_wraps() {
        let mut t = Track::new();
        t.set_length(3);
        t.set_step(0, trig());
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 24 * 9, false, false, &mut rng), vec![0, 72, 144]);
    }

    #[test]
    fn eighth_speed_doubles_step_duration() {
        let mut t = Track::new();
        t.set_speed(2);
        t.set_step(1, trig());
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 100, false, false, &mut rng), vec![48]);
    }

    #[test]
    fn positive_microtime_delays_trig() {
        let mut t = Track::new();
        t.set_step(0, Step { micro: 6, ..trig() });
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 24, false, false, &mut rng), vec![6]);
    }

    #[test]
    fn negative_microtime_pulls_trig_early() {
        let mut t = Track::new();
        t.set_step(1, Step { micro: -6, ..trig() });
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 48, false, false, &mut rng), vec![18]);
    }

    #[test]
    fn microtime_is_clamped_below_half_a_step() {
        let mut t = Track::new();
        t.set_step(0, Step { micro: 100, ..trig() });
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut t, 24, false, false, &mut rng), vec![11]);
    }

    #[test]
    fn playhead_follows_steps() {
        let mut t = Track::new();
        let mut rng = Rng::new(1);
        run(&mut t, 24 * 5 + 1, false, false, &mut rng);
        assert_eq!(t.playhead(), 5);
    }

    #[test]
    fn shorter_length_wraps_playhead() {
        let mut t = Track::new();
        let mut rng = Rng::new(1);
        run(&mut t, 24 * 10 + 1, false, false, &mut rng);
        assert_eq!(t.playhead(), 10);
        t.set_length(4);
        assert!(t.playhead() < 4);
        let mut ctx = CondCtx { fill: false, neighbor: false, rng: &mut rng };
        t.on_tick(24 * 11, &mut ctx);
        assert_eq!(t.playhead(), 3);
    }

    #[test]
    fn length_is_clamped_and_bad_step_index_ignored() {
        let mut t = Track::new();
        t.set_length(0);
        assert_eq!(t.length(), 1);
        t.set_length(200);
        assert_eq!(t.length(), 64);
        t.set_step(500, trig());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p utero-core seq`
Expected: compile errors (`Track`, `Step` not found).

- [ ] **Step 3: Implement** (above the tests)

```rust
use crate::rng::Rng;

pub const MAX_STEPS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cond {
    None,
    Ab { a: u8, b: u8 },
    Fill,
    NotFill,
    Pre,
    NotPre,
    Nei,
    First,
}

impl Cond {
    /// Codes mirror `CondCode` in web/src/state/types.ts.
    pub fn from_code(code: u8, a: u8, b: u8) -> Cond {
        match code {
            1 => Cond::Ab { a, b },
            2 => Cond::Fill,
            3 => Cond::NotFill,
            4 => Cond::Pre,
            5 => Cond::NotPre,
            6 => Cond::Nei,
            7 => Cond::First,
            _ => Cond::None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Step {
    pub trig: bool,
    pub vel: f32,
    pub prob: u8,
    pub cond: Cond,
    /// Offset in 1/24 of a step.
    pub micro: i8,
}

impl Default for Step {
    fn default() -> Self {
        Step { trig: false, vel: 1.0, prob: 100, cond: Cond::None, micro: 0 }
    }
}

pub struct CondCtx<'a> {
    pub fill: bool,
    pub neighbor: bool,
    pub rng: &'a mut Rng,
}

pub fn speed_ticks(code: u8) -> u64 {
    match code {
        0 => 12,
        1 => 24,
        2 => 48,
        3 => 96,
        4 => 384,
        5 => 16,
        6 => 32,
        _ => 24,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Track {
    steps: [Step; MAX_STEPS],
    length: u8,
    speed: u8,
    playhead: u16,
    last_cond: bool,
}

impl Default for Track {
    fn default() -> Self {
        Self::new()
    }
}

impl Track {
    pub fn new() -> Self {
        Track { steps: [Step::default(); MAX_STEPS], length: 16, speed: 1, playhead: 0, last_cond: false }
    }

    pub fn set_step(&mut self, i: usize, step: Step) {
        if let Some(s) = self.steps.get_mut(i) {
            *s = Step {
                micro: step.micro.clamp(-11, 11),
                prob: step.prob.min(100),
                vel: if step.vel.is_finite() { step.vel.clamp(0.0, 1.0) } else { 1.0 },
                ..step
            };
        }
    }

    pub fn set_length(&mut self, len: u8) {
        self.length = len.clamp(1, MAX_STEPS as u8);
        self.playhead %= self.length as u16;
    }

    pub fn set_speed(&mut self, code: u8) {
        self.speed = code;
    }

    pub fn length(&self) -> u8 {
        self.length
    }

    pub fn playhead(&self) -> u16 {
        self.playhead
    }

    pub fn last_cond(&self) -> bool {
        self.last_cond
    }

    pub fn reset(&mut self) {
        self.playhead = 0;
        self.last_cond = false;
    }

    /// Stateless position (tick / step_ticks) makes polymeter and length changes safe.
    pub fn on_tick(&mut self, tick: u64, ctx: &mut CondCtx) -> Option<f32> {
        let st = speed_ticks(self.speed);
        let len = self.length as u64;
        let abs_step = tick / st;
        if tick % st == 0 {
            self.playhead = (abs_step % len) as u16;
        }
        // A step with negative µtime fires inside the previous step's window.
        for cand in [abs_step, abs_step + 1] {
            let step = self.steps[(cand % len) as usize];
            if !step.trig {
                continue;
            }
            let at = (cand * st) as i64 + (step.micro as i64 * st as i64) / 24;
            if at == tick as i64 && self.evaluate(&step, cand / len, ctx) {
                return Some(step.vel);
            }
        }
        None
    }

    fn evaluate(&mut self, _step: &Step, _iteration: u64, _ctx: &mut CondCtx) -> bool {
        true
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p utero-core seq`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/seq.rs
git commit -m "feat(core): add polymetric sequencer track with microtiming

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Probability and trig conditions

**Files:**
- Modify: `crates/core/src/seq.rs` (replace `evaluate`, add tests)

**Interfaces:**
- Consumes: Task 4 `Track`, `Step`, `Cond`, `CondCtx`, test helpers `trig()` and `run()`.
- Produces semantics that later tasks rely on:
  - A step is *conditional* if `cond != None` or `prob < 100`.
  - Conditional steps update `last_cond`, except PRE, !PRE and NEI, which only read it.
  - A:B is true when `iteration % b == (a-1) % b`.
  - 1ST is true on iteration 0 after play.
  - NEI reads `ctx.neighbor`, which is the previous track's `last_cond`.
  - The probability roll uses `ctx.rng` only when the step is due.

- [ ] **Step 1: Write the failing tests.** Append inside `mod tests` in `seq.rs`.

```rust
    fn one_step(cond: Cond, prob: u8) -> Track {
        let mut t = Track::new();
        t.set_length(1);
        t.set_step(0, Step { cond, prob, ..trig() });
        t
    }

    #[test]
    fn prob_zero_never_and_hundred_always_fires() {
        let mut rng = Rng::new(42);
        assert!(run(&mut one_step(Cond::None, 0), 24 * 100, false, false, &mut rng).is_empty());
        assert_eq!(run(&mut one_step(Cond::None, 100), 24 * 100, false, false, &mut rng).len(), 100);
    }

    #[test]
    fn prob_fifty_fires_about_half_the_time() {
        let mut rng = Rng::new(42);
        let n = run(&mut one_step(Cond::None, 50), 24 * 1000, false, false, &mut rng).len();
        assert!((400..=600).contains(&n), "fired {n} of 1000");
    }

    #[test]
    fn same_seed_reproduces_probability_pattern() {
        let a = run(&mut one_step(Cond::None, 50), 24 * 64, false, false, &mut Rng::new(9));
        let b = run(&mut one_step(Cond::None, 50), 24 * 64, false, false, &mut Rng::new(9));
        assert_eq!(a, b);
    }

    #[test]
    fn ab_one_of_two_fires_on_even_iterations() {
        let mut rng = Rng::new(1);
        let fired = run(&mut one_step(Cond::Ab { a: 1, b: 2 }, 100), 24 * 6, false, false, &mut rng);
        assert_eq!(fired, vec![0, 48, 96]);
    }

    #[test]
    fn ab_with_zero_b_never_fires() {
        let mut rng = Rng::new(1);
        assert!(run(&mut one_step(Cond::Ab { a: 1, b: 0 }, 100), 24 * 4, false, false, &mut rng).is_empty());
    }

    #[test]
    fn fill_and_not_fill_follow_fill_flag() {
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut one_step(Cond::Fill, 100), 24 * 2, true, false, &mut rng).len(), 2);
        assert!(run(&mut one_step(Cond::Fill, 100), 24 * 2, false, false, &mut rng).is_empty());
        assert!(run(&mut one_step(Cond::NotFill, 100), 24 * 2, true, false, &mut rng).is_empty());
        assert_eq!(run(&mut one_step(Cond::NotFill, 100), 24 * 2, false, false, &mut rng).len(), 2);
    }

    #[test]
    fn pre_follows_previous_conditional_result() {
        let mut rng = Rng::new(1);
        let mut t = Track::new();
        t.set_length(3);
        t.set_step(0, Step { prob: 0, ..trig() });
        t.set_step(1, Step { cond: Cond::Pre, ..trig() });
        t.set_step(2, Step { cond: Cond::NotPre, ..trig() });
        assert_eq!(run(&mut t, 72, false, false, &mut rng), vec![48]);

        let mut t = Track::new();
        t.set_length(2);
        t.set_step(0, Step { cond: Cond::Fill, ..trig() });
        t.set_step(1, Step { cond: Cond::Pre, ..trig() });
        assert_eq!(run(&mut t, 48, true, false, &mut rng), vec![0, 24]);
    }

    #[test]
    fn nei_reads_neighbor_flag() {
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut one_step(Cond::Nei, 100), 24, false, true, &mut rng), vec![0]);
        assert!(run(&mut one_step(Cond::Nei, 100), 24, false, false, &mut rng).is_empty());
    }

    #[test]
    fn first_fires_only_on_first_iteration() {
        let mut rng = Rng::new(1);
        assert_eq!(run(&mut one_step(Cond::First, 100), 24 * 4, false, false, &mut rng), vec![0]);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p utero-core seq`
Expected: FAIL. `prob_zero_never…`, `ab_…`, `fill_…`, `pre_…`, `nei_…` and `first_…` fail, because the stub always returns true.

- [ ] **Step 3: Replace the `evaluate` stub** in `impl Track`

```rust
    fn evaluate(&mut self, step: &Step, iteration: u64, ctx: &mut CondCtx) -> bool {
        let cond_ok = match step.cond {
            Cond::None => true,
            Cond::Ab { a, b } => b > 0 && iteration % b as u64 == (a.saturating_sub(1) % b) as u64,
            Cond::Fill => ctx.fill,
            Cond::NotFill => !ctx.fill,
            Cond::Pre => self.last_cond,
            Cond::NotPre => !self.last_cond,
            Cond::Nei => ctx.neighbor,
            Cond::First => iteration == 0,
        };
        let prob_ok = step.prob >= 100 || ctx.rng.next_f32() * 100.0 < step.prob as f32;
        let result = cond_ok && prob_ok;
        let conditional = step.cond != Cond::None || step.prob < 100;
        if conditional && !matches!(step.cond, Cond::Pre | Cond::NotPre | Cond::Nei) {
            self.last_cond = result;
        }
        result
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p utero-core seq`
Expected: 18 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/seq.rs
git commit -m "feat(core): add probability and elektron-style trig conditions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: KICK machine (SRC page + LEVEL)

**Files:**
- Create: `crates/core/src/kick.rs`
- Modify: `crates/core/src/lib.rs` (add `pub mod kick;`)

**Interfaces:**
- Consumes: `dsp::{Smoother, Drive2x, one_pole_coef}`, `params::{ParamDesc, Curve}`, `rng::Rng`.
- Produces:
  - `kick::KICK_PARAM_COUNT: usize = 9` and `kick::KICK_PARAMS: [ParamDesc; 9]`
  - Index consts `TUNE=0, SWEEP=1, STIME=2, DECAY=3, CLICK=4, DRIVE=5, NOISE=6, TONE=7, LEVEL=8`
  - Defaults (norm): `0.2925, 0.5, 0.508, 0.5637, 0.3, 0.2, 0.05, 0.8, 0.8`. **These must match `web/src/state/kickParams.ts` (Task 10).**
  - `KickParams::new(sample_rate: f32)`, with `.set_norm(i: usize, norm: f32)` (bad index ignored), `.advance()` (one smoothing step per sample) and `.get(i: usize) -> f32` (mapped, smoothed value)
  - `KickVoice::new(sample_rate: f32, seed: u32)`, with `.trigger(vel: f32, rng: &mut Rng)`, `.render(&mut self, p: &KickParams) -> f32` and `.is_active() -> bool`

- [ ] **Step 1: Write the failing tests** in `crates/core/src/kick.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn render(v: &mut KickVoice, p: &mut KickParams, n: usize) -> Vec<f32> {
        (0..n)
            .map(|_| {
                p.advance();
                v.render(p)
            })
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn default_tune_is_about_45_hz() {
        let p = KickParams::new(SR);
        assert!((p.get(TUNE) - 45.0).abs() < 0.5, "{}", p.get(TUNE));
    }

    #[test]
    fn silent_until_triggered() {
        let mut v = KickVoice::new(SR, 1);
        let mut p = KickParams::new(SR);
        assert!(render(&mut v, &mut p, 100).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn trigger_produces_decaying_sound() {
        let mut v = KickVoice::new(SR, 1);
        let mut p = KickParams::new(SR);
        v.trigger(1.0, &mut Rng::new(3));
        let out = render(&mut v, &mut p, 48_000);
        let head = &out[..4_800];
        let tail = &out[43_200..];
        assert!(head.iter().fold(0.0_f32, |m, s| m.max(s.abs())) > 0.3);
        assert!(rms(tail) < rms(head) / 10.0);
    }

    #[test]
    fn voice_deactivates_after_decay() {
        let mut v = KickVoice::new(SR, 1);
        let mut p = KickParams::new(SR);
        v.trigger(1.0, &mut Rng::new(3));
        render(&mut v, &mut p, 3 * 48_000);
        assert!(!v.is_active());
    }

    #[test]
    fn extreme_params_stay_finite() {
        for norm in [0.0_f32, 1.0] {
            let mut p = KickParams::new(SR);
            for i in 0..KICK_PARAM_COUNT {
                p.set_norm(i, norm);
            }
            let mut v = KickVoice::new(SR, 5);
            v.trigger(1.0, &mut Rng::new(3));
            assert!(render(&mut v, &mut p, 48_000).iter().all(|s| s.is_finite()));
        }
    }

    #[test]
    fn bad_param_index_is_ignored() {
        let mut p = KickParams::new(SR);
        p.set_norm(99, 0.5);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p utero-core kick`
Expected: compile errors (`KickVoice` not found).

- [ ] **Step 3: Implement** (above the tests)

```rust
use core::f32::consts::TAU;

use crate::dsp::{one_pole_coef, Drive2x, Smoother};
use crate::params::{Curve, ParamDesc};
use crate::rng::Rng;

pub const TUNE: usize = 0;
pub const SWEEP: usize = 1;
pub const STIME: usize = 2;
pub const DECAY: usize = 3;
pub const CLICK: usize = 4;
pub const DRIVE: usize = 5;
pub const NOISE: usize = 6;
pub const TONE: usize = 7;
pub const LEVEL: usize = 8;
pub const KICK_PARAM_COUNT: usize = 9;

/// Order and default_norm are mirrored in web/src/state/kickParams.ts.
pub const KICK_PARAMS: [ParamDesc; KICK_PARAM_COUNT] = [
    ParamDesc { name: "TUNE", min: 30.0, max: 120.0, default_norm: 0.2925, curve: Curve::Exp },
    ParamDesc { name: "SWEEP", min: 0.0, max: 48.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "S.TIME", min: 5.0, max: 300.0, default_norm: 0.508, curve: Curve::Exp },
    ParamDesc { name: "DECAY", min: 50.0, max: 2000.0, default_norm: 0.5637, curve: Curve::Exp },
    ParamDesc { name: "CLICK", min: 0.0, max: 1.0, default_norm: 0.3, curve: Curve::Lin },
    ParamDesc { name: "DRIVE", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    ParamDesc { name: "NOISE", min: 0.0, max: 1.0, default_norm: 0.05, curve: Curve::Lin },
    ParamDesc { name: "TONE", min: 200.0, max: 12_000.0, default_norm: 0.8, curve: Curve::Exp },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.8, curve: Curve::Lin },
];

pub struct KickParams {
    smooth: [Smoother; KICK_PARAM_COUNT],
    values: [f32; KICK_PARAM_COUNT],
}

impl KickParams {
    pub fn new(sample_rate: f32) -> Self {
        let smooth: [Smoother; KICK_PARAM_COUNT] = core::array::from_fn(|i| {
            let d = KICK_PARAMS[i];
            Smoother::new(d.map(d.default_norm), 10.0, sample_rate)
        });
        let values = core::array::from_fn(|i| smooth[i].value());
        KickParams { smooth, values }
    }

    pub fn set_norm(&mut self, i: usize, norm: f32) {
        if let (Some(s), Some(d)) = (self.smooth.get_mut(i), KICK_PARAMS.get(i)) {
            s.set(d.map(norm));
        }
    }

    pub fn advance(&mut self) {
        for i in 0..KICK_PARAM_COUNT {
            self.values[i] = self.smooth[i].next();
        }
    }

    pub fn get(&self, i: usize) -> f32 {
        self.values[i]
    }
}

pub struct KickVoice {
    sample_rate: f32,
    phase: f32,
    t: u32,
    active: bool,
    vel: f32,
    drift: f32,
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
            lp: 0.0,
            drive: Drive2x::new(),
            rng: Rng::new(seed),
        }
    }

    pub fn trigger(&mut self, vel: f32, rng: &mut Rng) {
        self.t = 0;
        self.phase = 0.0;
        self.active = true;
        self.vel = vel.clamp(0.0, 1.0);
        // ±1% pitch per hit: no two kicks are identical, like an analog circuit.
        self.drift = rng.bipolar() * 0.01;
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn render(&mut self, p: &KickParams) -> f32 {
        if !self.active {
            return 0.0;
        }
        let ts = self.t as f32 / self.sample_rate;
        let noise = self.rng.bipolar();
        let nz = p.get(NOISE);

        // NOISE both adds a layer and micro-modulates pitch and amplitude.
        let pitch_env = (-ts / (p.get(STIME) * 0.001)).exp();
        let semis = p.get(SWEEP) * pitch_env;
        let freq = p.get(TUNE) * (1.0 + self.drift) * (semis / 12.0).exp2() * (1.0 + noise * nz * 0.02);
        self.phase += freq / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let amp = (-ts / (p.get(DECAY) * 0.001)).exp();
        let body = (self.phase * TAU).sin() * amp * (1.0 + noise * nz * 0.3);
        let impulse = if self.t == 0 { 1.0 } else { 0.0 };
        let click = (impulse + noise * 0.6) * (-ts / 0.002).exp() * p.get(CLICK);
        let layer = noise * nz * 0.15 * amp;

        let x = self.drive.process(body + click + layer, p.get(DRIVE));
        self.lp += (x - self.lp) * one_pole_coef(p.get(TONE), self.sample_rate);

        self.t = self.t.saturating_add(1);
        if amp < 1.0e-4 && ts > 0.01 {
            self.active = false;
        }
        self.lp * self.vel * p.get(LEVEL)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p utero-core kick`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/kick.rs
git commit -m "feat(core): add analog-style kick voice with noise modulation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Engine: wiring, command API, offline render, benchmark

**Files:**
- Create: `crates/core/src/engine.rs`, `crates/core/tests/render.rs`
- Modify: `crates/core/src/lib.rs` (add `pub mod engine;`)

**Interfaces:**
- Consumes: `Transport`, `Track`, `Step`, `Cond`, `CondCtx`, `KickParams`, `KickVoice`, `Rng`.
- Produces:
  - Constants: `engine::BLOCK = 128`, `engine::TRACKS = 13`, `engine::KICK_TRACKS = 2`
  - `Engine::new(sample_rate: f32)` and public fields `out_l: [f32; BLOCK]`, `out_r: [f32; BLOCK]`
  - Command methods:
    - `play()`, `stop()`
    - `set_bpm(bpm: f32)`, `set_fill(on: bool)`
    - `set_step(track: usize, index: usize, step: Step)`
    - `set_length(track: usize, len: u8)`, `set_speed(track: usize, code: u8)`
    - `set_param(track: usize, param: usize, norm: f32)`
  - Readout: `playhead(track: usize) -> i32` (−1 for a bad index), `ticks() -> u64`
  - `process(frames: usize)`: fills `out_l` and `out_r` for `min(frames, BLOCK)` samples
  - All bad indices and non-finite values are ignored, never a panic.

- [ ] **Step 1: Write the failing unit tests** in `crates/core/src/engine.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::kick::DECAY;

    fn render_seconds(e: &mut Engine, secs: f32) -> Vec<f32> {
        let mut out = Vec::new();
        let blocks = (48_000.0 * secs / BLOCK as f32) as usize;
        for _ in 0..blocks {
            e.process(BLOCK);
            out.extend_from_slice(&e.out_l);
        }
        out
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len() as f32).sqrt()
    }

    fn quarter_kick(e: &mut Engine) {
        for s in [0, 4, 8, 12] {
            e.set_step(0, s, Step { trig: true, ..Step::default() });
        }
    }

    #[test]
    fn silent_when_stopped() {
        let mut e = Engine::new(48_000.0);
        quarter_kick(&mut e);
        assert!(render_seconds(&mut e, 0.5).iter().all(|&s| s == 0.0));
    }

    #[test]
    fn kick_lands_on_the_second_beat() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0); // quarter = 24000 samples
        e.set_param(0, DECAY, 0.0); // 50 ms
        quarter_kick(&mut e);
        e.play();
        let out = render_seconds(&mut e, 1.0);
        assert!(rms(&out[23_000..23_900]) < 0.01);
        assert!(rms(&out[24_000..24_900]) > 0.1);
    }

    #[test]
    fn output_is_clamped_to_unit_range() {
        let mut e = Engine::new(48_000.0);
        for t in 0..KICK_TRACKS {
            for p in 0..9 {
                e.set_param(t, p, 1.0);
            }
            e.set_step(t, 0, Step { trig: true, ..Step::default() });
        }
        e.set_param(0, crate::kick::DRIVE, 0.0);
        e.play();
        assert!(render_seconds(&mut e, 1.0).iter().all(|s| s.abs() <= 1.0));
    }

    #[test]
    fn out_of_range_commands_are_ignored() {
        let mut e = Engine::new(48_000.0);
        e.set_param(99, 0, 0.5);
        e.set_param(0, 50, 0.5);
        e.set_param(0, 0, f32::NAN);
        e.set_step(99, 0, Step::default());
        e.set_step(0, 200, Step::default());
        e.set_length(99, 4);
        e.set_speed(99, 2);
        e.set_bpm(f32::NAN);
        assert_eq!(e.playhead(99), -1);
        e.play();
        e.process(10_000); // more frames than BLOCK
        assert!(e.out_l.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn playheads_advance_per_track_length() {
        let mut e = Engine::new(48_000.0);
        e.set_bpm(120.0);
        e.set_length(1, 3);
        e.play();
        render_seconds(&mut e, 1.0); // 1 s at 120 bpm = 8 sixteenths
        assert_eq!(e.playhead(0), 7);
        assert_eq!(e.playhead(1), 7 % 3);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p utero-core engine`
Expected: compile error `cannot find type Engine`.

- [ ] **Step 3: Implement** (above the tests)

```rust
use crate::kick::{KickParams, KickVoice};
use crate::rng::Rng;
use crate::seq::{CondCtx, Step, Track};
use crate::transport::Transport;

pub const BLOCK: usize = 128;
pub const TRACKS: usize = 13;
pub const KICK_TRACKS: usize = 2;

pub struct Engine {
    pub out_l: [f32; BLOCK],
    pub out_r: [f32; BLOCK],
    transport: Transport,
    tracks: [Track; TRACKS],
    kicks: [KickVoice; KICK_TRACKS],
    kick_params: [KickParams; KICK_TRACKS],
    rng: Rng,
    fill: bool,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        Engine {
            out_l: [0.0; BLOCK],
            out_r: [0.0; BLOCK],
            transport: Transport::new(sample_rate),
            tracks: [Track::new(); TRACKS],
            kicks: core::array::from_fn(|i| KickVoice::new(sample_rate, 0x00C0_FFEE + i as u32)),
            kick_params: core::array::from_fn(|_| KickParams::new(sample_rate)),
            rng: Rng::new(0x5EED),
            fill: false,
        }
    }

    pub fn play(&mut self) {
        for t in &mut self.tracks {
            t.reset();
        }
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
        if !norm.is_finite() {
            return;
        }
        if let Some(p) = self.kick_params.get_mut(track) {
            p.set_norm(param, norm);
        }
    }

    pub fn playhead(&self, track: usize) -> i32 {
        self.tracks.get(track).map_or(-1, |t| t.playhead() as i32)
    }

    pub fn ticks(&self) -> u64 {
        self.transport.ticks()
    }

    pub fn process(&mut self, frames: usize) {
        for i in 0..frames.min(BLOCK) {
            if let Some(tick) = self.transport.tick() {
                self.on_tick(tick);
            }
            let mut s = 0.0;
            for k in 0..KICK_TRACKS {
                self.kick_params[k].advance();
                s += self.kicks[k].render(&self.kick_params[k]);
            }
            let y = s.clamp(-1.0, 1.0);
            self.out_l[i] = y;
            self.out_r[i] = y;
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
            }
            neighbor = self.tracks[t].last_cond();
        }
    }
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `cargo test -p utero-core engine`
Expected: 5 passed.

- [ ] **Step 5: Write the offline render test and the benchmark** in `crates/core/tests/render.rs`

```rust
use std::io::Write;
use std::path::Path;
use std::time::Instant;

use utero_core::engine::{Engine, BLOCK};
use utero_core::seq::{Cond, Step};

const SR: u32 = 48_000;

fn groove() -> Engine {
    let mut e = Engine::new(SR as f32);
    e.set_bpm(128.0);
    for s in [0, 4, 8, 12] {
        e.set_step(0, s, Step { trig: true, ..Step::default() });
    }
    e.set_length(1, 13);
    for s in [3, 7, 10] {
        e.set_step(1, s, Step { trig: true, vel: 0.6, prob: 60, ..Step::default() });
    }
    e.set_step(1, 12, Step { trig: true, vel: 0.8, cond: Cond::Ab { a: 2, b: 4 }, micro: 5, ..Step::default() });
    e.set_param(1, 0, 0.6);
    e.play();
    e
}

fn render(e: &mut Engine, secs: f32) -> Vec<f32> {
    let blocks = (SR as f32 * secs / BLOCK as f32) as usize;
    let mut out = Vec::with_capacity(blocks * BLOCK);
    for _ in 0..blocks {
        e.process(BLOCK);
        out.extend_from_slice(&e.out_l);
    }
    out
}

fn write_wav(path: &Path, samples: &[f32]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut f = std::fs::File::create(path).unwrap();
    let data_len = (samples.len() * 2) as u32;
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + data_len).to_le_bytes()).unwrap();
    f.write_all(b"WAVEfmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap();
    f.write_all(&SR.to_le_bytes()).unwrap();
    f.write_all(&(SR * 2).to_le_bytes()).unwrap();
    f.write_all(&2u16.to_le_bytes()).unwrap();
    f.write_all(&16u16.to_le_bytes()).unwrap();
    f.write_all(b"data").unwrap();
    f.write_all(&data_len.to_le_bytes()).unwrap();
    for s in samples {
        f.write_all(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).unwrap();
    }
}

#[test]
fn groove_renders_clean_audio() {
    let out = render(&mut groove(), 4.0);
    assert!(out.iter().all(|s| s.is_finite()), "NaN/Inf in output");
    let peak = out.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
    assert!(peak > 0.1 && peak <= 1.0, "peak {peak}");
    let dc = out.iter().sum::<f32>() / out.len() as f32;
    assert!(dc.abs() < 0.01, "dc {dc}");
    write_wav(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/renders/kick-groove.wav").as_path(), &out);
}

#[test]
fn same_engine_setup_renders_identically() {
    assert_eq!(render(&mut groove(), 1.0), render(&mut groove(), 1.0));
}

#[test]
#[ignore = "benchmark: run with cargo test --release -- --ignored"]
fn engine_runs_under_quarter_of_realtime() {
    let mut e = groove();
    let start = Instant::now();
    render(&mut e, 10.0);
    let elapsed = start.elapsed().as_secs_f32();
    assert!(elapsed < 2.5, "10 s of audio took {elapsed:.3} s");
}
```

- [ ] **Step 6: Run the integration tests and the benchmark**

Run: `cargo test -p utero-core --test render`
Expected: 2 passed, 1 ignored. The file `target/renders/kick-groove.wav` exists. Listen to it once: a 128 BPM four-on-the-floor kick plus a sparser, higher second kick.
Run: `cargo test -p utero-core --release --test render -- --ignored`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add crates/core/src/lib.rs crates/core/src/engine.rs crates/core/tests/render.rs
git commit -m "feat(core): add engine with command api, offline render test and benchmark

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: WASM exports and build script

**Files:**
- Modify: `crates/wasm/src/lib.rs`
- Create: `scripts/build-wasm.sh`, `web/src/audio/exports.ts`, `web/src/audio/wasm.test.ts`
- Modify: `.gitignore` (add `web/public/utero.wasm`)

**Interfaces:**
- Consumes: `utero_core::engine::Engine` and its methods from Task 7, `utero_core::seq::{Step, Cond}`.
- Produces wasm exports. All numbers are JS numbers; `memory` is the module's exported `WebAssembly.Memory`.
  - `utero_init(sample_rate: f32)`
  - `utero_process(frames: u32)`
  - `utero_out_l() -> u32` and `utero_out_r() -> u32` (byte pointers into `memory`)
  - `utero_set_param(track, param, value: f32)`
  - `utero_set_step(track, step, trig, vel: f32, prob, cond, a, b, micro: i32)`
  - `utero_set_length(track, len)`, `utero_set_speed(track, code)`
  - `utero_play()`, `utero_stop()`, `utero_set_bpm(bpm: f32)`, `utero_set_fill(on)`
  - `utero_tick() -> f64`, `utero_playhead(track) -> i32`
- TS types `EngineExports` (command subset) and `WasmExports` (all) in `web/src/audio/exports.ts`.

- [ ] **Step 1: Write the TS export types and the failing integration test**

`web/src/audio/exports.ts`:
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
}

export interface WasmExports extends EngineExports {
  memory: WebAssembly.Memory
  utero_init(sampleRate: number): void
  utero_process(frames: number): void
  utero_out_l(): number
  utero_out_r(): number
  utero_tick(): number
  utero_playhead(track: number): number
}
```

`web/src/audio/wasm.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import type { WasmExports } from './exports'

async function load(): Promise<WasmExports> {
  const path = fileURLToPath(new URL('../../public/utero.wasm', import.meta.url))
  const { instance } = await WebAssembly.instantiate(readFileSync(path), {})
  return instance.exports as unknown as WasmExports
}

test('wasm engine renders a kick after play', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_step(0, 0, 1, 1, 100, 0, 1, 2, 0)
  ex.utero_play()
  ex.utero_process(128)
  const out = new Float32Array(ex.memory.buffer, ex.utero_out_l(), 128)
  expect(out.every(Number.isFinite)).toBe(true)
  expect(Math.max(...Array.from(out, Math.abs))).toBeGreaterThan(0)
  expect(ex.utero_tick()).toBeGreaterThan(0)
  expect(ex.utero_playhead(0)).toBe(0)
})

test('wasm engine survives garbage commands without trapping', async () => {
  const ex = await load()
  ex.utero_init(48000)
  ex.utero_set_param(99, 99, NaN)
  ex.utero_set_step(99, 999, 1, NaN, 500, 42, 0, 0, 999)
  ex.utero_set_length(0, 0)
  ex.utero_set_bpm(NaN)
  ex.utero_play()
  ex.utero_process(4096)
  expect(ex.utero_playhead(99)).toBe(-1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/audio/wasm.test.ts`
Expected: FAIL with `ENOENT … public/utero.wasm`.

- [ ] **Step 3: Implement the exports** in `crates/wasm/src/lib.rs` (replace the file)

```rust
use core::cell::UnsafeCell;

use utero_core::engine::Engine;
use utero_core::seq::{Cond, Step};

struct Global(UnsafeCell<Option<Engine>>);

// The AudioWorklet is single-threaded: only the audio thread touches the engine.
unsafe impl Sync for Global {}

static ENGINE: Global = Global(UnsafeCell::new(None));

fn eng() -> &'static mut Engine {
    unsafe { (*ENGINE.0.get()).as_mut().expect("utero_init must be called first") }
}

fn byte(v: u32) -> u8 {
    v.min(255) as u8
}

#[no_mangle]
pub extern "C" fn utero_init(sample_rate: f32) {
    unsafe { *ENGINE.0.get() = Some(Engine::new(sample_rate)) }
}

#[no_mangle]
pub extern "C" fn utero_process(frames: u32) {
    eng().process(frames as usize);
}

#[no_mangle]
pub extern "C" fn utero_out_l() -> *const f32 {
    eng().out_l.as_ptr()
}

#[no_mangle]
pub extern "C" fn utero_out_r() -> *const f32 {
    eng().out_r.as_ptr()
}

#[no_mangle]
pub extern "C" fn utero_set_param(track: u32, param: u32, value: f32) {
    eng().set_param(track as usize, param as usize, value);
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn utero_set_step(track: u32, step: u32, trig: u32, vel: f32, prob: u32, cond: u32, a: u32, b: u32, micro: i32) {
    let s = Step {
        trig: trig != 0,
        vel,
        prob: byte(prob),
        cond: Cond::from_code(byte(cond), byte(a), byte(b)),
        micro: micro.clamp(-11, 11) as i8,
    };
    eng().set_step(track as usize, step as usize, s);
}

#[no_mangle]
pub extern "C" fn utero_set_length(track: u32, len: u32) {
    eng().set_length(track as usize, byte(len));
}

#[no_mangle]
pub extern "C" fn utero_set_speed(track: u32, code: u32) {
    eng().set_speed(track as usize, byte(code));
}

#[no_mangle]
pub extern "C" fn utero_play() {
    eng().play();
}

#[no_mangle]
pub extern "C" fn utero_stop() {
    eng().stop();
}

#[no_mangle]
pub extern "C" fn utero_set_bpm(bpm: f32) {
    eng().set_bpm(bpm);
}

#[no_mangle]
pub extern "C" fn utero_set_fill(on: u32) {
    eng().set_fill(on != 0);
}

#[no_mangle]
pub extern "C" fn utero_tick() -> f64 {
    eng().ticks() as f64
}

#[no_mangle]
pub extern "C" fn utero_playhead(track: u32) -> i32 {
    eng().playhead(track as usize)
}
```

`scripts/build-wasm.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build -p utero-wasm --target wasm32-unknown-unknown --release
mkdir -p web/public
cp target/wasm32-unknown-unknown/release/utero_wasm.wasm web/public/utero.wasm
echo "built web/public/utero.wasm ($(wc -c < web/public/utero.wasm) bytes)"
```

Append to `.gitignore`:
```
web/public/utero.wasm
```

- [ ] **Step 4: Build the wasm and run the test to verify it passes**

Run: `chmod +x scripts/build-wasm.sh && (cd web && npm run wasm && npx vitest run src/audio/wasm.test.ts)`
Expected: "built web/public/utero.wasm (… bytes)", then 2 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/wasm/src/lib.rs scripts/build-wasm.sh .gitignore web/src/audio/exports.ts web/src/audio/wasm.test.ts
git commit -m "feat(wasm): expose engine through c-abi exports with build script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Audio host: command ring, dispatch, worklet, isolation guard

**Files:**
- Create: `web/src/state/types.ts`, `web/src/audio/ops.ts`, `web/src/audio/ring.ts`, `web/src/audio/dispatch.ts`, `web/src/audio/snapshot.ts`, `web/src/audio/isolation.ts`, `web/src/audio/worklet-env.d.ts`, `web/src/audio/worklet.ts`, `web/src/audio/host.ts`
- Test: `web/src/audio/ring.test.ts`, `web/src/audio/dispatch.test.ts`, `web/src/audio/isolation.test.ts`

**Interfaces:**
- Consumes: `EngineExports` and `WasmExports` (Task 8).
- Produces:
  - `types.ts`: `CondCode` (0–7, same codes as `Cond::from_code`), `StepState`, `TrackState`, `AppState`
  - `ops.ts`:
    - `Op` = `{ SetParam: 1, SetStep: 2, SetLength: 3, SetSpeed: 4, Play: 5, Stop: 6, SetBpm: 7, SetFill: 8 }`
    - `CMD_WORDS = 10`
    - builders `cmdSetParam(t, p, v)`, `cmdSetStep(t, s, step: StepState)`, `cmdSetLength(t, len)`, `cmdSetSpeed(t, code)`, `cmdPlay()`, `cmdStop()`, `cmdSetBpm(bpm)`, `cmdSetFill(on: boolean)`, all returning `number[]`
  - `ring.ts`: `CommandRing.create(capacity: number)`, `CommandRing.attach(sab: SharedArrayBuffer)`, `.sab`, `.push(cmd: ArrayLike<number>): boolean` and `.pop(out: Float32Array): boolean`. Usable capacity is `capacity − 1`.
  - `dispatch.ts`: `dispatch(ex: EngineExports, cmd: ArrayLike<number>): void`
  - `snapshot.ts`: `SNAP_TRACKS = 13`, `SNAP_FLOATS = 14`, `playheadOf(snap: Float32Array, track: number): number`. Layout: `[0]` = tick, `[1 + t]` = playhead of track t.
  - `isolation.ts`: `assertIsolated(isolated: boolean): void`, which throws `Error` with a human-readable message
  - `host.ts`: `startEngine(): Promise<EngineHost>`, where `EngineHost = { ctx: AudioContext; send(cmd: number[]): void; snapshot: Float32Array }`

- [ ] **Step 1: Write the shared types** in `web/src/state/types.ts`

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

export interface AppState {
  bpm: number
  playing: boolean
  selected: number
  tracks: TrackState[]
}
```

- [ ] **Step 2: Write the failing tests**

`web/src/audio/ring.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { CMD_WORDS } from './ops'
import { CommandRing } from './ring'

const out = () => new Float32Array(CMD_WORDS)

describe('CommandRing', () => {
  test('pops commands in FIFO order', () => {
    const r = CommandRing.create(8)
    r.push([1, 10])
    r.push([2, 20])
    const o = out()
    expect(r.pop(o)).toBe(true)
    expect([o[0], o[1]]).toEqual([1, 10])
    expect(r.pop(o)).toBe(true)
    expect([o[0], o[1]]).toEqual([2, 20])
    expect(r.pop(o)).toBe(false)
  })

  test('refuses to push when full and keeps unread commands intact', () => {
    const r = CommandRing.create(4)
    expect(r.push([1])).toBe(true)
    expect(r.push([2])).toBe(true)
    expect(r.push([3])).toBe(true)
    expect(r.push([4])).toBe(false)
    const o = out()
    const seen: number[] = []
    while (r.pop(o)) seen.push(o[0])
    expect(seen).toEqual([1, 2, 3])
  })

  test('stays ordered across many wraparounds', () => {
    const r = CommandRing.create(5)
    const o = out()
    for (let i = 0; i < 1000; i++) {
      expect(r.push([i, i * 2])).toBe(true)
      expect(r.pop(o)).toBe(true)
      expect([o[0], o[1]]).toEqual([i, i * 2])
    }
  })

  test('attach sees the same queue (other thread view)', () => {
    const a = CommandRing.create(8)
    const b = CommandRing.attach(a.sab)
    a.push([7, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const o = out()
    expect(b.pop(o)).toBe(true)
    expect(Array.from(o)).toEqual([7, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test('zero-fills unused command words when a slot is reused', () => {
    const r = CommandRing.create(2)
    r.push([5, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    r.pop(out())
    r.push([9])
    r.pop(out())
    r.push([6]) // lands in slot 0 again
    const o = out()
    r.pop(o)
    expect(Array.from(o)).toEqual([6, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})
```

`web/src/audio/dispatch.test.ts`:
```ts
import { expect, test } from 'vitest'
import type { EngineExports } from './exports'
import { dispatch } from './dispatch'
import { cmdPlay, cmdSetBpm, cmdSetFill, cmdSetLength, cmdSetParam, cmdSetSpeed, cmdSetStep, cmdStop } from './ops'

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
  }
  return { ex, calls }
}

test('every command builder reaches the matching export', () => {
  const { ex, calls } = fake()
  const step = { trig: true, vel: 0.5, prob: 60, cond: 1 as const, a: 2, b: 4, micro: -3 }
  for (const cmd of [
    cmdSetParam(1, 2, 0.25), cmdSetStep(0, 5, step), cmdSetLength(1, 13), cmdSetSpeed(1, 2),
    cmdPlay(), cmdStop(), cmdSetBpm(128), cmdSetFill(true),
  ]) dispatch(ex, cmd)
  expect(calls).toEqual([
    ['set_param', [1, 2, 0.25]],
    ['set_step', [0, 5, 1, 0.5, 60, 1, 2, 4, -3]],
    ['set_length', [1, 13]],
    ['set_speed', [1, 2]],
    ['play', []],
    ['stop', []],
    ['set_bpm', [128]],
    ['set_fill', [1]],
  ])
})

test('unknown opcode is ignored', () => {
  const { ex, calls } = fake()
  dispatch(ex, [99, 1, 2])
  expect(calls).toEqual([])
})
```

`web/src/audio/isolation.test.ts`:
```ts
import { expect, test } from 'vitest'
import { assertIsolated } from './isolation'

test('passes when cross-origin isolated', () => {
  expect(() => assertIsolated(true)).not.toThrow()
})

test('explains the missing headers when not isolated', () => {
  expect(() => assertIsolated(false)).toThrow(/COOP\/COEP/)
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/audio`
Expected: FAIL. `./ops`, `./ring`, `./dispatch` and `./isolation` cannot be resolved; `wasm.test.ts` still passes.

- [ ] **Step 4: Implement**

`web/src/audio/ops.ts`:
```ts
import type { StepState } from '@/state/types'

export const Op = { SetParam: 1, SetStep: 2, SetLength: 3, SetSpeed: 4, Play: 5, Stop: 6, SetBpm: 7, SetFill: 8 } as const
export const CMD_WORDS = 10

export const cmdSetParam = (t: number, p: number, v: number) => [Op.SetParam, t, p, v]
export const cmdSetStep = (t: number, s: number, st: StepState) =>
  [Op.SetStep, t, s, st.trig ? 1 : 0, st.vel, st.prob, st.cond, st.a, st.b, st.micro]
export const cmdSetLength = (t: number, len: number) => [Op.SetLength, t, len]
export const cmdSetSpeed = (t: number, code: number) => [Op.SetSpeed, t, code]
export const cmdPlay = () => [Op.Play]
export const cmdStop = () => [Op.Stop]
export const cmdSetBpm = (bpm: number) => [Op.SetBpm, bpm]
export const cmdSetFill = (on: boolean) => [Op.SetFill, on ? 1 : 0]
```

`web/src/audio/ring.ts`:
```ts
import { CMD_WORDS } from './ops'

const HEADER_BYTES = 8 // [writeIndex, readIndex] as Int32

/** Single-producer (UI) / single-consumer (audio thread) queue over a SharedArrayBuffer. */
export class CommandRing {
  private readonly header: Int32Array
  private readonly data: Float32Array
  private readonly capacity: number

  static create(capacity: number): CommandRing {
    return new CommandRing(new SharedArrayBuffer(HEADER_BYTES + capacity * CMD_WORDS * 4))
  }

  static attach(sab: SharedArrayBuffer): CommandRing {
    return new CommandRing(sab)
  }

  private constructor(readonly sab: SharedArrayBuffer) {
    this.header = new Int32Array(sab, 0, 2)
    this.data = new Float32Array(sab, HEADER_BYTES)
    this.capacity = this.data.length / CMD_WORDS
  }

  push(cmd: ArrayLike<number>): boolean {
    const w = Atomics.load(this.header, 0)
    const next = (w + 1) % this.capacity
    if (next === Atomics.load(this.header, 1)) return false
    const base = w * CMD_WORDS
    for (let i = 0; i < CMD_WORDS; i++) this.data[base + i] = i < cmd.length ? cmd[i] : 0
    Atomics.store(this.header, 0, next)
    return true
  }

  pop(out: Float32Array): boolean {
    const r = Atomics.load(this.header, 1)
    if (r === Atomics.load(this.header, 0)) return false
    out.set(this.data.subarray(r * CMD_WORDS, r * CMD_WORDS + CMD_WORDS))
    Atomics.store(this.header, 1, (r + 1) % this.capacity)
    return true
  }
}
```

`web/src/audio/dispatch.ts`:
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
  }
}
```

`web/src/audio/snapshot.ts`:
```ts
export const SNAP_TRACKS = 13
export const SNAP_FLOATS = 1 + SNAP_TRACKS

export const playheadOf = (snap: Float32Array, track: number) => snap[1 + track]
```

`web/src/audio/isolation.ts`:
```ts
export function assertIsolated(isolated: boolean): void {
  if (!isolated) {
    throw new Error(
      'utero needs cross-origin isolation for SharedArrayBuffer. Run it with `npm run dev` / `npm run preview`, or serve it with COOP/COEP headers.',
    )
  }
}
```

`web/src/audio/worklet-env.d.ts`:
```ts
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: AudioWorkletNodeOptions)
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}
declare function registerProcessor(name: string, ctor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor): void
declare const sampleRate: number
```

`web/src/audio/worklet.ts`:
```ts
import { dispatch } from './dispatch'
import type { WasmExports } from './exports'
import { CMD_WORDS } from './ops'
import { CommandRing } from './ring'
import { SNAP_TRACKS } from './snapshot'

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

  constructor(options: AudioWorkletNodeOptions) {
    super()
    const { module, ring, snap } = options.processorOptions as Options
    this.ex = new WebAssembly.Instance(module, {}).exports as unknown as WasmExports
    this.ex.utero_init(sampleRate)
    this.ring = CommandRing.attach(ring)
    this.snap = new Float32Array(snap)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    while (this.ring.pop(this.cmd)) dispatch(this.ex, this.cmd)
    const [left, right] = outputs[0]
    const n = left.length
    this.ex.utero_process(n)
    // Re-create views only if wasm memory grew; avoids per-block allocation.
    if (this.mem !== this.ex.memory.buffer || this.outL.length !== n) {
      this.mem = this.ex.memory.buffer
      this.outL = new Float32Array(this.mem, this.ex.utero_out_l(), n)
      this.outR = new Float32Array(this.mem, this.ex.utero_out_r(), n)
    }
    left.set(this.outL)
    right?.set(this.outR)
    this.snap[0] = this.ex.utero_tick()
    for (let t = 0; t < SNAP_TRACKS; t++) this.snap[1 + t] = this.ex.utero_playhead(t)
    return true
  }
}

registerProcessor('utero-engine', UteroProcessor)
```

`web/src/audio/host.ts`:
```ts
import workletUrl from './worklet.ts?worker&url'
import { assertIsolated } from './isolation'
import { CommandRing } from './ring'
import { SNAP_FLOATS } from './snapshot'

export interface EngineHost {
  ctx: AudioContext
  send(cmd: number[]): void
  snapshot: Float32Array
}

/** Must be called from a user gesture (browsers block audio otherwise). */
export async function startEngine(): Promise<EngineHost> {
  assertIsolated(globalThis.crossOriginIsolated)
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
  await ctx.audioWorklet.addModule(workletUrl)
  const module = await WebAssembly.compileStreaming(fetch('/utero.wasm'))
  const ring = CommandRing.create(2048)
  const snap = new SharedArrayBuffer(SNAP_FLOATS * 4)
  const node = new AudioWorkletNode(ctx, 'utero-engine', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { module, ring: ring.sab, snap },
  })
  node.connect(ctx.destination)
  await ctx.resume()
  return {
    ctx,
    snapshot: new Float32Array(snap),
    send(cmd) {
      if (!ring.push(cmd)) console.warn('utero: command ring full, dropped opcode', cmd[0])
    },
  }
}
```

- [ ] **Step 5: Run the tests and the type-check to verify they pass**

Run: `cd web && npx vitest run src/audio && npx tsc --noEmit`
Expected: ring 5, dispatch 2, isolation 2 and wasm 2 tests pass; tsc reports no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/state/types.ts web/src/audio/ops.ts web/src/audio/ring.ts web/src/audio/dispatch.ts web/src/audio/snapshot.ts web/src/audio/isolation.ts web/src/audio/worklet-env.d.ts web/src/audio/worklet.ts web/src/audio/host.ts web/src/audio/ring.test.ts web/src/audio/dispatch.test.ts web/src/audio/isolation.test.ts
git commit -m "feat(web): add audio worklet host with shared command ring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Store and minimal UI (matrix, knobs, transport)

**Files:**
- Create: `web/src/state/kickParams.ts`, `web/src/state/store.ts`, `web/src/state/store.test.ts`
- Create: `web/src/ui/Knob.tsx`, `web/src/ui/SequencerMatrix.tsx`, `web/src/ui/MachinePanel.tsx`, `web/src/ui/TransportBar.tsx`, `web/src/ui/usePlayheads.ts`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes:
  - `types.ts` and the command builders in `ops.ts` (Task 9)
  - `startEngine` / `EngineHost` (Task 9), `SNAP_TRACKS` and `playheadOf` (Task 9)
  - shadcn `Button` from `@/components/ui/button` (Task 1)
- Produces:
  - `KICK_PARAMS: { name: string; default: number }[]` (9 entries, mirroring Task 6) and `KICK_PAGES: { name: string; params: number[] }[]`
  - `initialState(): AppState`
  - `createStore(initial?: AppState)` returning `Store`, with:
    - `getState()`, `subscribe(fn)`, `connect(send)`
    - actions `toggleStep(t, s)`, `setLength(t, len)`, `setSpeed(t, code)`, `setParam(t, p, v)`, `setBpm(bpm)`, `play()`, `stop()`, `select(t)`
  - `KICK_TRACKS = 2`

- [ ] **Step 1: Write the param mirror** in `web/src/state/kickParams.ts`

```ts
export interface ParamMeta {
  name: string
  default: number
}

/** Mirrors KICK_PARAMS in crates/core/src/kick.rs: same order, same default_norm. */
export const KICK_PARAMS: ParamMeta[] = [
  { name: 'TUNE', default: 0.2925 },
  { name: 'SWEEP', default: 0.5 },
  { name: 'S.TIME', default: 0.508 },
  { name: 'DECAY', default: 0.5637 },
  { name: 'CLICK', default: 0.3 },
  { name: 'DRIVE', default: 0.2 },
  { name: 'NOISE', default: 0.05 },
  { name: 'TONE', default: 0.8 },
  { name: 'LEVEL', default: 0.8 },
]

export const KICK_PAGES = [
  { name: 'SRC', params: [0, 1, 2, 3, 4, 5, 6, 7] },
  { name: 'AMP', params: [8] },
]
```

- [ ] **Step 2: Write the failing store tests** in `web/src/state/store.test.ts`

```ts
import { describe, expect, test } from 'vitest'
import { Op } from '@/audio/ops'
import { createStore } from './store'

function connected() {
  const store = createStore()
  const sent: number[][] = []
  store.connect((c) => sent.push(c))
  sent.length = 0
  return { store, sent }
}

describe('store', () => {
  test('initial state has 13 tracks and a four-on-the-floor kick', () => {
    const s = createStore().getState()
    expect(s.tracks.map((t) => t.name)).toEqual(['KICK', 'KCK2', 'HH', 'OH', 'SNR', 'NOIS', 'SMPL', 'SUB', 'MID', 'LD1', 'LD2', 'PAD', 'ORN'])
    expect(s.tracks[0].steps.flatMap((st, i) => (st.trig ? [i] : []))).toEqual([0, 4, 8, 12])
  })

  test('connect syncs bpm, lengths, speeds, non-default steps and kick params', () => {
    const store = createStore()
    const sent: number[][] = []
    store.connect((c) => sent.push(c))
    const count = (op: number) => sent.filter((c) => c[0] === op).length
    expect(count(Op.SetBpm)).toBe(1)
    expect(count(Op.SetLength)).toBe(13)
    expect(count(Op.SetSpeed)).toBe(13)
    expect(count(Op.SetStep)).toBe(4)
    expect(count(Op.SetParam)).toBe(18)
  })

  test('toggleStep flips the step and sends it', () => {
    const { store, sent } = connected()
    store.toggleStep(1, 3)
    expect(store.getState().tracks[1].steps[3].trig).toBe(true)
    expect(sent).toEqual([[Op.SetStep, 1, 3, 1, 1, 100, 0, 1, 2, 0]])
  })

  test('setLength rounds and clamps to 1..64', () => {
    const { store, sent } = connected()
    store.setLength(0, 0)
    expect(store.getState().tracks[0].length).toBe(1)
    store.setLength(0, 100)
    expect(store.getState().tracks[0].length).toBe(64)
    store.setLength(0, 5.6)
    expect(store.getState().tracks[0].length).toBe(6)
    expect(sent.at(-1)).toEqual([Op.SetLength, 0, 6])
  })

  test('setBpm clamps and ignores NaN', () => {
    const { store, sent } = connected()
    store.setBpm(Number.NaN)
    expect(store.getState().bpm).toBe(128)
    expect(sent).toEqual([])
    store.setBpm(1000)
    expect(store.getState().bpm).toBe(300)
    store.setBpm(5)
    expect(store.getState().bpm).toBe(20)
  })

  test('setParam clamps to 0..1', () => {
    const { store, sent } = connected()
    store.setParam(0, 2, 1.7)
    expect(store.getState().tracks[0].params[2]).toBe(1)
    expect(sent).toEqual([[Op.SetParam, 0, 2, 1]])
  })

  test('play and stop update state and send commands', () => {
    const { store, sent } = connected()
    store.play()
    expect(store.getState().playing).toBe(true)
    store.stop()
    expect(store.getState().playing).toBe(false)
    expect(sent).toEqual([[Op.Play], [Op.Stop]])
  })

  test('actions before connect only change state', () => {
    const store = createStore()
    store.toggleStep(0, 1)
    expect(store.getState().tracks[0].steps[1].trig).toBe(true)
  })

  test('subscribers are notified and can unsubscribe', () => {
    const store = createStore()
    let n = 0
    const off = store.subscribe(() => n++)
    store.select(3)
    off()
    store.select(4)
    expect(n).toBe(1)
    expect(store.getState().selected).toBe(4)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/state`
Expected: FAIL, `./store` cannot be resolved.

- [ ] **Step 4: Implement the store** in `web/src/state/store.ts`

```ts
import { cmdPlay, cmdSetBpm, cmdSetLength, cmdSetParam, cmdSetSpeed, cmdSetStep, cmdStop } from '@/audio/ops'
import { KICK_PARAMS } from './kickParams'
import type { AppState, StepState, TrackState } from './types'

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
  return { bpm: 128, playing: false, selected: 0, tracks }
}

type Send = (cmd: number[]) => void

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

  const syncAll = () => {
    send(cmdSetBpm(state.bpm))
    state.tracks.forEach((tr, t) => {
      send(cmdSetLength(t, tr.length))
      send(cmdSetSpeed(t, tr.speed))
      tr.steps.forEach((st, s) => { if (!isDefault(st)) send(cmdSetStep(t, s, st)) })
      tr.params.forEach((v, p) => send(cmdSetParam(t, p, v)))
    })
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
    setParam(t: number, p: number, v: number) {
      const value = clamp(v, 0, 1)
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
  }
}

export type Store = ReturnType<typeof createStore>
```

- [ ] **Step 5: Run the store tests to verify they pass**

Run: `cd web && npx vitest run src/state`
Expected: 9 passed.

- [ ] **Step 6: Implement the UI components**

`web/src/ui/usePlayheads.ts`:
```ts
import { useEffect, useState } from 'react'
import { playheadOf, SNAP_TRACKS } from '@/audio/snapshot'

const idle = () => Array<number>(SNAP_TRACKS).fill(-1)

export function usePlayheads(snapshot: Float32Array | null, playing: boolean): number[] {
  const [heads, setHeads] = useState<number[]>(idle)
  useEffect(() => {
    if (!snapshot || !playing) {
      setHeads(idle())
      return
    }
    let raf = 0
    let prev = ''
    const loop = () => {
      const next = Array.from({ length: SNAP_TRACKS }, (_, t) => playheadOf(snapshot, t))
      const key = next.join(',')
      if (key !== prev) {
        prev = key
        setHeads(next)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [snapshot, playing])
  return heads
}
```

`web/src/ui/Knob.tsx`:
```tsx
import { useRef } from 'react'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const R = 18
const C = 2 * Math.PI * R

interface KnobProps {
  label: string
  value: number
  defaultValue: number
  onChange(value: number): void
}

/** Vertical drag (⇧ = fine), double-click = default, arrow keys = step. */
export function Knob({ label, value, defaultValue, onChange }: KnobProps) {
  const lastY = useRef<number | null>(null)
  const current = useRef(value)
  current.current = value

  const nudge = (delta: number) => {
    const next = clamp01(current.current + delta)
    current.current = next
    onChange(next)
  }

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        width={48}
        height={48}
        viewBox="0 0 48 48"
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-acc"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          lastY.current = e.clientY
        }}
        onPointerMove={(e) => {
          if (lastY.current === null) return
          const dy = lastY.current - e.clientY
          lastY.current = e.clientY
          nudge(dy / (e.shiftKey ? 1000 : 200))
        }}
        onPointerUp={() => { lastY.current = null }}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.001 : 0.01
          if (e.key === 'ArrowUp') { e.preventDefault(); nudge(step) }
          if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-step) }
        }}
      >
        <circle cx={24} cy={24} r={R} fill="none" strokeWidth={4} className="stroke-zinc-800"
          strokeDasharray={`${0.75 * C} ${C}`} transform="rotate(135 24 24)" />
        <circle cx={24} cy={24} r={R} fill="none" strokeWidth={4} className="stroke-acc"
          strokeDasharray={`${0.75 * C * value} ${C}`} transform="rotate(135 24 24)" />
      </svg>
      <span className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</span>
      <span className="text-sm tabular-nums">{Math.round(value * 100)}</span>
    </div>
  )
}
```

`web/src/ui/SequencerMatrix.tsx`:
```tsx
import type { AppState } from '@/state/types'

export const SPEEDS = [
  { code: 0, label: '1/32' }, { code: 1, label: '1/16' }, { code: 2, label: '1/8' }, { code: 3, label: '1/4' },
  { code: 4, label: '1 BAR' }, { code: 5, label: '1/16T' }, { code: 6, label: '1/8T' },
]
const VISIBLE = 16

interface Props {
  state: AppState
  playheads: number[]
  onToggle(track: number, step: number): void
  onSetLength(track: number, length: number): void
  onSetSpeed(track: number, code: number): void
  onSelect(track: number): void
}

/** Click = trig, ⌥+click = track ends here. */
export function SequencerMatrix({ state, playheads, onToggle, onSetLength, onSetSpeed, onSelect }: Props) {
  return (
    <section aria-label="Sequencer" className="flex min-h-0 flex-col gap-[3px] border-r border-zinc-800 p-2">
      {state.tracks.map((tr, t) => {
        const newBus = t > 0 && state.tracks[t - 1].bus !== tr.bus
        const selected = state.selected === t
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
              return (
                <button key={s} type="button" aria-label={`${tr.name} step ${s + 1}`} aria-pressed={st.trig}
                  onClick={(e) => (e.altKey ? onSetLength(t, s + 1) : onToggle(t, s))}
                  className={[
                    'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-acc',
                    st.trig ? 'bg-acc/70' : 'bg-zinc-900',
                    beyond ? 'opacity-30 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,#27272a_3px_6px)]' : '',
                    s % 4 === 0 ? 'ml-0.5' : '',
                    isEnd ? 'border-r-2 border-acc' : '',
                    isHead ? 'ring-1 ring-zinc-200' : '',
                  ].join(' ')} />
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

`web/src/ui/MachinePanel.tsx`:
```tsx
import { useState } from 'react'
import { KICK_PAGES, KICK_PARAMS } from '@/state/kickParams'
import { KICK_TRACKS } from '@/state/store'
import type { AppState } from '@/state/types'
import { Knob } from './Knob'

interface Props {
  state: AppState
  onParam(track: number, param: number, value: number): void
}

export function MachinePanel({ state, onParam }: Props) {
  const [page, setPage] = useState(0)
  const t = state.selected
  const track = state.tracks[t]
  if (t >= KICK_TRACKS) {
    return (
      <aside aria-label="Machine" className="p-3 text-zinc-500">
        <b className="text-acc">{track.name}</b>: nincs még machine (későbbi terv).
      </aside>
    )
  }
  return (
    <aside aria-label="Machine" className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 p-2">
        <b className="text-acc">{track.name}</b>
        <span className="text-zinc-500">ANALOG BD</span>
      </div>
      <div role="tablist" className="flex border-b border-zinc-800">
        {KICK_PAGES.map((pg, i) => (
          <button key={pg.name} type="button" role="tab" aria-selected={page === i} onClick={() => setPage(i)}
            className={`flex-1 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-acc ${page === i ? 'text-acc shadow-[inset_0_-2px_0_var(--color-acc)]' : 'text-zinc-500'}`}>
            {pg.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-y-4 p-3">
        {KICK_PAGES[page].params.map((p) => (
          <Knob key={p} label={KICK_PARAMS[p].name} value={track.params[p]} defaultValue={KICK_PARAMS[p].default}
            onChange={(v) => onParam(t, p, v)} />
        ))}
      </div>
    </aside>
  )
}
```

`web/src/ui/TransportBar.tsx`:
```tsx
import { Button } from '@/components/ui/button'

interface Props {
  bpm: number
  playing: boolean
  error: string | null
  onTogglePlay(): void
  onBpm(bpm: number): void
}

export function TransportBar({ bpm, playing, error, onTogglePlay, onBpm }: Props) {
  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1.5">
      <b>utero</b>
      <Button size="sm" variant={playing ? 'default' : 'outline'} onClick={onTogglePlay} aria-label={playing ? 'Stop' : 'Play'}>
        {playing ? '■ STOP' : '▶ PLAY'}
      </Button>
      <label className="flex items-center gap-1 text-zinc-400">
        BPM
        <input type="number" min={20} max={300} step={0.1} value={bpm}
          onChange={(e) => onBpm(e.target.valueAsNumber)}
          className="w-16 rounded bg-zinc-900 px-1 py-0.5 text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc" />
      </label>
      {error && <span role="alert" className="text-red-400">{error}</span>}
      <span className="ml-auto text-zinc-500">⌥+klikk = sávhossz</span>
    </header>
  )
}
```

`web/src/App.tsx` (replace):
```tsx
import { useState, useSyncExternalStore } from 'react'
import { startEngine, type EngineHost } from '@/audio/host'
import { createStore } from '@/state/store'
import { MachinePanel } from '@/ui/MachinePanel'
import { SequencerMatrix } from '@/ui/SequencerMatrix'
import { TransportBar } from '@/ui/TransportBar'
import { usePlayheads } from '@/ui/usePlayheads'

const store = createStore()

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [host, setHost] = useState<EngineHost | null>(null)
  const [error, setError] = useState<string | null>(null)
  const playheads = usePlayheads(host?.snapshot ?? null, state.playing)

  const togglePlay = async () => {
    if (state.playing) {
      store.stop()
      return
    }
    try {
      if (!host) {
        const h = await startEngine()
        store.connect(h.send)
        setHost(h)
      }
      store.play()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr] bg-background font-mono text-xs text-foreground">
      <TransportBar bpm={state.bpm} playing={state.playing} error={error} onTogglePlay={togglePlay} onBpm={store.setBpm} />
      <main className="grid min-h-0 grid-cols-[1fr_440px]">
        <SequencerMatrix state={state} playheads={playheads} onToggle={store.toggleStep} onSetLength={store.setLength}
          onSetSpeed={store.setSpeed} onSelect={store.select} />
        <MachinePanel state={state} onParam={store.setParam} />
      </main>
    </div>
  )
}
```

- [ ] **Step 7: Run all automated checks**

Run: `cargo test -p utero-core && (cd web && npm run wasm && npm test && npx tsc --noEmit)`
Expected: all Rust tests pass. Vitest: store 9, ring 5, dispatch 2, isolation 2, wasm 2, sanity 1 all pass. tsc reports no errors.

- [ ] **Step 8: Manual check in Chrome** (this is the "first sound" milestone)

Run: `cd web && npm run dev` and open the URL in Chrome.

Expected:
1. Dark UI with 13 track rows grouped by bus. KICK shows trigs on steps 1, 5, 9, 13. The right panel shows 8 knobs.
2. **▶ PLAY** gives a 128 BPM kick, and the playhead outline moves along each row.
3. Click KCK2 steps 4, 8, 11. Then ⌥+click step 13 on KCK2: its length becomes 13 and the end marker moves. KCK2's playhead visibly drifts against KICK (polymeter).
4. Select KICK and drag TUNE, DECAY, DRIVE and NOISE. The sound changes without clicks. ⇧+drag is fine control, double-click resets. With Tab focused on a knob, the arrow keys change it.
5. Type `1000` in BPM: it clamps to 300. Clear the field: nothing breaks.
6. Run `npm run build && npm run preview`, play again: it still works (headers on preview).

Stop the server.

- [ ] **Step 9: Commit**

```bash
git add web/src/state/kickParams.ts web/src/state/store.ts web/src/state/store.test.ts web/src/ui/Knob.tsx web/src/ui/SequencerMatrix.tsx web/src/ui/MachinePanel.tsx web/src/ui/TransportBar.tsx web/src/ui/usePlayheads.ts web/src/App.tsx
git commit -m "feat(web): add sequencer matrix, kick panel and transport ui

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Deliberately deferred (not gaps)

These items are covered by later plans 1b–1e, as listed under Spec at the top.
- PROB/COND/LOCK/µTIME edit modes in the UI. The engine supports them already; the UI only toggles trigs.
- Steps 17–64 view/edit, the drag handle for length, click-to-type values.
- A single generated param registry instead of the `kickParams.ts` mirror.
- Kick BODY/AMP/SC pages, modulation, macros, buses, sends, master, persistence, MIDI learn.
