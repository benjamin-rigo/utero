use core::f32::consts::TAU;

use crate::dsp::{fold, Drive2x, Svf};
use crate::params::{Curve, ParamDesc, MAX_PARAMS};
use crate::rng::Rng;

/// Effect ids, also the order of their amount params at `FX_BASE + id` on every machine row.
/// DRIVE has two modes (drive | fold) on `FX_DRIVE_MODE`, like the filter's lp | hp | comb.
pub const DRIVE: u8 = 0;
/// A saturated, band-limited feedback loop tuned to the track's pitch.
pub const FEEDBACK: u8 = 1;
pub const FILTER: u8 = 2;
pub const NOISE: u8 = 3;
pub const CHORUS: u8 = 4;
pub const DISPERSE: u8 = 5;
pub const DELAY: u8 = 6;
pub const REVERB: u8 = 7;
pub const FX_COUNT: usize = 8;
/// Machine-row param indices: filter mode at 15, the eight amounts at 16..23, drive mode at 24.
pub const FX_FILTER_MODE: usize = 15;
pub const FX_DRIVE_MODE: usize = 24;
pub const FX_BASE: usize = 16;
pub const DEFAULT_ORDER: [u8; FX_COUNT] = [0, 1, 2, 3, 4, 5, 6, 7];

const PAD: ParamDesc = ParamDesc { name: "", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin };
const fn amount(name: &'static str) -> ParamDesc {
    ParamDesc { name, min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin }
}

/// A machine's row: its params, its amp envelope at 10..14, the FX controls at 15..23 (mirrored in web/src/state/machines.ts).
/// `env` = the machine's amp-envelope defaults (ATK HOLD DEC SUS REL, normalised) at `env::ENV_BASE..`.
pub const fn with_fx<const N: usize>(machine: [ParamDesc; N], env: [f32; crate::env::ENV_COUNT]) -> [ParamDesc; MAX_PARAMS] {
    let mut out = [PAD; MAX_PARAMS];
    let mut i = 0;
    while i < N {
        out[i] = machine[i];
        i += 1;
    }
    let mut e = 0;
    while e < crate::env::ENV_COUNT {
        out[crate::env::ENV_BASE + e] = crate::env::env_desc(e, env[e]);
        e += 1;
    }
    // 0 = lp, 1 = hp, 2 = comb
    out[FX_FILTER_MODE] = ParamDesc { name: "FLT MODE", min: 0.0, max: 2.0, default_norm: 0.0, curve: Curve::Step };
    // 0 = drive, 1 = fold
    out[FX_DRIVE_MODE] = ParamDesc { name: "DRV MODE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Step };
    let names = ["DRIVE", "FEEDBACK", "FILTER", "NOISE", "CHORUS", "DISPERSE", "DELAY", "REVERB"];
    let mut k = 0;
    while k < FX_COUNT {
        out[FX_BASE + k] = amount(names[k]);
        k += 1;
    }
    out
}

/// Delay times in beats for the DLY TIME choice: 1/16 1/8 1/8D 1/4 1/4D 1/2.
pub const DELAY_BEATS: [f32; 6] = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];

/// Global delay settings (Elektron-style), read from the master row each sample.
#[derive(Clone, Copy, Debug)]
pub struct DelaySettings {
    pub beats: f32,
    pub feedback: f32,
    /// 0 = straight stereo, 1 = full ping-pong.
    pub ping: f32,
    pub width: f32,
    pub hpf: f32,
    pub lpf: f32,
    /// Tape-style saturation inside the feedback loop.
    pub sat: f32,
    /// Slow time wobble (tape wow).
    pub wow: f32,
}

/// Global reverb settings (Erbe-Verb-flavoured), read from the master row each sample.
#[derive(Clone, Copy, Debug)]
pub struct ReverbSettings {
    pub size: f32,
    pub decay_s: f32,
    /// High-frequency absorption in the tank (0 bright … 1 dark).
    pub absorb: f32,
    pub pre_ms: f32,
    pub hpf: f32,
    /// 0 dark … 0.5 flat … 1 bright.
    pub tilt: f32,
    pub speed_hz: f32,
    pub depth: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct FxGlobals {
    pub delay: DelaySettings,
    pub reverb: ReverbSettings,
    pub bpm: f32,
}

const CHORUS_MS: f32 = 30.0;
const DISPERSE_STAGES: usize = 48;
/// Disperser band: the knob sweeps it from 1.2 kHz down to 120 Hz (where kick and bass energy lives)
/// while switching in more stages, so turning it up smears the low end into a long chirp.
const DISPERSE_TOP_HZ: f32 = 1_200.0;
const DISPERSE_Q: f32 = 0.9;
/// Longest synced time: a 1/2 note at the 20 bpm floor = 6 s.
const DELAY_MAX_S: f32 = 6.1;
const PRE_MAX_S: f32 = 0.26;
/// FDN line lengths at 48 kHz for size 1 (mutually prime-ish).
const REV_LINES: [f32; 4] = [2_389.0, 2_713.0, 3_163.0, 3_571.0];
/// Input diffusers (Schroeder allpasses) at 48 kHz: smear the attack into a dense, smooth onset.
const DIFFUSERS: [f32; 4] = [142.0, 107.0, 379.0, 277.0];
const COMB_FB: f32 = 0.85;

/// Gain staging: follows input and output power (1 ms attack, 50 ms release) and pulls the output back
/// to the input level — instantly when it gets louder, slowly when it recovers — so even the first
/// transient after silence is level-matched. Never boosts: an effect that gets quieter stays quieter.
#[derive(Clone, Copy, Default)]
struct Leveler {
    env_in: f32,
    env_out: f32,
    gain: f32,
}

impl Leveler {
    fn new() -> Self {
        Leveler { gain: 1.0, ..Leveler::default() }
    }

    fn apply(&mut self, input: f32, output: f32, attack: f32, release: f32) -> f32 {
        let follow = |env: &mut f32, x: f32| *env += (x * x - *env) * if x * x > *env { attack } else { release };
        follow(&mut self.env_in, input);
        follow(&mut self.env_out, output);
        let want = if self.env_out > 1.0e-12 { (self.env_in / self.env_out).sqrt().min(1.0) } else { 1.0 };
        self.gain = if want < self.gain { want } else { self.gain + (want - self.gain) * release };
        output * self.gain
    }
}

/// Flushes values that would decay into denormals in feedback paths.
fn flush(x: f32) -> f32 {
    if x.abs() < 1.0e-20 { 0.0 } else { x }
}

fn coef(hz: f32, sr: f32) -> f32 {
    crate::dsp::one_pole_coef(hz, sr)
}

struct Line {
    buf: Vec<f32>,
    w: usize,
}

impl Line {
    fn new(len: usize) -> Self {
        Line { buf: vec![0.0; len.max(4)], w: 0 }
    }

    fn push(&mut self, x: f32) {
        self.w = (self.w + 1) % self.buf.len();
        self.buf[self.w] = x;
    }

    /// Fractional read: called before this sample's `push`, `delay` = 1 is the previous sample.
    fn read(&self, delay: f32) -> f32 {
        let len = self.buf.len();
        let d = delay.clamp(1.0, (len - 2) as f32);
        let i = d.floor() as usize;
        let frac = d - i as f32;
        let a = self.buf[(self.w + len + 1 - i) % len];
        let b = self.buf[(self.w + len - i) % len];
        a + (b - a) * frac
    }

    fn clear(&mut self) {
        self.buf.fill(0.0);
    }
}

/// Second-order allpass (RBJ) at a fixed frequency: the building block of the disperser.
#[derive(Clone, Copy, Default)]
struct Allpass2 {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

/// Mono effects with per-channel state; a chain runs one lane in mono and both once it is stereo.
struct Lane {
    drive: Drive2x,
    filter: Svf,
    comb: Line,
    rng: Rng,
    noise_lp: f32,
    disperse: [Allpass2; DISPERSE_STAGES],
    level: [Leveler; 2],
    loop_line: Line,
    loop_hp: f32,
    loop_lp: f32,
}

impl Lane {
    fn new(sr: f32, seed: u32) -> Self {
        Lane {
            drive: Drive2x::new(),
            filter: Svf::new(),
            comb: Line::new((sr / 25.0) as usize + 4),
            rng: Rng::new(seed),
            noise_lp: 0.0,
            disperse: [Allpass2::default(); DISPERSE_STAGES],
            level: [Leveler::new(); 2],
            loop_line: Line::new((sr / 35.0) as usize + 4),
            loop_hp: 0.0,
            loop_lp: 0.0,
        }
    }

    fn process(&mut self, id: u8, x: f32, a: f32, m: &Modes, c: &Consts) -> f32 {
        match id {
            DRIVE if m.drive < 0.5 => {
                let y = self.drive.process(x, a);
                self.level[0].apply(x, y, c.attack, c.release)
            }
            DRIVE => {
                let y = fold(x * (1.0 + a), a);
                self.level[1].apply(x, y, c.attack, c.release)
            }
            FEEDBACK => {
                // one period of the track's note around a band-limited, tanh-saturated loop: it rings at the
                // pitch, sings near the top of the knob and can never run away
                let period = c.sr / if m.pitch_hz > 0.0 { m.pitch_hz.clamp(40.0, 1_000.0) } else { 110.0 };
                let back = self.loop_line.read(period);
                self.loop_lp = flush(self.loop_lp + (back - self.loop_lp) * c.loop_lp);
                self.loop_hp = flush(self.loop_hp + (self.loop_lp - self.loop_hp) * c.loop_hp);
                let band = self.loop_lp - self.loop_hp;
                let y = (x + band * a * 1.1).tanh();
                self.loop_line.push(y);
                x + (y - x) * (a * 4.0).min(1.0) * 0.7
            }
            FILTER => match m.filter.round() as i32 {
                0 => self.filter.process(x, 20_000.0 * (60.0f32 / 20_000.0).powf(a), 1.0, c.sr).lp,
                1 => self.filter.process(x, 20.0 * (8_000.0f32 / 20.0).powf(a), 1.0, c.sr).hp,
                _ => {
                    // the knob tunes the comb (30 Hz … 3 kHz); resonance is fixed, the wet fades in over the first 5 %
                    let hz = 30.0 * 100f32.powf(a);
                    let y = x + self.comb.read(c.sr / hz) * COMB_FB;
                    self.comb.push(y);
                    x + (y * (1.0 - 0.7 * COMB_FB) - x) * 0.7 * (a * 20.0).min(1.0)
                }
            },
            NOISE => {
                let n = self.rng.bipolar();
                self.noise_lp += (n - self.noise_lp) * 0.03;
                // the low-passed noise has σ² ≈ 0.0051, so the AM adds 0.325·a² of power on average: take it back
                x * (1.0 + a * 8.0 * self.noise_lp) / (1.0 + 0.325 * a * a).sqrt()
            }
            _ => {
                // DISPERSE: the knob lowers the band and sets how many of the 48 allpasses are in
                // (the last one crossfades in)
                let w = TAU * DISPERSE_TOP_HZ * 0.1f32.powf(a) / c.sr;
                let alpha = w.sin() / (2.0 * DISPERSE_Q);
                let a0 = 1.0 + alpha;
                let ap = [(1.0 - alpha) / a0, -2.0 * w.cos() / a0, 1.0];
                let stages = a * DISPERSE_STAGES as f32;
                let full = stages.floor() as usize;
                let mut y = x;
                for (i, st) in self.disperse.iter_mut().enumerate() {
                    if i > full {
                        break;
                    }
                    let out = ap[0] * y + ap[1] * st.x1 + ap[2] * st.x2 - ap[1] * st.y1 - ap[0] * st.y2;
                    st.x2 = st.x1;
                    st.x1 = y;
                    st.y2 = st.y1;
                    st.y1 = flush(out);
                    y = if i == full { y + (out - y) * (stages - full as f32) } else { out };
                }
                y
            }
        }
    }

    fn reset(&mut self, id: u8) {
        match id {
            FILTER => {
                self.filter.reset();
                self.comb.clear();
            }
            DISPERSE => self.disperse = [Allpass2::default(); DISPERSE_STAGES],
            DRIVE => self.level = [Leveler::new(); 2],
            FEEDBACK => {
                self.loop_line.clear();
                self.loop_hp = 0.0;
                self.loop_lp = 0.0;
            }
            _ => {}
        }
    }
}

/// Per-sample switches of one machine: filter mode, drive mode, the pitch the comb-free loops follow.
pub struct Modes {
    pub filter: f32,
    pub drive: f32,
    pub pitch_hz: f32,
}

/// Per-chain constants.
struct Consts {
    sr: f32,
    loop_hp: f32,
    loop_lp: f32,
    attack: f32,
    release: f32,
}

struct Chorus {
    lines: [Line; 2],
    phase: [f32; 2],
}

impl Chorus {
    fn process(&mut self, l: f32, r: f32, a: f32, sr: f32) -> (f32, f32) {
        self.lines[0].push(l);
        self.lines[1].push(r);
        let mut wet = [0.0_f32; 2];
        for (v, rate) in [0.31_f32, 0.43].into_iter().enumerate() {
            self.phase[v] = (self.phase[v] + rate / sr).fract();
            for (ch, w) in wet.iter_mut().enumerate() {
                // the right channel runs its voices half a cycle apart: that is the stereo width
                let ms = 9.0 + 4.0 * ((self.phase[v] + 0.5 * ch as f32) * TAU).sin();
                *w += self.lines[ch].read(ms * 0.001 * sr) * 0.5;
            }
        }
        (l * (1.0 - 0.5 * a) + wet[0] * a, r * (1.0 - 0.5 * a) + wet[1] * a)
    }

    fn clear(&mut self) {
        self.lines.iter_mut().for_each(Line::clear);
    }
}

struct Delay {
    lines: [Line; 2],
    hp: [f32; 2],
    lp: [f32; 2],
    wow: f32,
}

impl Delay {
    fn process(&mut self, l: f32, r: f32, a: f32, d: &DelaySettings, bpm: f32, sr: f32) -> (f32, f32) {
        self.wow = (self.wow + 0.45 / sr).fract();
        let wobble = 1.0 + d.wow * 0.004 * (self.wow * TAU).sin();
        let samples = d.beats * 60.0 / bpm.max(20.0) * sr * wobble;
        let (hp_c, lp_c) = (coef(d.hpf, sr), coef(d.lpf, sr));
        let mut tap = [0.0_f32; 2];
        for ch in 0..2 {
            let x = self.lines[ch].read(samples);
            self.lp[ch] = flush(self.lp[ch] + (x - self.lp[ch]) * lp_c);
            self.hp[ch] = flush(self.hp[ch] + (self.lp[ch] - self.hp[ch]) * hp_c);
            let y = self.lp[ch] - self.hp[ch];
            let g = 1.0 + 3.0 * d.sat;
            tap[ch] = y + ((y * g).tanh() / g.tanh().max(1.0e-3) - y) * d.sat;
        }
        // ping-pong: the input enters on the left only and every repeat crosses sides
        let mono = 0.5 * (l + r);
        let input = [l + (mono - l) * d.ping, r * (1.0 - d.ping)];
        for ch in 0..2 {
            let fb = tap[ch] + (tap[1 - ch] - tap[ch]) * d.ping;
            self.lines[ch].push(input[ch] + fb * d.feedback);
        }
        let mid = 0.5 * (tap[0] + tap[1]);
        let side = 0.5 * (tap[0] - tap[1]) * d.width;
        (l * (1.0 - 0.5 * a) + (mid + side) * a, r * (1.0 - 0.5 * a) + (mid - side) * a)
    }

    fn clear(&mut self) {
        self.lines.iter_mut().for_each(Line::clear);
        self.hp = [0.0; 2];
        self.lp = [0.0; 2];
    }
}

struct Reverb {
    pre: Line,
    diffusers: [Line; 4],
    lines: [Line; 4],
    damp: [f32; 4],
    hp: [f32; 2],
    tilt: [f32; 2],
    phase: f32,
}

impl Reverb {
    fn process(&mut self, l: f32, r: f32, a: f32, v: &ReverbSettings, sr: f32) -> (f32, f32) {
        let scale = sr / 48_000.0;
        // input: high-pass (two one-poles) so the tail never gets muddy, then pre-delay and diffusion
        let mut x = 0.5 * (l + r);
        let hp_c = coef(v.hpf, sr);
        for h in &mut self.hp {
            *h = flush(*h + (x - *h) * hp_c);
            x -= *h;
        }
        self.pre.push(x);
        let mut y = self.pre.read((v.pre_ms * 0.001 * sr).max(1.0));
        for (i, d) in self.diffusers.iter_mut().enumerate() {
            let delayed = d.read(DIFFUSERS[i] * scale);
            let out = -0.6 * y + delayed;
            d.push(y + 0.6 * out);
            y = out;
        }

        self.phase = (self.phase + v.speed_hz / sr).fract();
        let size = 0.35 + 0.65 * v.size;
        let damp = 0.05 + 0.9 * (1.0 - v.absorb);
        let mut s = [0.0_f32; 4];
        for (i, line) in self.lines.iter().enumerate() {
            // each line breathes at its own phase: the internal modulation that smooths the tail
            let wobble = 1.0 + v.depth * 0.006 * ((self.phase + 0.25 * i as f32) * TAU).sin();
            let len = REV_LINES[i] * scale * size * wobble;
            self.damp[i] = flush(self.damp[i] + (line.read(len) - self.damp[i]) * damp);
            s[i] = self.damp[i];
        }
        // Householder feedback keeps the four lines decorrelated and energy-preserving.
        let half = 0.5 * (s[0] + s[1] + s[2] + s[3]);
        for (i, line) in self.lines.iter_mut().enumerate() {
            let len = REV_LINES[i] * scale * size;
            let gain = 10f32.powf(-3.0 * len / (v.decay_s.max(0.1) * sr));
            line.push(y * 0.35 + (s[i] - half) * gain);
        }
        let wet = [s[0] + s[1] - s[2] - s[3], s[0] - s[1] + s[2] - s[3]];
        // tilt: ±6 dB around 800 Hz, like the master
        let t = (v.tilt - 0.5) * 2.0;
        let (lo_g, hi_g) = (10f32.powf(-6.0 * t / 20.0), 10f32.powf(6.0 * t / 20.0));
        let tc = coef(800.0, sr);
        let mut out = [0.0_f32; 2];
        for ch in 0..2 {
            self.tilt[ch] = flush(self.tilt[ch] + (wet[ch] - self.tilt[ch]) * tc);
            out[ch] = (self.tilt[ch] * lo_g + (wet[ch] - self.tilt[ch]) * hi_g) * 0.35;
        }
        (l * (1.0 - 0.5 * a) + out[0] * a, r * (1.0 - 0.5 * a) + out[1] * a)
    }

    fn clear(&mut self) {
        self.pre.clear();
        self.diffusers.iter_mut().for_each(Line::clear);
        self.lines.iter_mut().for_each(Line::clear);
        self.damp = [0.0; 4];
        self.hp = [0.0; 2];
        self.tilt = [0.0; 2];
    }
}

/// One machine's insert chain: eight one-knob effects in a user order; amount 0 = bypass.
/// It starts mono; chorus, delay and reverb turn it stereo, and every effect after them runs per side.
pub struct FxChain {
    order: [u8; FX_COUNT],
    lanes: [Lane; 2],
    chorus: Chorus,
    delay: Delay,
    reverb: Reverb,
    c: Consts,
    /// Samples each effect has sat at amount 0; after `hold` it is reset and skipped.
    idle: [u32; FX_COUNT],
    hold: u32,
}

impl FxChain {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        let sr = sample_rate;
        let scale = sr / 48_000.0;
        FxChain {
            order: DEFAULT_ORDER,
            lanes: [Lane::new(sr, seed), Lane::new(sr, seed.wrapping_add(7))],
            chorus: Chorus { lines: [Line::new((CHORUS_MS * 0.001 * sr) as usize + 4), Line::new((CHORUS_MS * 0.001 * sr) as usize + 4)], phase: [0.0, 0.37] },
            delay: Delay {
                lines: [Line::new((DELAY_MAX_S * sr) as usize), Line::new((DELAY_MAX_S * sr) as usize)],
                hp: [0.0; 2],
                lp: [0.0; 2],
                wow: 0.0,
            },
            reverb: Reverb {
                pre: Line::new((PRE_MAX_S * sr) as usize),
                diffusers: DIFFUSERS.map(|l| Line::new((l * scale) as usize + 4)),
                lines: REV_LINES.map(|l| Line::new((l * scale * 1.05) as usize + 4)),
                damp: [0.0; 4],
                hp: [0.0; 2],
                tilt: [0.0; 2],
                phase: 0.0,
            },
            c: Consts {
                sr,
                loop_hp: coef(150.0, sr),
                loop_lp: coef(4_000.0, sr),
                attack: 1.0 - (-1.0 / (0.001 * sr)).exp(),
                release: 1.0 - (-1.0 / (0.05 * sr)).exp(),
            },
            idle: [u32::MAX; FX_COUNT],
            hold: (2.0 * sr) as u32,
        }
    }

    pub fn order(&self) -> [u8; FX_COUNT] {
        self.order
    }

    /// Accepts only a permutation of 0..8; anything else is ignored.
    pub fn set_order(&mut self, order: [u8; FX_COUNT]) {
        let mut seen = [false; FX_COUNT];
        for &id in &order {
            if (id as usize) >= FX_COUNT || seen[id as usize] {
                return;
            }
            seen[id as usize] = true;
        }
        self.order = order;
    }

    fn reset(&mut self, id: u8) {
        match id {
            CHORUS => self.chorus.clear(),
            DELAY => self.delay.clear(),
            REVERB => self.reverb.clear(),
            _ => self.lanes.iter_mut().for_each(|l| l.reset(id)),
        }
    }

    /// `amounts[id]` in 0..1; returns the stereo output.
    pub fn process(&mut self, x: f32, amounts: &[f32; FX_COUNT], modes: &Modes, g: &FxGlobals) -> (f32, f32) {
        let (mut l, mut r) = (x, x);
        let mut stereo = false;
        for k in 0..FX_COUNT {
            let id = self.order[k];
            let i = id as usize;
            let a = amounts[i];
            if a <= 1.0e-4 {
                // keep the state running for `hold` (a quick re-enable continues the live tail instead of
                // replaying a frozen one), then reset and skip
                if self.idle[i] >= self.hold {
                    continue;
                }
                self.idle[i] += 1;
                if self.idle[i] >= self.hold {
                    self.reset(id);
                    continue;
                }
            } else {
                self.idle[i] = 0;
            }
            let sr = self.c.sr;
            match id {
                CHORUS => (l, r) = self.chorus.process(l, r, a, sr),
                DELAY => (l, r) = self.delay.process(l, r, a, &g.delay, g.bpm, sr),
                REVERB => (l, r) = self.reverb.process(l, r, a, &g.reverb, sr),
                _ => {
                    l = self.lanes[0].process(id, l, a, modes, &self.c);
                    r = if stereo { self.lanes[1].process(id, r, a, modes, &self.c) } else { l };
                    continue;
                }
            }
            stereo = true;
        }
        let safe = |v: f32| if v.is_finite() { v.clamp(-4.0, 4.0) } else { 0.0 };
        (safe(l), safe(r))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;
    const G: FxGlobals = FxGlobals {
        delay: DelaySettings { beats: 0.5, feedback: 0.4, ping: 0.0, width: 1.0, hpf: 20.0, lpf: 16_000.0, sat: 0.0, wow: 0.0 },
        reverb: ReverbSettings { size: 0.5, decay_s: 2.0, absorb: 0.5, pre_ms: 10.0, hpf: 40.0, tilt: 0.5, speed_hz: 0.3, depth: 0.3 },
        bpm: 120.0,
    };

    fn md(filter: f32) -> Modes {
        Modes { filter, drive: 0.0, pitch_hz: 110.0 }
    }

    fn only(id: u8, a: f32) -> [f32; FX_COUNT] {
        let mut v = [0.0; FX_COUNT];
        v[id as usize] = a;
        v
    }

    fn sine(i: usize, f: f32) -> f32 {
        (i as f32 * f * TAU / SR).sin() * 0.5
    }

    fn rms(v: &[f32]) -> f32 {
        (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt()
    }

    #[test]
    fn all_zero_is_an_exact_bypass() {
        let mut c = FxChain::new(SR, 1);
        for i in 0..2_000 {
            let x = sine(i, 220.0);
            assert_eq!(c.process(x, &[0.0; FX_COUNT], &md(0.0), &G), (x, x));
        }
    }

    #[test]
    fn every_effect_stays_finite_and_bounded_at_full_amount() {
        for id in 0..FX_COUNT as u8 {
            for mode in [0.0, 1.0, 2.0] {
                let mut c = FxChain::new(SR, 2);
                for i in 0..24_000 {
                    let (l, r) = c.process(if i % 4_800 < 10 { 1.0 } else { sine(i, 80.0) }, &only(id, 1.0), &md(mode), &G);
                    assert!(l.is_finite() && r.is_finite() && l.abs() <= 4.0 && r.abs() <= 4.0, "fx {id} mode {mode}: {l} {r}");
                }
            }
        }
    }

    #[test]
    fn gain_staging_keeps_saturators_at_the_input_level() {
        for (id, drive_mode) in [(DRIVE, 0.0), (DRIVE, 1.0), (NOISE, 0.0)] {
            let mut c = FxChain::new(SR, 8);
            let n = 48_000;
            let m = Modes { drive: drive_mode, ..md(0.0) };
            let out: Vec<f32> = (0..n).map(|i| c.process(sine(i, 110.0) * 0.1, &only(id, 1.0), &m, &G).0).collect();
            let input: Vec<f32> = (n / 2..n).map(|i| sine(i, 110.0) * 0.1).collect();
            let db = 20.0 * (rms(&out[n / 2..]) / rms(&input)).log10();
            assert!(db.abs() < 1.0, "fx {id} mode {drive_mode}: {db} dB");
        }
    }

    #[test]
    fn gain_staging_catches_the_first_transient_after_silence() {
        let mut c = FxChain::new(SR, 9);
        let a = only(DRIVE, 1.0);
        for _ in 0..24_000 {
            c.process(0.0, &a, &md(0.0), &G);
        }
        let burst: Vec<f32> = (0..960).map(|i| sine(i, 110.0) * 0.2).collect();
        let out: Vec<f32> = burst.iter().map(|&x| c.process(x, &a, &md(0.0), &G).0).collect();
        let db = 20.0 * (rms(&out) / rms(&burst)).log10();
        assert!(db < 2.0, "first 20 ms {db} dB hotter");
    }

    #[test]
    fn feedback_rings_at_the_track_pitch() {
        let mut c = FxChain::new(SR, 14);
        let m = Modes { pitch_hz: 200.0, ..md(0.0) };
        let out: Vec<f32> = (0..9_600).map(|i| c.process(if i < 4 { 0.5 } else { 0.0 }, &only(FEEDBACK, 0.95), &m, &G).0).collect();
        // 200 Hz → 240 samples per round trip; it still rings 20 trips later
        let late: f32 = out[4_800..9_600].iter().map(|v| v * v).sum();
        assert!(late > 1.0e-4, "{late}");
        let corr: f32 = out[2_400..4_800].iter().zip(&out[2_160..4_560]).map(|(a, b)| a * b).sum();
        assert!(corr > 0.0, "{corr}");
    }

    #[test]
    fn delay_repeats_at_the_synced_time() {
        // 1/8 at 120 bpm = 0.25 s = 12 000 samples
        let mut c = FxChain::new(SR, 3);
        let out: Vec<f32> = (0..20_000).map(|i| c.process(if i == 0 { 1.0 } else { 0.0 }, &only(DELAY, 1.0), &md(0.0), &G).0).collect();
        let peak = out[1..].iter().enumerate().fold((0, 0.0_f32), |m, (i, v)| if v.abs() > m.1 { (i + 1, v.abs()) } else { m });
        assert_eq!(peak.0, 12_000, "echo at {}", peak.0);
    }

    #[test]
    fn ping_pong_alternates_sides() {
        let g = FxGlobals { delay: DelaySettings { ping: 1.0, feedback: 0.6, ..G.delay }, ..G };
        let mut c = FxChain::new(SR, 11);
        let out: Vec<(f32, f32)> = (0..30_000).map(|i| c.process(if i == 0 { 1.0 } else { 0.0 }, &only(DELAY, 1.0), &md(0.0), &g)).collect();
        let (first, second) = (out[12_000], out[24_000]);
        assert!(first.0.abs() > 4.0 * first.1.abs(), "first echo left: {first:?}");
        assert!(second.1.abs() > 4.0 * second.0.abs(), "second echo right: {second:?}");
    }

    #[test]
    fn chorus_and_reverb_are_stereo() {
        for id in [CHORUS, REVERB] {
            let mut c = FxChain::new(SR, 12);
            let out: Vec<(f32, f32)> = (0..24_000).map(|i| c.process(sine(i, 220.0), &only(id, 1.0), &md(0.0), &G)).collect();
            let side: Vec<f32> = out[12_000..].iter().map(|(l, r)| l - r).collect();
            assert!(rms(&side) > 0.01, "fx {id} side {}", rms(&side));
        }
    }

    #[test]
    fn comb_knob_tunes_the_resonance() {
        // 0.5 → 30·100^0.5 = 300 Hz → 160 samples between peaks
        let mut c = FxChain::new(SR, 4);
        let out: Vec<f32> = (0..4_800).map(|i| c.process(if i == 0 { 1.0 } else { 0.0 }, &only(FILTER, 0.5), &md(2.0), &G).0).collect();
        assert!(out[160].abs() > 0.2 && out[160].abs() > 10.0 * out[120].abs(), "{} {}", out[160], out[120]);
    }

    #[test]
    fn disperse_delays_the_low_end_into_a_chirp() {
        // a 120 Hz burst with a smooth window: where does its envelope peak come out?
        let burst = |i: usize| {
            let t = i as f32 / 2_400.0 - 1.0;
            sine(i, 120.0) * (-8.0 * t * t).exp()
        };
        let peak_at = |a: f32| {
            let mut c = FxChain::new(SR, 13);
            let out: Vec<f32> = (0..24_000).map(|i| c.process(burst(i), &only(DISPERSE, a), &md(0.0), &G).0).collect();
            let env: Vec<f32> = out.windows(400).map(|w| w.iter().map(|v| v * v).sum()).collect();
            env.iter().enumerate().fold((0, 0.0_f32), |m, (i, &v)| if v > m.1 { (i, v) } else { m }).0
        };
        let (dry, wet) = (peak_at(0.0), peak_at(1.0));
        assert!(wet > dry + 960, "the 120 Hz burst should come out ≥ 20 ms later: {dry} → {wet}");
    }

    #[test]
    fn reverb_has_a_tail_and_order_matters() {
        let mut c = FxChain::new(SR, 5);
        let tail: Vec<f32> = (0..48_000).map(|i| c.process(if i == 0 { 1.0 } else { 0.0 }, &only(REVERB, 1.0), &md(0.0), &G).0).collect();
        let late: f32 = tail[24_000..30_000].iter().map(|v| v * v).sum();
        assert!(late > 1.0e-6, "{late}");

        let run = |order: [u8; FX_COUNT]| {
            let mut c = FxChain::new(SR, 6);
            c.set_order(order);
            let mut amounts = [0.0; FX_COUNT];
            amounts[DRIVE as usize] = 1.0;
            amounts[FILTER as usize] = 0.8;
            (0..4_800).map(|i| c.process(sine(i, 110.0) * 2.0, &amounts, &md(0.0), &G).0).collect::<Vec<f32>>()
        };
        let a = run([0, 1, 2, 3, 4, 5, 6, 7]);
        let b = run([2, 1, 0, 3, 4, 5, 6, 7]);
        assert!(a.iter().zip(&b).any(|(x, y)| (x - y).abs() > 0.01));
    }

    #[test]
    fn a_disabled_delay_does_not_replay_stale_echoes() {
        let mut c = FxChain::new(SR, 10);
        c.process(1.0, &only(DELAY, 1.0), &md(0.0), &G);
        for _ in 0..(3 * 48_000) {
            c.process(0.0, &[0.0; FX_COUNT], &md(0.0), &G);
        }
        let back: f32 = (0..20_000).map(|_| c.process(0.0, &only(DELAY, 1.0), &md(0.0), &G).0.abs()).fold(0.0, f32::max);
        assert_eq!(back, 0.0);
    }

    #[test]
    fn invalid_orders_are_ignored() {
        let mut c = FxChain::new(SR, 7);
        c.set_order([0, 0, 1, 2, 3, 4, 5, 6]);
        c.set_order([0, 1, 2, 3, 4, 5, 6, 9]);
        assert_eq!(c.order(), DEFAULT_ORDER);
        c.set_order([7, 6, 5, 4, 3, 2, 1, 0]);
        assert_eq!(c.order(), [7, 6, 5, 4, 3, 2, 1, 0]);
    }

    #[test]
    fn padded_table_keeps_the_machine_and_appends_fx() {
        let t = with_fx(crate::kick::KICK_PARAMS, [0.0; 5]);
        assert_eq!(t[0].name, "TUNE");
        assert_eq!(t[8].name, "");
        assert_eq!(t[FX_FILTER_MODE].name, "FLT MODE");
        assert_eq!(t[FX_BASE + DELAY as usize].name, "DELAY");
    }
}
