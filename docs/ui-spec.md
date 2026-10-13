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
- Use knobs and draggable handles instead of selects or steppers. All knobs are one size: 60 px wide, with the empty bottom of the dial cropped. Knobs are the same 24 px gap apart everywhere, and a section is as wide as its knobs plus their gaps.
- The knob caption (label and value) is a single click/drag target.
- Do not over-segment panels. Add no divider lines or group boxes between controls the user can tell apart on their own.

## Layout: two responsive units on three shared rows
- This is a fluid, responsive system. Do not fit things to exact screen pixels.
- **Left unit** has three rows: sequencer, modulators, mixer.
  - The sequencer sits on its column grid: track names | 4 beats × 4 steps | rate.
  - The modulator row holds the modulator page, which is four knobs wide (like the right unit), and the tiles take the rest of the width.
  - The mixer is 8 equal strips filling the width, with 1 px lines between them and the slider names (flt/drv/pan) inside the sliders. The narrow upright master output fader ("out") closes the row. Do not change this without asking.
- **Right unit** has three rows: machine, macros, master.
  - The right unit is exactly four knobs wide: 4 × 60 px knobs, 24 px gaps, plus the pane inset. Machine, FX and master knobs share those columns, and each knob column holds two macro faders.
- **Machine page:**
  - Amp envelope at the top: AHD curve plus value slots. It has a *fixed, modest height*; it does not stretch.
  - The machine knob section and the FX knob section share the remaining height equally, with their knobs centred vertically.
- **Master:**
  - Header: master, mute q, limit|clip, lufs.
  - Four knobs: comp, eq, sat, **limit** (a knob, showing its gain-reduction ring), centred.
  - The output fader lives at the right end of the mixer (see above).
  - Signal chain: sat → eq → comp → −6 dB trim → limiter → fader. Fader full travel is 0 dB.

## Controls keep their place
- Controls never move between modes, types or machines. A control a type doesn't have leaves its slot empty; nothing reflows. An empty knob slot shows the knob's grey track only, with no indicator and no caption.

## Modulator page
- **Eight knobs in two rows of four, nothing else** (owner's layout). The slots stay fixed for every type, and a slot a type doesn't use stays empty:
  - Row 1: type (off/lfo/noise/env) · waveform (lfo) | colour (noise) | atk (env) · rate (lfo) | hold (env) · depth
  - Row 2: trig mode (free/retrig/oneshot, lfo) · trig source (lfo, env) · jitter (lfo) | dec (env) · smooth
- A click without dragging toggles a setting: on rate it switches sync / Hz, on depth bipolar / unipolar (the value shows "bi" or "uni").
- No big waveform display: the tiles already show each modulator's shape. It was removed twice; do not bring it back.
- No shape icons, segmented choices or sliders on this page. Phase and fade stay in the engine and are not shown.
- Clicking the selected tile toggles map mode. The tiles fill their pane, with no inner frame.
- A tile draws the modulator's output over one bar as it is currently set: rate (how many cycles fit), fade, jitter, smooth, polarity and depth. There is no moving scan line.

## Process
- Verify every layout change with headless Chrome at 1440×900 and 2050×1100, and measure with element rectangles rather than eyeballing.
- Send the owner a screenshot of the branch before pushing a layout change, and push only after approval.
