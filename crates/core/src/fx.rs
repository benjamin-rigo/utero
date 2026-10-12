use core::f32::consts::TAU;

use crate::dsp::{fold, Drive2x, Svf};
use crate::params::{Curve, ParamDesc, MAX_PARAMS};
use crate::rng::Rng;

/// Effect ids, also the order of their amount params at `FX_BASE + id` on every machine row.
pub const DRIVE: u8 = 0;
pub const FOLD: u8 = 1;
pub const FILTER: u8 = 2;
pub const NOISE: u8 = 3;
pub const CHORUS: u8 = 4;
pub const DISPERSE: u8 = 5;
pub const DELAY: u8 = 6;
pub const REVERB: u8 = 7;
pub const FX_COUNT: usize = 8;
/// Machine-row param indices: filter mode at 15, the eight amounts at 16..23.
pub const FX_FILTER_MODE: usize = 15;
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
    let names = ["DRIVE", "FOLD", "FILTER", "NOISE", "CHORUS", "DISPERSE", "DELAY", "REVERB"];
    let mut k = 0;
    while k < FX_COUNT {
        out[FX_BASE + k] = amount(names[k]);
        k += 1;
    }
    out
}

/// Delay times in beats for the DLY TIME choice: 1/16 1/8 1/8D 1/4 1/4D 1/2.
pub const DELAY_BEATS: [f32; 6] = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];

/// Global delay/reverb settings, read from the master row each sample.
#[derive(Clone, Copy, Debug)]
pub struct FxGlobals {
    pub delay_beats: f32,
    pub delay_fb: f32,
    pub delay_tone: f32,
    pub rev_size: f32,
    pub rev_decay: f32,
    pub rev_damp: f32,
    pub rev_pre_ms: f32,
    pub bpm: f32,
}

const CHORUS_MS: f32 = 30.0;
const DISPERSE_STAGES: usize = 16;
/// Longest synced time: a 1/2 note at the 20 bpm floor = 6 s.
const DELAY_MAX_S: f32 = 6.1;
const PRE_MAX_S: f32 = 0.11;
/// FDN line lengths at 48 kHz for size 1 (mutually prime-ish).
const REV_LINES: [f32; 4] = [2_389.0, 2_713.0, 3_163.0, 3_571.0];

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
}

/// Mono insert chain of one machine: eight one-knob effects in a user order; amount 0 = bypass.
pub struct FxChain {
    sample_rate: f32,
    order: [u8; FX_COUNT],
    drive: Drive2x,
    filter: Svf,
    comb: Line,
    rng: Rng,
    noise_lp: f32,
    chorus: Line,
    chorus_phase: [f32; 2],
    allpass: [f32; DISPERSE_STAGES],
    delay: Line,
    delay_lp: f32,
    pre: Line,
    rev: [Line; 4],
    rev_lp: [f32; 4],
    level: [Leveler; FX_COUNT],
    level_attack: f32,
    level_release: f32,
    /// Samples each effect has sat at amount 0; after `hold` it is reset and skipped (tails ring out first).
    idle: [u32; FX_COUNT],
    hold: u32,
}

impl FxChain {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        let sr = sample_rate;
        let scale = sr / 48_000.0;
        FxChain {
            sample_rate,
            order: DEFAULT_ORDER,
            drive: Drive2x::new(),
            filter: Svf::new(),
            comb: Line::new((sr / 20.0) as usize + 4),
            rng: Rng::new(seed),
            noise_lp: 0.0,
            chorus: Line::new((CHORUS_MS * 0.001 * sr) as usize + 4),
            chorus_phase: [0.0, 0.37],
            allpass: [0.0; DISPERSE_STAGES],
            delay: Line::new((DELAY_MAX_S * sr) as usize),
            delay_lp: 0.0,
            pre: Line::new((PRE_MAX_S * sr) as usize),
            rev: REV_LINES.map(|l| Line::new((l * scale * 1.05) as usize + 4)),
            rev_lp: [0.0; 4],
            level: [Leveler { gain: 1.0, ..Leveler::default() }; FX_COUNT],
            level_attack: 1.0 - (-1.0 / (0.001 * sr)).exp(),
            level_release: 1.0 - (-1.0 / (0.05 * sr)).exp(),
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

    /// `amounts[id]` in 0..1, `filter_mode` 0/1/2, `pitch_hz` tunes the comb.
    pub fn process(&mut self, x: f32, amounts: &[f32; FX_COUNT], filter_mode: f32, pitch_hz: f32, g: &FxGlobals) -> f32 {
        let mut y = x;
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
            let out = match id {
                DRIVE => self.drive.process(y, a),
                FOLD => fold(y * (1.0 + a), a),
                FILTER => self.filter_fx(y, a, filter_mode, pitch_hz),
                NOISE => self.noise_fx(y, a),
                CHORUS => self.chorus_fx(y, a),
                DISPERSE => self.disperse_fx(y, a),
                DELAY => self.delay_fx(y, a, g),
                _ => self.reverb_fx(y, a, g),
            };
            // Saturators are level-matched dynamically. Noise and the comb compensate statically (a fast
            // leveler would flatten the noise AM and choke the comb's ringing); chorus, disperse and the
            // time effects never add level, they mix wet/dry.
            y = if matches!(id, DRIVE | FOLD) {
                self.level[i].apply(y, out, self.level_attack, self.level_release)
            } else {
                out
            };
        }
        if y.is_finite() { y.clamp(-4.0, 4.0) } else { 0.0 }
    }

    /// Clears one effect's state so a later re-enable starts clean (no stale echoes).
    fn reset(&mut self, id: u8) {
        match id {
            FILTER => {
                self.filter.reset();
                self.comb.buf.fill(0.0);
            }
            CHORUS => self.chorus.buf.fill(0.0),
            DISPERSE => self.allpass = [0.0; DISPERSE_STAGES],
            DELAY => {
                self.delay.buf.fill(0.0);
                self.delay_lp = 0.0;
            }
            REVERB => {
                self.pre.buf.fill(0.0);
                self.rev.iter_mut().for_each(|l| l.buf.fill(0.0));
                self.rev_lp = [0.0; 4];
            }
            _ => {}
        }
        self.level[id as usize] = Leveler { gain: 1.0, ..Leveler::default() };
    }

    fn filter_fx(&mut self, x: f32, a: f32, mode: f32, pitch_hz: f32) -> f32 {
        let sr = self.sample_rate;
        match mode.round() as i32 {
            0 => self.filter.process(x, 20_000.0 * (60.0f32 / 20_000.0).powf(a), 1.0, sr).lp,
            1 => self.filter.process(x, 20.0 * (8_000.0f32 / 20.0).powf(a), 1.0, sr).hp,
            _ => {
                let period = sr / pitch_hz.clamp(25.0, 2_000.0);
                let fb = a * 0.95;
                let y = x + self.comb.read(period) * fb;
                self.comb.push(y);
                x + (y * (1.0 - 0.7 * fb) - x) * a
            }
        }
    }

    fn noise_fx(&mut self, x: f32, a: f32) -> f32 {
        let n = self.rng.bipolar();
        self.noise_lp += (n - self.noise_lp) * 0.03;
        // the low-passed noise has σ² ≈ 0.0051, so the AM adds 0.325·a² of power on average: take it back
        x * (1.0 + a * 8.0 * self.noise_lp) / (1.0 + 0.325 * a * a).sqrt()
    }

    fn chorus_fx(&mut self, x: f32, a: f32) -> f32 {
        let sr = self.sample_rate;
        self.chorus.push(x);
        let mut wet = 0.0;
        for (i, rate) in [0.31_f32, 0.43].into_iter().enumerate() {
            self.chorus_phase[i] = (self.chorus_phase[i] + rate / sr).fract();
            let ms = 9.0 + 4.0 * (self.chorus_phase[i] * TAU).sin();
            wet += self.chorus.read(ms * 0.001 * sr);
        }
        x * (1.0 - 0.5 * a) + wet * 0.5 * a
    }

    fn disperse_fx(&mut self, x: f32, a: f32) -> f32 {
        let c = a * 0.85;
        let mut y = x;
        for s in &mut self.allpass {
            let out = -c * y + *s;
            *s = flush(y + c * out);
            y = out;
        }
        y
    }

    fn delay_fx(&mut self, x: f32, a: f32, g: &FxGlobals) -> f32 {
        let sr = self.sample_rate;
        let samples = g.delay_beats * 60.0 / g.bpm.max(20.0) * sr;
        let tap = self.delay.read(samples);
        self.delay_lp = flush(self.delay_lp + (tap - self.delay_lp) * crate::dsp::one_pole_coef(g.delay_tone, sr));
        self.delay.push(x + self.delay_lp * g.delay_fb);
        x * (1.0 - 0.5 * a) + self.delay_lp * a
    }

    fn reverb_fx(&mut self, x: f32, a: f32, g: &FxGlobals) -> f32 {
        let sr = self.sample_rate;
        let scale = (sr / 48_000.0) * (0.35 + 0.65 * g.rev_size);
        self.pre.push(x);
        let input = self.pre.read((g.rev_pre_ms * 0.001 * sr).max(1.0));
        let damp = 0.05 + 0.9 * (1.0 - g.rev_damp);
        let mut s = [0.0_f32; 4];
        for (i, line) in self.rev.iter().enumerate() {
            let len = REV_LINES[i] * scale;
            let v = line.read(len);
            self.rev_lp[i] = flush(self.rev_lp[i] + (v - self.rev_lp[i]) * damp);
            s[i] = self.rev_lp[i];
        }
        // Householder feedback keeps the four lines decorrelated and energy-preserving.
        let half = 0.5 * (s[0] + s[1] + s[2] + s[3]);
        for (i, line) in self.rev.iter_mut().enumerate() {
            let len = REV_LINES[i] * scale;
            let gain = 10f32.powf(-3.0 * len / (g.rev_decay.max(0.1) * sr));
            line.push(input * 0.35 + (s[i] - half) * gain);
        }
        x * (1.0 - 0.5 * a) + (s[0] + s[1] - s[2] - s[3]) * 0.35 * a
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;
    const G: FxGlobals = FxGlobals {
        delay_beats: 0.5, delay_fb: 0.4, delay_tone: 6_000.0, rev_size: 0.5, rev_decay: 2.0, rev_damp: 0.5, rev_pre_ms: 10.0, bpm: 120.0,
    };

    fn only(id: u8, a: f32) -> [f32; FX_COUNT] {
        let mut v = [0.0; FX_COUNT];
        v[id as usize] = a;
        v
    }

    fn sine(i: usize, f: f32) -> f32 {
        (i as f32 * f * TAU / SR).sin() * 0.5
    }

    #[test]
    fn all_zero_is_an_exact_bypass() {
        let mut c = FxChain::new(SR, 1);
        for i in 0..2_000 {
            let x = sine(i, 220.0);
            assert_eq!(c.process(x, &[0.0; FX_COUNT], 0.0, 110.0, &G), x);
        }
    }

    #[test]
    fn every_effect_stays_finite_and_bounded_at_full_amount() {
        for id in 0..FX_COUNT as u8 {
            for mode in [0.0, 1.0, 2.0] {
                let mut c = FxChain::new(SR, 2);
                for i in 0..24_000 {
                    let y = c.process(if i % 4_800 < 10 { 1.0 } else { sine(i, 80.0) }, &only(id, 1.0), mode, 55.0, &G);
                    assert!(y.is_finite() && y.abs() <= 4.0, "fx {id} mode {mode}: {y}");
                }
            }
        }
    }

    #[test]
    fn gain_staging_keeps_saturators_at_the_input_level() {
        for id in [DRIVE, FOLD, NOISE] {
            let mut c = FxChain::new(SR, 8);
            let n = 48_000;
            let out: Vec<f32> = (0..n).map(|i| c.process(sine(i, 110.0) * 0.1, &only(id, 1.0), 0.0, 0.0, &G)).collect();
            let rms = |v: &[f32]| (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt();
            let input: Vec<f32> = (n / 2..n).map(|i| sine(i, 110.0) * 0.1).collect();
            let db = 20.0 * (rms(&out[n / 2..]) / rms(&input)).log10();
            assert!(db.abs() < 1.0, "fx {id}: {db} dB");
        }
    }

    #[test]
    fn gain_staging_catches_the_first_transient_after_silence() {
        let mut c = FxChain::new(SR, 9);
        let mut a = [0.0; FX_COUNT];
        a[DRIVE as usize] = 1.0;
        for _ in 0..24_000 {
            c.process(0.0, &a, 0.0, 0.0, &G);
        }
        let burst: Vec<f32> = (0..960).map(|i| sine(i, 110.0) * 0.2).collect();
        let out: Vec<f32> = burst.iter().map(|&x| c.process(x, &a, 0.0, 0.0, &G)).collect();
        let rms = |v: &[f32]| (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt();
        let db = 20.0 * (rms(&out) / rms(&burst)).log10();
        assert!(db < 2.0, "first 20 ms {db} dB hotter");
    }

    #[test]
    fn a_disabled_delay_does_not_replay_stale_echoes() {
        let mut c = FxChain::new(SR, 10);
        c.process(1.0, &only(DELAY, 1.0), 0.0, 0.0, &G);
        for _ in 0..(3 * 48_000) {
            c.process(0.0, &[0.0; FX_COUNT], 0.0, 0.0, &G);
        }
        let back: f32 = (0..20_000).map(|_| c.process(0.0, &only(DELAY, 1.0), 0.0, 0.0, &G).abs()).fold(0.0, f32::max);
        assert_eq!(back, 0.0);
    }

    #[test]
    fn delay_repeats_at_the_synced_time() {
        // 1/8 at 120 bpm = 0.25 s = 12 000 samples
        let mut c = FxChain::new(SR, 3);
        let out: Vec<f32> = (0..20_000).map(|i| c.process(if i == 0 { 1.0 } else { 0.0 }, &only(DELAY, 1.0), 0.0, 0.0, &G)).collect();
        let peak = out[1..].iter().enumerate().fold((0, 0.0_f32), |m, (i, v)| if v.abs() > m.1 { (i + 1, v.abs()) } else { m });
        assert_eq!(peak.0, 12_000, "echo at {}", peak.0);
    }

    #[test]
    fn comb_rings_at_the_track_pitch() {
        let mut c = FxChain::new(SR, 4);
        let out: Vec<f32> = (0..9_600).map(|i| c.process(if i == 0 { 1.0 } else { 0.0 }, &only(FILTER, 0.9), 2.0, 100.0, &G)).collect();
        // 100 Hz → 480 samples between resonance peaks
        let corr: f32 = out[480..4_800].iter().zip(&out[..4_320]).map(|(a, b)| a * b).sum();
        assert!(corr > 0.0, "{corr}");
        assert!(out[480].abs() > 0.3, "{}", out[480]);
    }

    #[test]
    fn reverb_has_a_tail_and_order_matters() {
        let mut c = FxChain::new(SR, 5);
        let tail: Vec<f32> = (0..48_000).map(|i| c.process(if i == 0 { 1.0 } else { 0.0 }, &only(REVERB, 1.0), 0.0, 0.0, &G)).collect();
        let late: f32 = tail[24_000..30_000].iter().map(|v| v * v).sum();
        assert!(late > 1.0e-6, "{late}");

        let run = |order: [u8; FX_COUNT]| {
            let mut c = FxChain::new(SR, 6);
            c.set_order(order);
            let mut amounts = [0.0; FX_COUNT];
            amounts[DRIVE as usize] = 1.0;
            amounts[FILTER as usize] = 0.8;
            (0..4_800).map(|i| c.process(sine(i, 110.0) * 2.0, &amounts, 0.0, 0.0, &G)).collect::<Vec<f32>>()
        };
        let a = run([0, 1, 2, 3, 4, 5, 6, 7]);
        let b = run([2, 1, 0, 3, 4, 5, 6, 7]);
        assert!(a.iter().zip(&b).any(|(x, y)| (x - y).abs() > 0.01));
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
