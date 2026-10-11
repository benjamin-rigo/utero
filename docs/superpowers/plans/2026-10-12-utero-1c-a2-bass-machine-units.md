# utero 1c-a2: one BASS machine, 8-knob KICK, real units, dB levels

Compact plan, executed inline (the user asked for the cheaper mode). The design was agreed in chat on 2026-10-12.

**Goal:** replace SUB + MID with a single 8-knob BASS machine (Pure Sub–inspired, macro-style controls) plus a SUB OCT switch. Make KICK a single 8-knob page without DRIVE. Show real units (dB, Hz, ms, %, names) under every knob, and give every machine LEVEL the fader's dB law.

## Design (agreed)

**BASS:** one page, 8 knobs, plus a switch.

| # | Knob | What it moves |
|---|---|---|
| 0 | SUB | Clean sine level (fader dB law). It is added after all processing, so grit never eats the low end ("regen"). |
| 1 | CHAR | Upper layer: 0 = silent/clean, 0–0.5 sine-ish → saw+square PRESSURE, 0.5–1 widening REESE detune (0–25 ct). The layer is high-passed at 90 Hz so it never masks the sub. |
| 2 | BRIGHT | Cutoff 40 Hz → 12 kHz with keytrack. Resonance rises gently with it. |
| 3 | PLUCK | Filter envelope depth (0–4 oct). Its decay shortens as PLUCK rises (400 → 40 ms). |
| 4 | GRIT | First half: tape drive. Second half adds noise AM on the upper layer, slight pitch jitter, and fold. |
| 5 | DECAY | Amp decay 30 ms → 4 s. |
| 6 | GLIDE | 0–300 ms portamento. |
| 7 | LEVEL | Machine level, fader dB law. |
| switch 8 | SUB OCT | 0 / −1 / −2 octaves under the step note (default −1). |

**KICK:** TUNE · SWEEP · S.TIME · DECAY · CLICK · NOISE · TONE · LEVEL (DRIVE removed; LEVEL uses the dB law).

**Tracks:** track 7 = BASS. Track 8 is renamed FREE (no machine, still on the BASS bus). LINK and DIRECT are gone.

**UI:**
- every ParamMeta carries a display spec, and knobs show the formatted value
- MachinePanel renders machine switches as a segmented, keyboard-operable control

## Tasks (inline, test-first)

1. **Core:** `kick.rs` drops DRIVE (indices shift) and uses `fader_gain(LEVEL)`. A new `bass.rs` replaces `sub.rs` and `mid.rs`. `engine.rs` uses BASS_TRACK = 7 and has no LINK/DIRECT. Update the affected tests; the benchmarks stay under 2.5 s.
2. **Web state:**
   - `kickParams.ts` and `machines.ts` get the new tables, display specs (`formatParam`) and BASS switches; MACHINES[7] = BASS, MACHINES[8] = null.
   - the track 7/8 names become BASS / FREE
   - update the counts and tests
3. **Web UI:**
   - Knob gets a `format` prop, wired through ParamKnob for every machine, bus and master knob
   - MachinePanel gets the segmented switch
   - update the tests (SUB/MID → BASS)
4. **Verify:** `cargo test`, `npm run wasm`, `npm test`, `tsc`, `build`. One final review subagent, then merge on the user's go.
