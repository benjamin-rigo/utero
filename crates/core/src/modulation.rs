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
        if self.settings.trig_mode != TrigMode::OneShot {
            self.done = false;
        }
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

pub const MOD_SLOTS: usize = 16;
pub const MAX_ROUTES: usize = 64;
pub const MOD_TRACKS: usize = 13;
pub const MOD_PARAMS: usize = 16;

/// Per-sample fade of route amounts (~10 ms at 48 kHz): adding or removing a route never clicks.
const ROUTE_FADE: f32 = 0.002;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParamRef {
    pub track: u8,
    pub param: u8,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Route {
    pub src: u8,
    pub target: ParamRef,
    pub amount: f32,
}

#[derive(Clone, Copy, Debug)]
struct RouteSlot {
    route: Route,
    current: f32,
    live: bool,
}

pub struct ModMatrix {
    mods: [Modulator; MOD_SLOTS],
    routes: [Option<RouteSlot>; MAX_ROUTES],
    sums: [[f32; MOD_PARAMS]; MOD_TRACKS],
}

impl Default for ModMatrix {
    fn default() -> Self {
        Self::new()
    }
}

impl ModMatrix {
    pub fn new() -> Self {
        ModMatrix {
            mods: core::array::from_fn(|i| Modulator::new(0x000A_11CE + i as u32)),
            routes: [None; MAX_ROUTES],
            sums: [[0.0; MOD_PARAMS]; MOD_TRACKS],
        }
    }

    pub fn set_modulator(&mut self, slot: usize, s: ModSettings) {
        if let Some(m) = self.mods.get_mut(slot) {
            m.set_settings(s);
        }
    }

    pub fn set_step(&mut self, slot: usize, i: usize, v: f32) {
        if let Some(m) = self.mods.get_mut(slot) {
            m.set_step(i, v);
        }
    }

    pub fn set_step_len(&mut self, slot: usize, len: u8) {
        if let Some(m) = self.mods.get_mut(slot) {
            m.set_step_len(len);
        }
    }

    pub fn set_route(&mut self, index: usize, route: Route) {
        let valid = (route.src as usize) < MOD_SLOTS
            && (route.target.track as usize) < MOD_TRACKS
            && (route.target.param as usize) < MOD_PARAMS
            && route.amount.is_finite();
        let Some(slot) = self.routes.get_mut(index) else { return };
        if !valid {
            return;
        }
        let route = Route { amount: route.amount.clamp(-1.0, 1.0), ..route };
        match slot {
            Some(rs) if rs.route.src == route.src && rs.route.target == route.target => {
                rs.route.amount = route.amount;
                rs.live = true;
            }
            _ => *slot = Some(RouteSlot { route, current: 0.0, live: true }),
        }
    }

    pub fn clear_route(&mut self, index: usize) {
        if let Some(Some(rs)) = self.routes.get_mut(index) {
            rs.live = false;
        }
    }

    pub fn restart(&mut self) {
        for m in &mut self.mods {
            m.restart();
        }
    }

    pub fn on_track_trigger(&mut self, track: usize) {
        for m in &mut self.mods {
            let src = m.settings().trig_src;
            if src >= 0 && src as usize == track {
                m.on_trigger();
            }
        }
    }

    /// One sample: advances every modulator and rebuilds the per-target sums.
    pub fn advance(&mut self, bpm: f32, sample_rate: f32) {
        let samples_per_bar = 4.0 * 60.0 / bpm.max(1.0) * sample_rate;
        for m in &mut self.mods {
            let s = m.settings();
            let inc = if s.sync { 1.0 / (SYNC_BARS[s.rate_index as usize] * samples_per_bar) } else { s.hz / sample_rate };
            m.next(inc);
        }
        self.sums = [[0.0; MOD_PARAMS]; MOD_TRACKS];
        for slot in &mut self.routes {
            let Some(rs) = slot else { continue };
            let target = if rs.live { rs.route.amount } else { 0.0 };
            rs.current += (target - rs.current) * ROUTE_FADE;
            if !rs.live && rs.current.abs() < 1.0e-4 {
                *slot = None;
                continue;
            }
            let t = rs.route.target;
            self.sums[t.track as usize][t.param as usize] += rs.current * self.mods[rs.route.src as usize].output();
        }
    }

    pub fn sum(&self, track: usize, param: usize) -> f32 {
        self.sums.get(track).and_then(|row| row.get(param)).copied().unwrap_or(0.0)
    }

    pub fn output(&self, slot: usize) -> f32 {
        self.mods.get(slot).map_or(0.0, |m| m.output())
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
    fn leaving_one_shot_unfreezes() {
        let mut m = Modulator::new(1);
        let ramp = ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, trig_mode: TrigMode::OneShot, ..ModSettings::default() };
        m.set_settings(ramp);
        run(&mut m, 300, 0.01);
        m.set_settings(ModSettings { trig_mode: TrigMode::Free, ..ramp });
        let out = run(&mut m, 10, 0.01);
        assert!(*out.last().unwrap() < 0.5, "{}", out.last().unwrap());
    }

    fn square_mod(m: &mut ModMatrix, slot: usize) {
        // Unsynced 0.01 Hz square: stays at +1 for the first 50 s.
        m.set_modulator(slot, ModSettings { kind: ModKind::Lfo, shape: Shape::Sqr, sync: false, hz: 0.01, ..ModSettings::default() });
    }

    fn advance(m: &mut ModMatrix, n: usize) {
        for _ in 0..n {
            m.advance(120.0, 48_000.0);
        }
    }

    fn route(src: u8, track: u8, param: u8, amount: f32) -> Route {
        Route { src, target: ParamRef { track, param }, amount }
    }

    #[test]
    fn route_adds_scaled_output_after_fade_in() {
        let mut m = ModMatrix::new();
        square_mod(&mut m, 0);
        m.set_route(0, route(0, 0, 3, 0.5));
        advance(&mut m, 1);
        assert!(m.sum(0, 3) < 0.01, "fades in, does not jump");
        advance(&mut m, 4800);
        assert!((m.sum(0, 3) - 0.5).abs() < 0.01);
        assert_eq!(m.sum(0, 2), 0.0);
    }

    #[test]
    fn routes_to_the_same_target_add_up() {
        let mut m = ModMatrix::new();
        square_mod(&mut m, 0);
        square_mod(&mut m, 1);
        m.set_route(0, route(0, 1, 0, 0.25));
        m.set_route(1, route(1, 1, 0, 0.5));
        advance(&mut m, 4800);
        assert!((m.sum(1, 0) - 0.75).abs() < 0.01);
    }

    #[test]
    fn removed_route_fades_out_without_jump() {
        let mut m = ModMatrix::new();
        square_mod(&mut m, 0);
        m.set_route(0, route(0, 0, 0, 1.0));
        advance(&mut m, 4800);
        let mut prev = m.sum(0, 0);
        m.clear_route(0);
        for _ in 0..4800 {
            m.advance(120.0, 48_000.0);
            let s = m.sum(0, 0);
            assert!((prev - s).abs() <= 0.0021, "step {prev} -> {s}");
            prev = s;
        }
        advance(&mut m, 48_000);
        assert_eq!(m.sum(0, 0), 0.0);
    }

    #[test]
    fn invalid_routes_are_ignored() {
        let mut m = ModMatrix::new();
        square_mod(&mut m, 0);
        m.set_route(0, route(99, 0, 0, 0.5));
        m.set_route(1, route(0, 99, 0, 0.5));
        m.set_route(2, route(0, 0, 99, 0.5));
        m.set_route(3, route(0, 0, 0, f32::NAN));
        m.set_route(999, route(0, 0, 0, 0.5));
        m.clear_route(999);
        m.set_modulator(99, ModSettings::default());
        m.set_step(99, 0, 1.0);
        m.set_step_len(99, 4);
        advance(&mut m, 4800);
        assert_eq!(m.sum(0, 0), 0.0);
        assert_eq!(m.sum(99, 99), 0.0);
        assert_eq!(m.output(99), 0.0);
    }

    #[test]
    fn amounts_are_clamped() {
        let mut m = ModMatrix::new();
        square_mod(&mut m, 0);
        m.set_route(0, route(0, 0, 0, 5.0));
        advance(&mut m, 48_000);
        assert!((m.sum(0, 0) - 1.0).abs() < 0.01);
    }

    #[test]
    fn sync_rate_follows_bpm() {
        let mut m = ModMatrix::new();
        // Unipolar ramp = phase; 1 bar at 120 bpm = 2 s = 96 000 samples.
        m.set_modulator(0, ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, bipolar: false, rate_index: 4, ..ModSettings::default() });
        advance(&mut m, 48_000);
        assert!((m.output(0) - 0.5).abs() < 0.01, "{}", m.output(0));
    }

    #[test]
    fn track_trigger_only_restarts_matching_modulators() {
        let mut m = ModMatrix::new();
        for (slot, src) in [(0, 0), (1, 1)] {
            m.set_modulator(slot, ModSettings { kind: ModKind::Lfo, shape: Shape::Ramp, bipolar: false, sync: false, hz: 1.0, trig_mode: TrigMode::Retrig, trig_src: src, ..ModSettings::default() });
        }
        advance(&mut m, 24_000);
        m.on_track_trigger(1);
        advance(&mut m, 1);
        assert!(m.output(1) < 0.01);
        assert!(m.output(0) > 0.4);
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
