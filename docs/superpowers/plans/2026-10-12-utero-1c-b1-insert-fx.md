# utero 1c-b1: per-machine insert FX chain

Compact plan, inline execution (cost mode). The design was agreed in chat on 2026-10-12.

## Design (agreed)

- **What the user sees:** each machine page shows an 8-knob FX grid (4×2) under the machine knobs:
  drive · fold · filter · noise · chorus · disperse · delay · reverb.
  - **One knob per effect:** each knob is that effect's amount; 0 = bypass, and a bypassed effect is skipped (no CPU).
  - **Order = chain:** dragging a knob's label onto another knob moves it there. The order is stored per track.
  - **filter:** a click (press without drag) cycles lp → hp → comb; the label shows the mode. The knob sets the cutoff, or for comb the feedback, with comb tuned to the track's pitch.
  - **delay and reverb:** double-click opens a global settings page in place of the FX grid, with a back button. Every other knob keeps double-click = default.
- **Engine params:**
  - **Track rows:** every machine row gets 24 params: machine params, then padding, then FILTER MODE at 15 and the FX amounts at 16..23, in the fixed id order above. Mod, map, macro and smoothing all work on them.
  - **Master row:** gains the global delay and reverb params at 11..17:
    - DLY TIME, a choice of 1/16 · 1/8 · 1/8D · 1/4 · 1/4D · 1/2
    - DLY FB, DLY TONE
    - REV SIZE, REV DECAY, REV DAMP, REV PRE
- **DSP:** a mono insert between voice and bus, `FxChain` in `crates/core/src/fx.rs`.
  - **drive:** `Drive2x`.
  - **fold:** `dsp::fold` with pre-gain.
  - **filter:** `Svf` LP (20 k → 60 Hz) or HP (20 → 8 k), or a comb (delay at 1/pitch, feedback 0..0.95, mix).
  - **noise:** AM by low-passed noise.
  - **chorus:** two modulated taps on a 30 ms line.
  - **disperse:** 16 first-order allpasses.
  - **delay:** a 2 s line, tempo-synced, with LP-damped feedback.
  - **reverb:** a 4-line FDN with damping, size and decay, plus a pre-delay.
  - **Allocation:** buffers are heap `Vec`s allocated at construction; nothing allocates in `process`.
- **Commands:**
  - `SetFxOrder(track, o0..o7)` carries the order; an invalid permutation is ignored.
  - The snapshot is unchanged.

## Tasks

1. **Core:**
   - `fx.rs` with `FxChain`; tests: bypass is transparent, each effect is finite and bounded at extremes, delay echoes at the synced time, comb resonates at pitch, order changes the result.
   - Padded 24-param track tables (`with_fx`) and the master globals.
   - Engine routes voice → chain → bus and gets the `set_fx_order` command.
   - The wasm export `utero_set_fx_order`.
2. **Web state:**
   - FX metas and padded machine tables mirrored in `machines.ts`; master globals.
   - `tracks[t].fxOrder` with `store.moveFx(t, from, to)`; `cmdSetFxOrder` is sent on connect and on change.
   - Update the count tests.
3. **Web UI:**
   - `FxGrid` in MachinePanel: drag labels to reorder, click the filter to cycle its mode, double-click delay or reverb to open their settings page.
   - Knob gets `onTap` and an `onDoubleClick` override.
4. **Verify:** `cargo test`, `npm run wasm`, `npm test`, `tsc`, `build`; then one review. Push only when the user says so.
