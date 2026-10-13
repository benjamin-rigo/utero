# utero roadmap

These are next steps the owner asked for. The order is a suggestion. Before building each one, research it, write a short design, and get it approved.

1. **Kick envelope defaults that make musical sense.** Research typical techno kick amp and pitch envelopes (attack, hold, decay, sweep amount and time at 125–135 BPM), then set the defaults from that.
2. **Feedback with a self-balancing system.** The feedback FX currently has nothing balancing it in the background. Research balanced feedback networks: in-loop limiting/compression, DC and frequency control in the loop, gain compensation as feedback rises. Aim for something interesting that never runs away.
3. **A usable reverb.** The delay is roughly fine; the current reverb is close to unusable. The owner prefers Ableton's stock Reverb. Research the algorithms behind that kind of reverb (early reflections plus a diffused FDN or Dattorro-style tank, input diffusion, chorus/modulation, high/low damping) and rebuild the reverb on them.
4. **Sidechain ducking.** Put it on the mixer: each bus gets a control for how much the kick ducks it.
5. **The remaining machines.** Hats, perc, snare, noise, sample, lead, pad, ornament (KCK2 and BASS already exist).
6. **Global settings for every insert FX.** Open each FX's global settings with a double-click, the way delay and reverb do now: filter, drive, feedback, chorus, disperse and noise.
7. **Project management.** Save and load, slots (patterns or scenes), and similar.

8. **Research what to model and build.** Read the documentation of reference instruments and effects (Elektron, the Ableton devices, the T-1, classic hardware), then pick the effects and machines worth modelling. Write the result up as a short list with a reason for each, for the owner to choose from, before any of items 2–6 start.

UI work on any of these follows `docs/ui-spec.md`.
