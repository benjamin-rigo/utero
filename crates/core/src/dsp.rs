use core::f32::consts::{FRAC_PI_2, PI, TAU};

/// One-pole parameter smoother: avoids zipper noise on continuous params.
#[derive(Clone, Copy, Debug)]
pub struct Smoother {
    cur: f32,
    target: f32,
    coef: f32,
}

impl Smoother {
    pub fn new(value: f32, time_ms: f32, sample_rate: f32) -> Self {
        let coef = if time_ms <= 0.0 {
            1.0
        } else {
            1.0 - (-1.0 / (time_ms * 0.001 * sample_rate)).exp()
        };
        Smoother { cur: value, target: value, coef }
    }

    pub fn set(&mut self, target: f32) {
        self.target = target;
    }

    pub fn next(&mut self) -> f32 {
        self.cur += (self.target - self.cur) * self.coef;
        self.cur
    }

    pub fn value(&self) -> f32 {
        self.cur
    }
}

/// tanh drive at 2x rate (linear-interpolated midpoint, boxcar decimation) to keep aliasing down.
#[derive(Clone, Copy, Debug, Default)]
pub struct Drive2x {
    prev: f32,
}

impl Drive2x {
    pub fn new() -> Self {
        Drive2x { prev: 0.0 }
    }

    pub fn process(&mut self, x: f32, amount: f32) -> f32 {
        let mid = 0.5 * (self.prev + x);
        self.prev = x;
        if amount <= 0.0 {
            return x;
        }
        let g = 1.0 + amount.min(1.0) * 15.0;
        let norm = g.tanh();
        let wet = 0.5 * ((mid * g).tanh() + (x * g).tanh()) / norm;
        // Fade the shaper in over the first 10% so turning DRIVE up from 0 never jumps in level.
        x + (wet - x) * (amount * 10.0).min(1.0)
    }
}

pub fn one_pole_coef(cutoff_hz: f32, sample_rate: f32) -> f32 {
    (1.0 - (-TAU * cutoff_hz / sample_rate).exp()).clamp(1e-6, 1.0)
}

pub fn midi_to_hz(note: f32) -> f32 {
    440.0 * ((note - 69.0) / 12.0).exp2()
}

pub fn db_to_gain(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

pub fn gain_to_db(gain: f32) -> f32 {
    20.0 * gain.max(1.0e-9).log10()
}

/// polyBLEP residual: removes most of the aliasing of a naive saw/pulse edge.
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Osc {
    phase: f32,
}

impl Osc {
    pub fn new() -> Self {
        Osc { phase: 0.0 }
    }

    pub fn reset(&mut self, phase: f32) {
        self.phase = phase.rem_euclid(1.0);
    }

    pub fn phase(&self) -> f32 {
        self.phase
    }

    /// Returns (saw, pulse) for this sample, then advances; `width` is the pulse duty cycle.
    pub fn next(&mut self, freq: f32, sample_rate: f32, width: f32) -> (f32, f32) {
        let dt = (freq / sample_rate).clamp(1.0e-7, 0.5);
        let t = self.phase;
        let w = width.clamp(0.05, 0.95);
        let saw = 2.0 * t - 1.0 - poly_blep(t, dt);
        let naive = if t < w { 1.0 } else { -1.0 };
        let pulse = naive + poly_blep(t, dt) - poly_blep((t + 1.0 - w) % 1.0, dt);
        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        (saw, pulse)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SvfOut {
    pub lp: f32,
    pub bp: f32,
    pub hp: f32,
}

/// Zavalishin TPT state-variable filter: stays stable under per-sample cutoff modulation.
#[derive(Clone, Copy, Debug, Default)]
pub struct Svf {
    ic1: f32,
    ic2: f32,
}

impl Svf {
    pub fn new() -> Self {
        Svf { ic1: 0.0, ic2: 0.0 }
    }

    pub fn reset(&mut self) {
        self.ic1 = 0.0;
        self.ic2 = 0.0;
    }

    /// `damp` is 2·ζ: 2 = no resonance, → 0 = self-oscillation.
    pub fn process(&mut self, x: f32, cutoff: f32, damp: f32, sample_rate: f32) -> SvfOut {
        let g = (PI * (cutoff / sample_rate).clamp(1.0e-5, 0.49)).tan();
        let k = damp.clamp(0.01, 2.0);
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = x - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        if !(self.ic1.is_finite() && self.ic2.is_finite()) {
            self.reset();
            return SvfOut { lp: 0.0, bp: 0.0, hp: 0.0 };
        }
        SvfOut { lp: v2, bp: v1, hp: x - k * v1 - v2 }
    }
}

/// Sine wavefolder, crossfaded in by `amount` so 0 is an exact bypass.
pub fn fold(x: f32, amount: f32) -> f32 {
    if amount <= 0.0 {
        return x;
    }
    let a = amount.min(1.0);
    let folded = (x * (1.0 + a * 5.0) * FRAC_PI_2).sin();
    x + (folded - x) * a
}

/// Portamento in semitones: one-pole towards the target; time 0 jumps.
#[derive(Clone, Copy, Debug)]
pub struct Glide {
    // f64 state so the one-pole reaches the target instead of stalling an f32 ULP short.
    value: f64,
    target: f64,
    coef: f64,
}

impl Glide {
    pub fn new(semis: f32) -> Self {
        let v = semis as f64;
        Glide { value: v, target: v, coef: 1.0 }
    }

    pub fn set_time(&mut self, ms: f32, sample_rate: f32) {
        let (ms, sr) = (ms as f64, sample_rate as f64);
        self.coef = if ms <= 0.0 { 1.0 } else { 1.0 - (-1.0 / (ms * 0.001 * sr)).exp() };
    }

    pub fn set_target(&mut self, semis: f32) {
        self.target = semis as f64;
    }

    pub fn jump(&mut self, semis: f32) {
        self.value = semis as f64;
        self.target = semis as f64;
    }

    pub fn next(&mut self) -> f32 {
        self.value += (self.target - self.value) * self.coef;
        self.value as f32
    }

    pub fn value(&self) -> f32 {
        self.value as f32
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct OnePole {
    z: f32,
}

impl OnePole {
    pub fn lp(&mut self, x: f32, coef: f32) -> f32 {
        self.z += (x - self.z) * coef;
        if !self.z.is_finite() {
            self.z = 0.0;
        }
        self.z
    }
}

/// Transposed direct form II biquad (normalised: a0 = 1).
#[derive(Clone, Copy, Debug)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    pub const fn new(b0: f32, b1: f32, b2: f32, a1: f32, a2: f32) -> Self {
        Biquad { b0, b1, b2, a1, a2, z1: 0.0, z2: 0.0 }
    }

    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoother_glides_to_target_without_jumping() {
        let mut s = Smoother::new(0.0, 10.0, 48_000.0);
        s.set(1.0);
        let first = s.next();
        assert!(first > 0.0 && first < 0.05, "first step {first}");
        for _ in 0..48_000 {
            s.next();
        }
        assert!((s.value() - 1.0).abs() < 1e-4);
    }

    #[test]
    fn smoother_with_zero_time_is_instant() {
        let mut s = Smoother::new(0.0, 0.0, 48_000.0);
        s.set(0.7);
        assert_eq!(s.next(), 0.7);
    }

    #[test]
    fn drive_zero_is_bypass() {
        let mut d = Drive2x::new();
        for x in [-0.9_f32, -0.1, 0.0, 0.3, 1.5] {
            assert_eq!(d.process(x, 0.0), x);
        }
    }

    #[test]
    fn drive_is_bounded_and_keeps_sign() {
        let mut d = Drive2x::new();
        for i in -100..=100 {
            let x = i as f32 / 10.0;
            let y = d.process(x, 1.0);
            assert!(y.abs() <= 1.0 + 1e-6, "x {x} y {y}");
            d = Drive2x::new();
            let y2 = d.process(x, 1.0);
            assert!(x == 0.0 || y2.signum() == x.signum());
        }
    }

    #[test]
    fn one_pole_coef_is_in_unit_range() {
        for fc in [20.0, 200.0, 2_000.0, 20_000.0] {
            let c = one_pole_coef(fc, 48_000.0);
            assert!(c > 0.0 && c <= 1.0);
        }
    }

    fn sine(freq: f32, n: usize) -> Vec<f32> {
        (0..n).map(|i| (TAU * freq * i as f32 / 48_000.0).sin()).collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn unit_conversions() {
        assert!((midi_to_hz(69.0) - 440.0).abs() < 1e-3);
        assert!((midi_to_hz(57.0) - 220.0).abs() < 1e-3);
        assert!((gain_to_db(db_to_gain(-12.0)) + 12.0).abs() < 1e-4);
        assert!((gain_to_db(0.0) + 180.0).abs() < 1e-3);
    }

    #[test]
    fn osc_is_bounded_dc_free_and_on_pitch() {
        let mut o = Osc::new();
        let mut rising = 0;
        let mut prev = 0.0_f32;
        let mut sum = 0.0_f32;
        for _ in 0..48_000 {
            let (saw, pulse) = o.next(100.0, 48_000.0, 0.5);
            assert!(saw.abs() <= 1.05 && pulse.abs() <= 1.05);
            if prev < 0.0 && pulse >= 0.0 {
                rising += 1;
            }
            prev = pulse;
            sum += saw;
        }
        assert!((99..=101).contains(&rising), "{rising}");
        assert!((sum / 48_000.0).abs() < 0.01);
    }

    #[test]
    fn svf_lowpass_and_highpass_separate_bands() {
        let mut f = Svf::new();
        let hi: Vec<f32> = sine(8_000.0, 9_600).iter().map(|&x| f.process(x, 200.0, 1.414, 48_000.0).lp).collect();
        assert!(rms(&hi[4_800..]) < 0.01);
        let mut f = Svf::new();
        let lo: Vec<f32> = sine(50.0, 48_000).iter().map(|&x| f.process(x, 5_000.0, 1.414, 48_000.0).lp).collect();
        let ratio = rms(&lo[9_600..]) / rms(&sine(50.0, 48_000)[9_600..]);
        assert!((0.95..1.05).contains(&ratio), "{ratio}");
        let mut f = Svf::new();
        let thin: Vec<f32> = sine(50.0, 48_000).iter().map(|&x| f.process(x, 2_000.0, 1.414, 48_000.0).hp).collect();
        assert!(rms(&thin[9_600..]) < 0.01);
    }

    #[test]
    fn svf_survives_wild_modulation() {
        let mut f = Svf::new();
        let mut rng = crate::rng::Rng::new(4);
        for _ in 0..48_000 {
            let cutoff = 20.0 * 1000f32.powf(rng.next_f32());
            let out = f.process(rng.bipolar(), cutoff, 0.05, 48_000.0);
            assert!(out.lp.is_finite() && out.bp.is_finite() && out.hp.is_finite());
            assert!(out.lp.abs() < 50.0);
        }
    }

    #[test]
    fn fold_bypasses_at_zero_and_stays_bounded() {
        for i in -10..=10 {
            let x = i as f32 / 10.0;
            assert_eq!(fold(x, 0.0), x);
            assert!(fold(x, 1.0).abs() <= 1.0 + 1e-6);
        }
    }

    #[test]
    fn glide_jumps_at_zero_time_and_slides_otherwise() {
        let mut g = Glide::new(41.0);
        g.set_time(0.0, 48_000.0);
        g.set_target(53.0);
        assert_eq!(g.next(), 53.0);
        let mut g = Glide::new(41.0);
        g.set_time(100.0, 48_000.0);
        g.set_target(53.0);
        assert!(g.next() < 41.5);
        for _ in 0..48_000 {
            g.next();
        }
        assert!((g.value() - 53.0).abs() < 1e-3);
        g.jump(30.0);
        assert_eq!(g.value(), 30.0);
    }

    #[test]
    fn biquad_identity_passes_through() {
        let mut b = Biquad::new(1.0, 0.0, 0.0, 0.0, 0.0);
        for x in [0.3_f32, -0.7, 0.1] {
            assert_eq!(b.process(x), x);
        }
    }
    #[test]
    fn drive_is_continuous_from_zero() {
        let mut a = Drive2x::new();
        let mut b = Drive2x::new();
        for i in 0..100 {
            let x = (i as f32 * 0.07).sin() * 0.5;
            assert!((a.process(x, 0.0) - b.process(x, 1.0e-4)).abs() < 1.0e-3);
        }
    }

}
