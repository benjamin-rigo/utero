use crate::bus::fader_gain;
use crate::dsp::{db_to_gain, gain_to_db, Biquad, OnePole, Svf};
use crate::params::{Curve, ParamBank, ParamDesc};

pub const COMP: usize = 0;
pub const ATTACK: usize = 1;
pub const RELEASE: usize = 2;
pub const MIX: usize = 3;
pub const SAT: usize = 4;
pub const CURVE: usize = 5;
pub const TILT: usize = 6;
pub const LOW_CUT: usize = 7;
pub const CEILING: usize = 8;
pub const MODE: usize = 9;
pub const LEVEL: usize = 10;
pub const MASTER_PARAM_COUNT: usize = 11;

/// Order and default_norm are mirrored in web/src/state/machines.ts.
pub const MASTER_PARAMS: [ParamDesc; MASTER_PARAM_COUNT] = [
    // one knob: threshold 0 → −24 dB, ratio 1:1 → 4:1, half-compensated makeup
    ParamDesc { name: "COMP", min: 0.0, max: 1.0, default_norm: 0.2, curve: Curve::Lin },
    ParamDesc { name: "ATK", min: 0.1, max: 30.0, default_norm: 0.6, curve: Curve::Exp },
    ParamDesc { name: "REL", min: 30.0, max: 1000.0, default_norm: 0.5, curve: Curve::Exp },
    ParamDesc { name: "MIX", min: 0.0, max: 1.0, default_norm: 1.0, curve: Curve::Lin },
    ParamDesc { name: "SAT", min: 0.0, max: 1.0, default_norm: 0.1, curve: Curve::Lin },
    ParamDesc { name: "CURVE", min: 0.0, max: 1.0, default_norm: 0.5, curve: Curve::Lin },
    // 0.5 = flat, 0 = −6 dB highs / +6 dB lows, 1 = the opposite
    ParamDesc { name: "TILT", min: 0.0, max: 1.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "LOW CUT", min: 10.0, max: 150.0, default_norm: 0.0, curve: Curve::Exp },
    ParamDesc { name: "CEIL", min: -12.0, max: 0.0, default_norm: 0.975, curve: Curve::Lin },
    // < 0.5 limiter, ≥ 0.5 soft clip
    ParamDesc { name: "MODE", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.8, curve: Curve::Lin },
];

const TILT_HZ: f32 = 800.0;
const LIMIT_RELEASE_S: f32 = 0.05;
/// BS.1770 K-weighting at 48 kHz (pre-filter shelf, then RLB high-pass).
const K1: Biquad = Biquad::new(1.535_124_9, -2.691_696_2, 1.198_392_8, -1.690_659_3, 0.732_480_8);
const K2: Biquad = Biquad::new(1.0, -2.0, 1.0, -1.990_047_5, 0.990_072_25);

fn time_coef(seconds: f32, sample_rate: f32) -> f32 {
    1.0 - (-1.0 / (seconds * sample_rate)).exp()
}

pub struct Master {
    pub params: ParamBank,
    sample_rate: f32,
    low_cut: [Svf; 2],
    tilt: [OnePole; 2],
    tilt_coef: f32,
    gr_db: f32,
    sat_prev: [f32; 2],
    dc: [OnePole; 2],
    dc_coef: f32,
    lim_gain: f32,
    lim_rel: f32,
    k1: [Biquad; 2],
    k2: [Biquad; 2],
    ms: [f32; 2],
    lufs_coef: f32,
    peak: [f32; 2],
    peak_decay: f32,
}

impl Master {
    pub fn new(sample_rate: f32) -> Self {
        Master {
            params: ParamBank::new(&MASTER_PARAMS, sample_rate),
            sample_rate,
            low_cut: [Svf::new(); 2],
            tilt: [OnePole::default(); 2],
            tilt_coef: 1.0 - (-core::f32::consts::TAU * TILT_HZ / sample_rate).exp(),
            gr_db: 0.0,
            sat_prev: [0.0; 2],
            dc: [OnePole::default(); 2],
            dc_coef: 1.0 - (-core::f32::consts::TAU * 5.0 / sample_rate).exp(),
            lim_gain: 1.0,
            lim_rel: time_coef(LIMIT_RELEASE_S, sample_rate),
            k1: [K1; 2],
            k2: [K2; 2],
            ms: [0.0; 2],
            lufs_coef: time_coef(1.5, sample_rate),
            peak: [0.0; 2],
            peak_decay: (-1.0 / (0.3 * sample_rate)).exp(),
        }
    }

    pub fn gr_db(&self) -> f32 {
        self.gr_db
    }

    pub fn peak(&self, channel: usize) -> f32 {
        self.peak.get(channel).copied().unwrap_or(0.0)
    }

    /// Short-term loudness (≈ 1.5 s exponential window instead of BS.1770's 3 s box).
    pub fn lufs(&self) -> f32 {
        let power = self.ms[0] + self.ms[1];
        if power <= 1.0e-10 {
            -70.0
        } else {
            (-0.691 + 10.0 * power.log10()).max(-70.0)
        }
    }

    fn saturate(&mut self, c: usize, x: f32, amount: f32, curve: f32) -> f32 {
        let mid = 0.5 * (self.sat_prev[c] + x);
        self.sat_prev[c] = x;
        if amount <= 0.0 {
            // keep the DC blocker tracking so engaging SAT starts from a settled state
            self.dc[c].lp(x, self.dc_coef);
            return x;
        }
        let g = 1.0 + amount.min(1.0) * 4.0;
        let bias = curve * 0.3;
        let norm = g.tanh();
        // tanh(v)² keeps the even-harmonic bias monotonic: hot negative peaks saturate instead of folding back.
        let shape = |v: f32| {
            let t = v.tanh();
            ((v + bias * t * t) * g).tanh() / norm
        };
        let wet = 0.5 * (shape(mid) + shape(x));
        // blend so the saturator is continuous from zero
        let y = x + (wet - x) * amount.min(1.0);
        y - self.dc[c].lp(y, self.dc_coef)
    }

    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        if !(l.is_finite() && r.is_finite()) {
            return (0.0, 0.0);
        }
        let sr = self.sample_rate;
        let p = &self.params;
        let low_cut = p.get(LOW_CUT);
        let tilt = (p.get(TILT) - 0.5) * 2.0;
        let (low_gain, high_gain) = (db_to_gain(-6.0 * tilt), db_to_gain(6.0 * tilt));
        let amount = p.get(COMP);
        let (attack, release, mix) = (p.get(ATTACK), p.get(RELEASE), p.get(MIX));
        let (sat, curve) = (p.get(SAT), p.get(CURVE));
        let level = fader_gain(p.get(LEVEL));
        let ceiling = db_to_gain(p.get(CEILING));
        let clip = p.get(MODE) >= 0.5;

        // 1) low cut + tilt
        let mut x = [l, r];
        for c in 0..2 {
            let hp = self.low_cut[c].process(x[c], low_cut, 1.414, sr).hp;
            let low = self.tilt[c].lp(hp, self.tilt_coef);
            x[c] = low * low_gain + (hp - low) * high_gain;
        }

        // 2) glue compressor, stereo-linked peak detector in dB
        let threshold = -24.0 * amount;
        let ratio = 1.0 + 3.0 * amount;
        let over = gain_to_db(x[0].abs().max(x[1].abs())) - threshold;
        let target = if over > 0.0 { over * (1.0 - 1.0 / ratio) } else { 0.0 };
        let coef = if target > self.gr_db { time_coef(attack * 0.001, sr) } else { time_coef(release * 0.001, sr) };
        self.gr_db += (target - self.gr_db) * coef;
        let makeup = -threshold * (1.0 - 1.0 / ratio) * 0.5;
        let comp_gain = db_to_gain(makeup - self.gr_db);

        // 3) saturation, 4) level
        for (c, v) in x.iter_mut().enumerate() {
            *v += (*v * comp_gain - *v) * mix;
            *v = self.saturate(c, *v, sat, curve) * level;
        }

        // 5) limiter or soft clip to the ceiling
        if clip {
            for v in &mut x {
                *v = ceiling * (*v / ceiling).tanh();
            }
        } else {
            let peak = x[0].abs().max(x[1].abs());
            let need = if peak > ceiling { ceiling / peak } else { 1.0 };
            if need < self.lim_gain {
                self.lim_gain = need;
            } else {
                self.lim_gain += (1.0 - self.lim_gain) * self.lim_rel;
            }
            for v in &mut x {
                *v *= self.lim_gain;
            }
        }
        for c in 0..2 {
            x[c] = x[c].clamp(-ceiling, ceiling);
            let k = self.k2[c].process(self.k1[c].process(x[c]));
            self.ms[c] += (k * k - self.ms[c]) * self.lufs_coef;
            let a = x[c].abs();
            self.peak[c] = if a > self.peak[c] { a } else { self.peak[c] * self.peak_decay };
        }
        (x[0], x[1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::TAU;

    const SR: f32 = 48_000.0;

    fn master(edits: &[(usize, f32)]) -> Master {
        let mut m = Master::new(SR);
        for &(i, v) in edits {
            m.params.set_norm(i, v);
        }
        for _ in 0..4_800 {
            m.params.advance();
            m.process(0.0, 0.0);
        }
        m
    }

    fn sine(freq: f32, amp: f32, i: usize) -> f32 {
        amp * (TAU * freq * i as f32 / SR).sin()
    }

    fn neutral() -> Master {
        master(&[(COMP, 0.0), (SAT, 0.0), (LOW_CUT, 0.0), (TILT, 0.5), (LEVEL, 0.8), (CEILING, 1.0), (MODE, 0.0)])
    }

    #[test]
    fn neutral_settings_are_transparent() {
        let mut m = neutral();
        let mut sum_in = 0.0;
        let mut sum_out = 0.0;
        for i in 0..48_000 {
            let x = sine(1_000.0, 0.25, i);
            let (y, _) = m.process(x, x);
            if i > 9_600 {
                sum_in += x * x;
                sum_out += y * y;
            }
        }
        let ratio = (sum_out / sum_in as f32).sqrt();
        assert!((0.98..1.02).contains(&ratio), "{ratio}");
    }

    #[test]
    fn limiter_holds_the_ceiling() {
        for mode in [0.0, 1.0] {
            let mut m = master(&[(MODE, mode)]);
            let ceiling = db_to_gain(-0.3);
            for i in 0..48_000 {
                let x = sine(80.0, 4.0, i);
                let (l, r) = m.process(x, -x);
                assert!(l.abs() <= ceiling + 1e-6 && r.abs() <= ceiling + 1e-6, "mode {mode}: {l}");
            }
        }
    }

    #[test]
    fn compressor_reduces_loud_input() {
        let mut m = master(&[(COMP, 1.0)]);
        for i in 0..24_000 {
            let x = sine(200.0, 1.0, i);
            m.process(x, x);
        }
        assert!(m.gr_db() > 6.0, "{}", m.gr_db());
    }

    #[test]
    fn lufs_reads_minus_20_for_a_minus_20_dbfs_sine() {
        let mut m = neutral();
        let a = db_to_gain(-20.0);
        for i in 0..8 * 48_000 {
            let x = sine(997.0, a, i);
            m.process(x, x);
        }
        assert!((m.lufs() + 20.0).abs() < 1.0, "{}", m.lufs());
    }

    #[test]
    fn silence_reads_the_floor() {
        let mut m = neutral();
        for _ in 0..48_000 {
            m.process(0.0, 0.0);
        }
        assert_eq!(m.lufs(), -70.0);
    }

    #[test]
    fn extreme_params_stay_finite_and_bounded() {
        for norm in [0.0_f32, 1.0] {
            let edits: Vec<(usize, f32)> = (0..MASTER_PARAM_COUNT).map(|i| (i, norm)).collect();
            let mut m = master(&edits);
            let ceiling = db_to_gain(MASTER_PARAMS[CEILING].map(norm));
            let mut rng = crate::rng::Rng::new(9);
            for _ in 0..48_000 {
                let (l, r) = m.process(rng.bipolar() * 3.0, rng.bipolar() * 3.0);
                assert!(l.is_finite() && r.is_finite());
                assert!(l.abs() <= ceiling + 1e-6 && r.abs() <= ceiling + 1e-6);
            }
        }
    }

    #[test]
    fn non_finite_input_is_dropped() {
        let mut m = neutral();
        assert_eq!(m.process(f32::NAN, 0.0), (0.0, 0.0));
        let (l, _) = m.process(0.1, 0.1);
        assert!(l.is_finite());
    }
    #[test]
    fn saturation_never_flips_polarity() {
        let mut m = master(&[(SAT, 1.0), (CURVE, 1.0), (COMP, 0.0), (MODE, 1.0), (CEILING, 1.0)]);
        for i in 0..48_000 {
            let x = sine(100.0, 3.0, i);
            let (y, _) = m.process(x, x);
            if i > 4_800 && x < -2.5 {
                assert!(y < 0.0, "x {x} → y {y}");
            }
        }
    }

}
