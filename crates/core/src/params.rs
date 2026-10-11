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
}
