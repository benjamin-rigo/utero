# utero UI spec

The decisions below were made with the owner. Read this before any UI change. If a change would contradict a line here, ask first; never silently undo it. When a decision changes, update this file in the same commit.

## Look
- Minimal and monochrome, like phasefiasco.com / tapefiasco: zinc greys, lowercase text everywhere, 1 px hairlines, no tooltips or hint texts, no section titles.
- Every colour, size and spacing comes from a token in `web/src/index.css`. Do not write raw zinc colours, `text-[..px]` or ad-hoc paddings.
- The spacing ladder is hair 1 / tight 4 / inset 8 / group 12 px. Each pane gets an inset of 8 and is split from its neighbours by a 1 px line.
- Type: 10 px is the only text size, plus 9 px micro for tile labels.
- Text roles: labels use ink-mute, values ink-soft, selected items bold ink.
- Either/or settings use `Segmented`, which shows every option with the active one filled white.
- Segmented options and toggles sit flush against each other, with no 1 px seams.
- Use knobs and draggable handles instead of selects or steppers. All knobs are one size: 60 px wide, with the empty bottom of the dial cropped.
- The knob caption (label and value) is a single click/drag target.
- Do not over-segment panels. Add no divider lines or group boxes between controls the user can tell apart on their own.

## Layout: two responsive units on three shared rows
- This is a fluid, responsive system. Do not fit things to exact screen pixels.
- **Left unit** has three rows: sequencer, modulators, mixer.
  - The sequencer and the modulator row sit on one column grid through subgrid: track names | 4 beats × 4 steps | rate. The modulator page covers the name column plus beats 1–2, and the tiles cover beats 3–4 plus the rate column.
  - The mixer is **not** on that grid: 8 equal strips fill the whole width, with 1 px lines between them and the slider names (flt/drv/pan) inside the sliders. Do not change this without asking.
- **Right unit** has three rows: machine, macros, master.
  - Machine and FX knobs use 4 equal columns, with each knob centred in its slot. Each column holds two macro faders.
- **Machine page:**
  - Amp envelope at the top: AHD curve plus value slots. It has a *fixed, modest height*; it does not stretch.
  - The machine knob section and the FX knob section share the remaining height equally, with their knobs centred vertically.
- **Master:**
  - Header: master, mute q, limit|clip, lufs.
  - Four knobs: comp, eq, sat, **limit** (a knob, showing its gain-reduction ring), centred.
  - A **narrow upright** output fader at the right.
  - Signal chain: sat → eq → comp → −6 dB trim → limiter → fader. Fader full travel is 0 dB.

## Controls keep their place
- Controls never move between modes, types or machines. A control a type doesn't have leaves its slot empty; nothing reflows.

## Modulator page
- Do **not** show a big waveform display on the page. The tiles already show each modulator's shape; this display was removed once and must not come back.
- Types are off / lfo / noise / env (STEP stays in the engine only).
- Shape is picked with waveform icons. Noise has a colour choice. Env has a draggable AHD curve.
- Controls are rate (sync|hz), phase, fade, jitter, depth (bi|uni), smooth, trig (free|retrig|oneshot); env uses atk, hold and dec instead of the LFO controls.
- Clicking the selected tile toggles map mode.
- The tiles fill their pane, with no inner frame.

## Process
- Verify every layout change with headless Chrome at 1440×900 and 2050×1100, and measure with element rectangles rather than eyeballing.
- Send the owner a screenshot of the branch before pushing a layout change, and push only after approval.
