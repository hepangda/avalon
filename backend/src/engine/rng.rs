use rand::{RngCore, SeedableRng};
use rand_chacha::ChaCha12Rng;
use sha2::{Digest, Sha256};

/// Native random stream. Seeds are UTF-8 SHA-256, with 53 unbiased output bits
/// per floating draw. Replay stores resolved outcomes instead of this algorithm.
#[derive(Clone, Debug)]
pub struct Rng {
    source: Source,
}
#[derive(Clone, Debug)]
#[allow(clippy::large_enum_variant)] // Keep native RNG on the stack; legacy variant is importer-only.
enum Source {
    Native(ChaCha12Rng),
    #[cfg(feature = "legacy-import")]
    Legacy(LegacyRng),
}
impl Rng {
    pub fn new(seed: &str) -> Self {
        Self {
            source: Source::Native(ChaCha12Rng::from_seed(
                Sha256::digest(seed.as_bytes()).into(),
            )),
        }
    }
    #[cfg(feature = "legacy-import")]
    pub fn legacy(seed: &str) -> Self {
        Self {
            source: Source::Legacy(LegacyRng::new(seed)),
        }
    }
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        match &mut self.source {
            Source::Native(rng) => (rng.next_u64() >> 11) as f64 * (1.0 / 9007199254740992.0),
            #[cfg(feature = "legacy-import")]
            Source::Legacy(rng) => rng.next(),
        }
    }
    pub fn shuffle<T>(&mut self, xs: &mut [T]) {
        for i in (1..xs.len()).rev() {
            let j = (self.next() * (i + 1) as f64).floor() as usize;
            xs.swap(i, j);
        }
    }
}

// Migration-only emulation. Neither the implementation nor its constants are
// compiled into the normal server; enable legacy-import for the offline tool.
#[cfg(feature = "legacy-import")]
#[derive(Clone, Debug)]
struct LegacyRng {
    a: u32,
}
#[cfg(feature = "legacy-import")]
impl LegacyRng {
    fn new(seed: &str) -> Self {
        let mut h = 1779033703u32 ^ (seed.encode_utf16().count() as u32);
        for c in seed.encode_utf16() {
            h = (h ^ (c as u32)).wrapping_mul(3432918353).rotate_left(13);
        }
        h = (h ^ (h >> 16)).wrapping_mul(2246822507);
        h = (h ^ (h >> 13)).wrapping_mul(3266489909);
        h ^= h >> 16;
        Self { a: h }
    }
    fn next(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b79f5);
        let mut t = (self.a ^ (self.a >> 15)).wrapping_mul(1 | self.a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}
