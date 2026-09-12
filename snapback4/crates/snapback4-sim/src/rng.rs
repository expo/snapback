//! A seeded splitmix64 generator. The only source of entropy in a simulation.

#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn seed(seed: u64) -> Self {
        Rng(seed ^ 0x9E37_79B9_7F4A_7C15)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `[0, 1)`.
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    pub fn chance(&mut self, p: f64) -> bool {
        p > 0.0 && self.unit() < p
    }

    /// Uniform in `[0, n)`; `0` when `n == 0`.
    pub fn below(&mut self, n: u64) -> u64 {
        if n == 0 { 0 } else { self.next_u64() % n }
    }

    /// Uniform in `[lo, hi]`.
    pub fn between(&mut self, lo: u64, hi: u64) -> u64 {
        if hi <= lo { lo } else { lo + self.below(hi - lo + 1) }
    }

    /// An independent stream derived from this one, for a host's private use.
    pub fn fork(&mut self) -> Rng {
        Rng::seed(self.next_u64())
    }
}

#[cfg(test)]
mod tests {
    use super::Rng;

    #[test]
    fn same_seed_same_stream() {
        let mut a = Rng::seed(42);
        let mut b = Rng::seed(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn chance_bounds() {
        let mut r = Rng::seed(1);
        assert!(!r.chance(0.0));
        assert!(r.chance(1.0));
        let hits = (0..10_000).filter(|_| r.chance(0.25)).count();
        assert!((2_000..3_000).contains(&hits), "{hits}");
    }
}
