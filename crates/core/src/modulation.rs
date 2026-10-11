use core::f32::consts::{PI, TAU};

use crate::rng::Rng;

pub const STEP_COUNT: usize = 16;

/// Sync rates in 4/4 bars. Index order is mirrored by SYNC_LABELS in web/src/state/modulation.ts.
pub const SYNC_BARS: [f32; 10] = [0.0625, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModKind {
    Off,
    Lfo,
    Noise,
    Step,
}

impl ModKind {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => ModKind::Lfo,
            2 => ModKind::Noise,
            3 => ModKind::Step,
            _ => ModKind::Off,
        }
    }
}

/// Codes mirror SHAPES in web/src/state/modulation.ts; the favourites come first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Sin,
    Glide,
    SampleHold,
    Tri,
    Saw,
    Ramp,
    Sqr,
    Exp,
    Drift,
}

impl Shape {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => Shape::Glide,
            2 => Shape::SampleHold,
            3 => Shape::Tri,
            4 => Shape::Saw,
            5 => Shape::Ramp,
            6 => Shape::Sqr,
            7 => Shape::Exp,
            8 => Shape::Drift,
            _ => Shape::Sin,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoiseColor {
    White,
    Pink,
    Crackle,
}

impl NoiseColor {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => NoiseColor::Pink,
            2 => NoiseColor::Crackle,
            _ => NoiseColor::White,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrigMode {
    Free,
    Retrig,
    OneShot,
}

impl TrigMode {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => TrigMode::Retrig,
            2 => TrigMode::OneShot,
            _ => TrigMode::Free,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ModSettings {
    pub kind: ModKind,
    pub shape: Shape,
    pub color: NoiseColor,
    pub sync: bool,
    pub rate_index: u8,
    pub hz: f32,
    pub phase: f32,
    pub bipolar: bool,
    pub trig_mode: TrigMode,
    pub trig_src: i8,
    pub smooth: f32,
    pub depth: f32,
}

impl Default for ModSettings {
    fn default() -> Self {
        ModSettings {
            kind: ModKind::Off,
            shape: Shape::Sin,
            color: NoiseColor::White,
            sync: true,
            rate_index: 6,
            hz: 1.0,
            phase: 0.0,
            bipolar: true,
            trig_mode: TrigMode::Free,
            trig_src: -1,
            smooth: 0.0,
            depth: 1.0,
        }
    }
}

impl ModSettings {
    /// Values arrive from JS unchecked; this keeps every later index and division safe.
    pub fn sanitized(self) -> Self {
        let finite_or = |v: f32, d: f32| if v.is_finite() { v } else { d };
        ModSettings {
            rate_index: self.rate_index.min((SYNC_BARS.len() - 1) as u8),
            hz: finite_or(self.hz, 1.0).clamp(0.01, 40.0),
            phase: finite_or(self.phase, 0.0).rem_euclid(1.0),
            smooth: finite_or(self.smooth, 0.0).clamp(0.0, 1.0),
            depth: finite_or(self.depth, 1.0).clamp(0.0, 1.0),
            trig_src: self.trig_src.max(-1),
            ..self
        }
    }
}

pub struct Modulator {
    settings: ModSettings,
    steps: [f32; STEP_COUNT],
    step_len: u8,
    phase: f32,
    from: f32,
    to: f32,
    smoothed: f32,
    pink: [f32; 3],
    crackle: f32,
    done: bool,
    out: f32,
    rng: Rng,
}

impl Modulator {
    pub fn new(seed: u32) -> Self {
        let mut rng = Rng::new(seed);
        let to = rng.bipolar();
        Modulator {
            settings: ModSettings::default(),
            steps: [0.0; STEP_COUNT],
            step_len: STEP_COUNT as u8,
            phase: 0.0,
            from: 0.0,
            to,
            smoothed: 0.0,
            pink: [0.0; 3],
            crackle: 0.0,
            done: false,
            out: 0.0,
            rng,
        }
    }

    pub fn settings(&self) -> ModSettings {
        self.settings
    }

    pub fn set_settings(&mut self, s: ModSettings) {
        self.settings = s.sanitized();
    }

    pub fn set_step(&mut self, i: usize, v: f32) {
        if let (Some(x), true) = (self.steps.get_mut(i), v.is_finite()) {
            *x = v.clamp(-1.0, 1.0);
        }
    }

    pub fn set_step_len(&mut self, len: u8) {
        self.step_len = len.clamp(1, STEP_COUNT as u8);
    }

    pub fn restart(&mut self) {
        self.phase = self.settings.phase;
        self.done = false;
        self.new_target();
    }

    /// Called when the track named in `trig_src` fires.
    pub fn on_trigger(&mut self) {
        match self.settings.trig_mode {
            TrigMode::Retrig | TrigMode::OneShot => self.restart(),
            TrigMode::Free => {
                if self.settings.shape == Shape::SampleHold {
                    self.new_target();
                }
            }
        }
    }

    pub fn output(&self) -> f32 {
        self.out
    }

    /// Advances by `inc` cycles and returns the output (bipolar −1..1 or unipolar 0..1, times depth).
    pub fn next(&mut self, inc: f32) -> f32 {
        let s = self.settings;
        let raw = match s.kind {
            ModKind::Off => {
                self.out = 0.0;
                return 0.0;
            }
            ModKind::Lfo => self.lfo(s, inc),
            ModKind::Noise => self.noise(s.color),
            ModKind::Step => {
                self.advance_phase(inc);
                let len = self.step_len as usize;
                self.steps[((self.phase * len as f32) as usize).min(len - 1)]
            }
        };
        let k = 1.0 / (1.0 + s.smooth * 2000.0);
        self.smoothed += (raw - self.smoothed) * k;
        let v = if s.bipolar { self.smoothed } else { (self.smoothed + 1.0) * 0.5 };
        self.out = v * s.depth;
        self.out
    }

    fn new_target(&mut self) {
        self.from = self.to;
        self.to = if self.settings.shape == Shape::Drift {
            (self.to + self.rng.bipolar() * 0.5).clamp(-1.0, 1.0)
        } else {
            self.rng.bipolar()
        };
    }

    /// Returns true when the phase wrapped on this sample.
    fn advance_phase(&mut self, inc: f32) -> bool {
        if self.done {
            return false;
        }
        self.phase += inc;
        if self.phase < 1.0 {
            return false;
        }
        if self.settings.trig_mode == TrigMode::OneShot {
            self.phase = 1.0 - f32::EPSILON;
            self.done = true;
            return false;
        }
        self.phase -= self.phase.floor();
        true
    }

    fn lfo(&mut self, s: ModSettings, inc: f32) -> f32 {
        let wrapped = self.advance_phase(inc);
        let random = matches!(s.shape, Shape::Glide | Shape::SampleHold | Shape::Drift);
        let trigger_driven = s.shape == Shape::SampleHold && s.trig_src >= 0;
        if wrapped && random && !trigger_driven {
            self.new_target();
        }
        let p = self.phase;
        match s.shape {
            Shape::Sin => (p * TAU).sin(),
            Shape::Tri => 1.0 - 4.0 * (p - 0.5).abs(),
            Shape::Saw => 1.0 - 2.0 * p,
            Shape::Ramp => 2.0 * p - 1.0,
            Shape::Sqr => {
                if p < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            Shape::Exp => 2.0 * (-5.0 * p).exp() - 1.0,
            Shape::SampleHold => self.to,
            Shape::Glide | Shape::Drift => {
                let t = 0.5 - 0.5 * (p * PI).cos();
                self.from + (self.to - self.from) * t
            }
        }
    }

    fn noise(&mut self, color: NoiseColor) -> f32 {
        let w = self.rng.bipolar();
        match color {
            NoiseColor::White => w,
            NoiseColor::Pink => {
                self.pink[0] = 0.99765 * self.pink[0] + w * 0.099_046;
                self.pink[1] = 0.963 * self.pink[1] + w * 0.296_516_4;
                self.pink[2] = 0.57 * self.pink[2] + w * 1.052_691_3;
                ((self.pink[0] + self.pink[1] + self.pink[2] + w * 0.1848) * 0.25).clamp(-1.0, 1.0)
            }
            NoiseColor::Crackle => {
                // Sparse vinyl-like impulses that die out fast.
                if self.rng.next_f32() < 0.0015 {
                    self.crackle = self.rng.bipolar();
                } else {
                    self.crackle *= 0.9;
                }
                self.crackle
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lfo(shape: Shape) -> Modulator {
        let mut m = Modulator::new(7);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape, ..ModSettings::default() });
        m
    }

    fn run(m: &mut Modulator, n: usize, inc: f32) -> Vec<f32> {
        (0..n).map(|_| m.next(inc)).collect()
    }

    #[test]
    fn off_outputs_zero() {
        let mut m = Modulator::new(1);
        assert!(run(&mut m, 100, 0.01).iter().all(|&v| v == 0.0));
    }

    #[test]
    fn sin_peaks_at_quarter_cycle() {
        let mut m = lfo(Shape::Sin);
        let out = run(&mut m, 100, 1.0 / 400.0);
        assert!((out[99] - 1.0).abs() < 1e-3, "{}", out[99]);
    }

    #[test]
    fn every_shape_stays_in_range() {
        for code in 0..9 {
            let mut m = lfo(Shape::from_code(code));
            for v in run(&mut m, 10_000, 0.01) {
                assert!(v.is_finite() && v.abs() <= 1.0 + 1e-6, "shape {code}: {v}");
            }
        }
    }

    #[test]
    fn unipolar_and_depth_scale_output() {
        let mut m = Modulator::new(1);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape: Shape::Sqr, bipolar: false, depth: 0.5, ..ModSettings::default() });
        let out = run(&mut m, 200, 0.01);
        assert!(out.iter().all(|&v| (0.0..=0.5).contains(&v)));
        assert!(out.iter().any(|&v| v == 0.5) && out.iter().any(|&v| v == 0.0));
    }

    #[test]
    fn sample_hold_holds_within_a_cycle() {
        let mut m = lfo(Shape::SampleHold);
        run(&mut m, 150, 0.01); // past the first wrap, mid-cycle
        let cycle = run(&mut m, 40, 0.01);
        assert!(cycle.windows(2).all(|w| w[0] == w[1]));
    }

    #[test]
    fn sample_hold_with_trigger_source_changes_only_on_trigger() {
        let mut m = Modulator::new(3);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape: Shape::SampleHold, trig_src: 0, ..ModSettings::default() });
        m.on_trigger();
        let held = run(&mut m, 1000, 0.05);
        assert!(held.windows(2).all(|w| w[0] == w[1]));
        let before = m.output();
        m.on_trigger();
        assert_ne!(m.next(0.05), before);
    }

    #[test]
    fn retrig_restarts_phase() {
        let mut m = Modulator::new(1);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, trig_mode: TrigMode::Retrig, ..ModSettings::default() });
        run(&mut m, 50, 0.01);
        m.on_trigger();
        assert!((m.next(0.01) - (-0.98)).abs() < 1e-3);
    }

    #[test]
    fn one_shot_holds_the_end_value() {
        let mut m = Modulator::new(1);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, trig_mode: TrigMode::OneShot, ..ModSettings::default() });
        let out = run(&mut m, 300, 0.01);
        assert!(out[150] > 0.99 && out[299] > 0.99);
    }

    #[test]
    fn step_sequence_plays_its_values() {
        let mut m = Modulator::new(1);
        m.set_settings(ModSettings { kind: ModKind::Step, ..ModSettings::default() });
        m.set_step(0, -1.0);
        m.set_step(1, 1.0);
        m.set_step_len(2);
        let out = run(&mut m, 100, 0.01);
        assert_eq!(out[10], -1.0);
        assert_eq!(out[60], 1.0);
    }

    #[test]
    fn noise_colours_are_bounded() {
        for code in 0..3 {
            let mut m = Modulator::new(9);
            m.set_settings(ModSettings { kind: ModKind::Noise, color: NoiseColor::from_code(code), ..ModSettings::default() });
            assert!(run(&mut m, 48_000, 0.0).iter().all(|v| v.is_finite() && v.abs() <= 1.0));
        }
    }

    #[test]
    fn smoothing_slows_changes() {
        let mut m = Modulator::new(1);
        m.set_settings(ModSettings { kind: ModKind::Lfo, shape: Shape::Sqr, smooth: 1.0, ..ModSettings::default() });
        let out = run(&mut m, 2000, 0.01);
        assert!(out.windows(2).all(|w| (w[1] - w[0]).abs() < 0.01));
    }

    #[test]
    fn sanitized_settings_are_safe() {
        let s = ModSettings { rate_index: 255, hz: f32::NAN, phase: f32::INFINITY, smooth: -3.0, depth: 9.0, trig_src: -100, ..ModSettings::default() }.sanitized();
        assert_eq!(s.rate_index, 9);
        assert_eq!(s.hz, 1.0);
        assert_eq!(s.phase, 0.0);
        assert_eq!(s.smooth, 0.0);
        assert_eq!(s.depth, 1.0);
        assert_eq!(s.trig_src, -1);
    }

    #[test]
    fn same_seed_is_deterministic() {
        let a = run(&mut lfo(Shape::Glide), 5000, 0.01);
        let b = run(&mut lfo(Shape::Glide), 5000, 0.01);
        assert_eq!(a, b);
    }
}
