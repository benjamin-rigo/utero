# utero 1c-b2: AHDSR amp envelopes + ENV modulator

Compact plan, inline execution. Agreed in chat on 2026-10-12: ATK HOLD DEC SUS REL in the Elektron style, with a visual curve.

## Design

- **Envelope shape:** `env.rs` holds the shared `Ahdsr`.
  - The stages run attack (linear, starting from the current level so retriggers never click), then hold at the peak, then decay to SUS over DEC, then release to 0 over REL.
  - There is no gate, because steps have no length. The hold time keeps the peak instead.
  - Decay and release use a normalised exponential, `(e^{-5p} − e^{-5}) / (1 − e^{-5})`, so each stage ends exactly on time. That keeps the graph truthful.
  - Times use an Exp curve (ATK/HOLD 0.5–4000 ms, DEC/REL 1–8000 ms); SUS is 0..1.
- **Machine rows:** ATK/HOLD/DEC/SUS/REL sit at 10..14 (FX stay at 15..23).
  - `with_fx` takes per-machine envelope defaults. Kick: 0.5 / 0.5 / 1500 / 0 / 50 ms. Bass: 2 / 0.5 / 355 / 0 / 60 ms.
  - The old DECAY params are retired: kick index 3 and bass index 5 become unused.
- **Machine pages:** the shared template's top-right slot is no longer DECAY.
  - Bass: SUB OCT, as a stepped knob.
  - Kick: an empty cell for now. The sub/mid kick redesign is still open.
  - Page params accept `-1` for an empty cell.
- **Amp section:** sits under the machine knobs. It has an `EnvGraph` (draggable points: A, H and R width; the D point's width and SUS height) and five value slots.
- **ENV modulator:**
  - `ModKind::Env` (code 4) fires on its TRIG source track.
  - Unipolar by default; depth and smooth work as before.
  - Its five times come in a new `SetModEnv(slot, a, h, d, s, r)` command, because SetModulator is already 14 words.
  - The MOD page for ENV shows the same `EnvGraph` with its slots and TRIG.

## Tasks

1. **Core:**
   - `env.rs` with tests: stage timing, exact end, retrigger without a jump, idle detection.
   - Kick and bass amp moved onto `Ahdsr`; machine tests updated.
   - The modulator gets `Env`, with sample rate passed to `next`; the `SetModEnv` command; the wasm export.
2. **Web state:**
   - ENV metas in the row tables.
   - `MOD_KINDS` gains ENV; `ModulatorState.env`; `store.setModEnv`; the command.
   - Empty page cells; choice params get stepped knobs automatically.
3. **Web UI:** `EnvGraph`, the amp section, the ENV mod page, the bass SUB OCT knob, the kick empty cell.
4. **Verify:** all suites, then one review; push only on the user's go.
