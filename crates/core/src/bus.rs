use crate::dsp::{Drive2x, Svf};
use crate::params::{Curve, ParamBank, ParamDesc};

pub const BUSES: usize = 8;
pub const FILTER: usize = 0;
pub const DRIVE: usize = 1;
pub const LEVEL: usize = 2;
pub const BUS_PARAM_COUNT: usize = 3;

/// Order and default_norm are mirrored in web/src/state/machines.ts.
pub const BUS_PARAMS: [ParamDesc; BUS_PARAM_COUNT] = [
    // DJ filter: < 0.48 low-pass, > 0.52 high-pass, between = bypass
    ParamDesc { name: "FLT", min: 0.0, max: 1.0, default_norm: 0.5, curve: Curve::Lin },
    ParamDesc { name: "DRV", min: 0.0, max: 1.0, default_norm: 0.0, curve: Curve::Lin },
    ParamDesc { name: "LEVEL", min: 0.0, max: 1.0, default_norm: 0.8, curve: Curve::Lin },
];

const DEAD_ZONE: f32 = 0.02;
const FILTER_DAMP: f32 = 1.2;

/// Fader law: 0.8 = 0 dB, 1.0 ≈ +6 dB, 0 = silence.
pub fn fader_gain(norm: f32) -> f32 {
    if norm <= 0.0 {
        0.0
    } else {
        (norm / 0.8).powf(3.1)
    }
}

pub struct Bus {
    pub params: ParamBank,
    sample_rate: f32,
    lp: [Svf; 2],
    hp: [Svf; 2],
    drive: [Drive2x; 2],
    w_lp: f32,
    w_hp: f32,
    mute: f32,
    muted: bool,
    fade: f32,
    peak: f32,
    ms: f32,
    peak_decay: f32,
    ms_coef: f32,
}

impl Bus {
    pub fn new(sample_rate: f32) -> Self {
        Bus {
            params: ParamBank::new(&BUS_PARAMS, sample_rate),
            sample_rate,
            lp: [Svf::new(); 2],
            hp: [Svf::new(); 2],
            drive: [Drive2x::new(); 2],
            w_lp: 0.0,
            w_hp: 0.0,
            mute: 1.0,
            muted: false,
            fade: 1.0 - (-1.0 / (0.005 * sample_rate)).exp(),
            peak: 0.0,
            ms: 0.0,
            peak_decay: (-1.0 / (0.3 * sample_rate)).exp(),
            ms_coef: 1.0 - (-1.0 / (0.3 * sample_rate)).exp(),
        }
    }

    pub fn set_muted(&mut self, on: bool) {
        self.muted = on;
    }

    pub fn muted(&self) -> bool {
        self.muted
    }

    pub fn peak(&self) -> f32 {
        self.peak
    }

    pub fn rms(&self) -> f32 {
        self.ms.sqrt()
    }

    /// One stereo sample. `post` joins after filter and drive (SUB DIRECT) but still gets fader and mute.
    pub fn process(&mut self, l: f32, r: f32, post_l: f32, post_r: f32) -> (f32, f32) {
        let finite = |v: f32| if v.is_finite() { v } else { 0.0 };
        let f = self.params.get(FILTER);
        let want_lp = if f < 0.5 - DEAD_ZONE { 1.0 } else { 0.0 };
        let want_hp = if f > 0.5 + DEAD_ZONE { 1.0 } else { 0.0 };
        self.w_lp += (want_lp - self.w_lp) * self.fade;
        self.w_hp += (want_hp - self.w_hp) * self.fade;
        let span = 0.5 - DEAD_ZONE;
        let lp_cut = 20.0 * 1000f32.powf((f / span).min(1.0));
        let hp_cut = 20.0 * 1000f32.powf(((f - 0.5 - DEAD_ZONE) / span).clamp(0.0, 1.0));
        let drv = self.params.get(DRIVE);
        let gain = fader_gain(self.params.get(LEVEL));
        let want_mute = if self.muted { 0.0 } else { 1.0 };
        self.mute += (want_mute - self.mute) * self.fade;

        let input = [finite(l), finite(r)];
        let post = [finite(post_l), finite(post_r)];
        let mut out = [0.0_f32; 2];
        for c in 0..2 {
            let x = input[c];
            let lo = self.lp[c].process(x, lp_cut, FILTER_DAMP, self.sample_rate).lp;
            let hi = self.hp[c].process(x, hp_cut, FILTER_DAMP, self.sample_rate).hp;
            let filtered = x + (lo - x) * self.w_lp + (hi - x) * self.w_hp;
            out[c] = (self.drive[c].process(filtered, drv) + post[c]) * gain * self.mute;
        }
        let p = out[0].abs().max(out[1].abs());
        self.peak = if p > self.peak { p } else { self.peak * self.peak_decay };
        self.ms += (0.5 * (out[0] * out[0] + out[1] * out[1]) - self.ms) * self.ms_coef;
        (out[0], out[1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::TAU;

    const SR: f32 = 48_000.0;

    fn settle(b: &mut Bus, edits: &[(usize, f32)]) {
        for &(i, v) in edits {
            b.params.set_norm(i, v);
        }
        for _ in 0..4_800 {
            b.params.advance();
            b.process(0.0, 0.0, 0.0, 0.0);
        }
    }

    fn sine(freq: f32, i: usize) -> f32 {
        (TAU * freq * i as f32 / SR).sin()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn fader_law() {
        assert_eq!(fader_gain(0.0), 0.0);
        assert_eq!(fader_gain(0.8), 1.0);
        assert!((fader_gain(1.0) - 2.0).abs() < 0.01);
        assert!((fader_gain(0.4) - 0.116).abs() < 0.005);
        assert_eq!(fader_gain(-1.0), 0.0);
    }

    #[test]
    fn default_bus_is_transparent() {
        let mut b = Bus::new(SR);
        let mut rng = crate::rng::Rng::new(3);
        for _ in 0..1_000 {
            b.params.advance();
            let x = rng.bipolar();
            assert_eq!(b.process(x, -x, 0.0, 0.0), (x, -x));
        }
    }

    #[test]
    fn low_pass_side_darkens() {
        let mut b = Bus::new(SR);
        settle(&mut b, &[(FILTER, 0.1)]);
        let out: Vec<f32> = (0..9_600).map(|i| b.process(sine(5_000.0, i), 0.0, 0.0, 0.0).0).collect();
        assert!(rms(&out[4_800..]) < 0.05);
    }

    #[test]
    fn high_pass_side_thins() {
        let mut b = Bus::new(SR);
        settle(&mut b, &[(FILTER, 0.9)]);
        let out: Vec<f32> = (0..48_000).map(|i| b.process(sine(50.0, i), 0.0, 0.0, 0.0).0).collect();
        assert!(rms(&out[24_000..]) < 0.05);
    }

    #[test]
    fn post_input_skips_the_filter() {
        let mut b = Bus::new(SR);
        settle(&mut b, &[(FILTER, 0.0)]);
        let out: Vec<f32> = (0..9_600).map(|i| b.process(0.0, 0.0, sine(5_000.0, i), 0.0).0).collect();
        assert!(rms(&out[4_800..]) > 0.6);
    }

    #[test]
    fn mute_fades_without_steps() {
        let mut b = Bus::new(SR);
        b.params.advance();
        let mut prev = b.process(0.5, 0.5, 0.0, 0.0).0;
        b.set_muted(true);
        for _ in 0..4_800 {
            let y = b.process(0.5, 0.5, 0.0, 0.0).0;
            assert!((y - prev).abs() < 0.01);
            prev = y;
        }
        assert!(prev.abs() < 1e-3);
        assert!(b.muted());
    }

    #[test]
    fn meters_follow_the_signal() {
        let mut b = Bus::new(SR);
        b.params.advance();
        for _ in 0..48_000 {
            b.process(0.5, 0.5, 0.0, 0.0);
        }
        assert!((b.peak() - 0.5).abs() < 1e-3);
        assert!(b.rms() > 0.3);
    }

    #[test]
    fn non_finite_input_is_dropped() {
        let mut b = Bus::new(SR);
        b.params.advance();
        assert_eq!(b.process(f32::NAN, f32::INFINITY, 0.0, 0.0), (0.0, 0.0));
        assert_eq!(b.process(0.25, 0.25, 0.0, 0.0), (0.25, 0.25));
    }
}
