use crate::dsp::Smoother;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Curve {
    Lin,
    Exp,
}

/// UI sends normalised 0..1 values; the engine maps them to real units here.
#[derive(Clone, Copy, Debug)]
pub struct ParamDesc {
    pub name: &'static str,
    pub min: f32,
    pub max: f32,
    pub default_norm: f32,
    pub curve: Curve,
}

impl ParamDesc {
    pub fn map(&self, norm: f32) -> f32 {
        let n = norm.clamp(0.0, 1.0);
        match self.curve {
            Curve::Lin => self.min + (self.max - self.min) * n,
            Curve::Exp => self.min * (self.max / self.min).powf(n),
        }
    }

    /// Inverse of `map`, clamped to 0..1.
    pub fn norm_of(&self, value: f32) -> f32 {
        let n = match self.curve {
            Curve::Lin => (value - self.min) / (self.max - self.min),
            Curve::Exp => (value / self.min).ln() / (self.max / self.min).ln(),
        };
        if n.is_finite() { n.clamp(0.0, 1.0) } else { 0.0 }
    }
}

pub const MAX_PARAMS: usize = 24;

/// Smoothed normalised base values of one machine, bus or master, mapped through its `ParamDesc` table.
pub struct ParamBank {
    descs: &'static [ParamDesc],
    smooth: [Smoother; MAX_PARAMS],
    values: [f32; MAX_PARAMS],
    default_norms: [f32; MAX_PARAMS],
}

impl ParamBank {
    pub fn new(descs: &'static [ParamDesc], sample_rate: f32) -> Self {
        assert!(descs.len() <= MAX_PARAMS, "too many params");
        ParamBank {
            descs,
            smooth: core::array::from_fn(|i| Smoother::new(descs.get(i).map_or(0.0, |d| d.default_norm), 10.0, sample_rate)),
            values: core::array::from_fn(|i| descs.get(i).map_or(0.0, |d| d.map(d.default_norm))),
            default_norms: core::array::from_fn(|i| descs.get(i).map_or(0.0, |d| d.default_norm)),
        }
    }

    /// Overrides one default for this instance (e.g. a per-bus starting level), applied immediately.
    pub fn with_default(mut self, i: usize, norm: f32) -> Self {
        let n = norm.clamp(0.0, 1.0);
        self.default_norms[i] = n;
        self.smooth[i].jump(n);
        self.values[i] = self.descs[i].map(n);
        self
    }

    pub fn count(&self) -> usize {
        self.descs.len()
    }

    pub fn set_norm(&mut self, i: usize, norm: f32) {
        if norm.is_finite() && i < self.descs.len() {
            self.smooth[i].set(norm.clamp(0.0, 1.0));
        }
    }

    pub fn next_norms(&mut self) -> [f32; MAX_PARAMS] {
        let mut out = [0.0; MAX_PARAMS];
        for (i, v) in out.iter_mut().enumerate().take(self.descs.len()) {
            *v = self.smooth[i].next();
        }
        out
    }

    pub fn apply_norms(&mut self, norms: &[f32; MAX_PARAMS]) {
        for (i, d) in self.descs.iter().enumerate() {
            self.values[i] = d.map(norms[i]);
        }
    }

    pub fn advance(&mut self) {
        let norms = self.next_norms();
        self.apply_norms(&norms);
    }

    pub fn get(&self, i: usize) -> f32 {
        self.values[i]
    }

    pub fn defaults(&self) -> [f32; MAX_PARAMS] {
        self.default_norms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_maps_ends_and_middle() {
        let p = ParamDesc { name: "X", min: 0.0, max: 48.0, default_norm: 0.5, curve: Curve::Lin };
        assert_eq!(p.map(0.0), 0.0);
        assert_eq!(p.map(1.0), 48.0);
        assert_eq!(p.map(0.5), 24.0);
    }

    #[test]
    fn exponential_maps_geometric_middle() {
        let p = ParamDesc { name: "F", min: 30.0, max: 120.0, default_norm: 0.5, curve: Curve::Exp };
        assert!((p.map(0.5) - 60.0).abs() < 1e-3);
    }

    #[test]
    fn out_of_range_norm_is_clamped() {
        let p = ParamDesc { name: "X", min: 1.0, max: 2.0, default_norm: 0.0, curve: Curve::Lin };
        assert_eq!(p.map(-3.0), 1.0);
        assert_eq!(p.map(9.0), 2.0);
    }

    const TABLE: [ParamDesc; 2] = [
        ParamDesc { name: "A", min: 0.0, max: 10.0, default_norm: 0.5, curve: Curve::Lin },
        ParamDesc { name: "B", min: 1.0, max: 100.0, default_norm: 0.0, curve: Curve::Exp },
    ];

    #[test]
    fn bank_starts_at_mapped_defaults() {
        let b = ParamBank::new(&TABLE, 48_000.0);
        assert_eq!(b.count(), 2);
        assert_eq!(b.get(0), 5.0);
        assert_eq!(b.get(1), 1.0);
        assert_eq!(b.defaults()[0], 0.5);
        assert_eq!(b.defaults()[5], 0.0);
    }

    #[test]
    fn bank_smooths_and_maps() {
        let mut b = ParamBank::new(&TABLE, 48_000.0);
        b.set_norm(0, 1.0);
        b.advance();
        assert!(b.get(0) > 5.0 && b.get(0) < 5.1);
        for _ in 0..48_000 {
            b.advance();
        }
        assert!((b.get(0) - 10.0).abs() < 1e-3);
    }

    #[test]
    fn bank_ignores_bad_input() {
        let mut b = ParamBank::new(&TABLE, 48_000.0);
        b.set_norm(0, f32::NAN);
        b.set_norm(7, 1.0);
        b.set_norm(1, 3.0);
        for _ in 0..48_000 {
            b.advance();
        }
        assert_eq!(b.get(0), 5.0);
        assert!((b.get(1) - 100.0).abs() < 1e-2);
        assert_eq!(b.next_norms()[7], 0.0);
    }

    #[test]
    fn empty_bank_is_valid() {
        let mut b = ParamBank::new(&[], 48_000.0);
        assert_eq!(b.count(), 0);
        b.advance();
        assert_eq!(b.next_norms(), [0.0; MAX_PARAMS]);
    }
}
