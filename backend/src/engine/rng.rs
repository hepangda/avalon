use rand::{RngCore, SeedableRng};
use rand_chacha::ChaCha12Rng;
use sha2::{Digest, Sha256};

/// Native random stream. Seeds are UTF-8 SHA-256, with 53 unbiased output bits
/// per floating draw. Replay stores resolved outcomes instead of this algorithm.
#[derive(Clone, Debug)]
pub struct Rng(ChaCha12Rng);
impl Rng {
    pub fn new(seed: &str) -> Self {
        Self(ChaCha12Rng::from_seed(
            Sha256::digest(seed.as_bytes()).into(),
        ))
    }
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        (self.0.next_u64() >> 11) as f64 * (1.0 / 9007199254740992.0)
    }
    pub fn shuffle<T>(&mut self, xs: &mut [T]) {
        for i in (1..xs.len()).rev() {
            let j = (self.next() * (i + 1) as f64).floor() as usize;
            xs.swap(i, j);
        }
    }
}
