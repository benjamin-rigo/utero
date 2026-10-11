use core::f32::consts::TAU;

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
        0.5 * ((mid * g).tanh() + (x * g).tanh()) / norm
    }
}

pub fn one_pole_coef(cutoff_hz: f32, sample_rate: f32) -> f32 {
    (1.0 - (-TAU * cutoff_hz / sample_rate).exp()).clamp(1e-6, 1.0)
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
}
