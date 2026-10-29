//! Allocation profiling only: `cargo run --release --example allocations_engine`.
//! Counts allocation/reallocation calls and requested bytes, not peak live memory.
//! Counter overhead means this example must not be used as a latency benchmark.
use avalon_server::engine;
use serde_json::Value;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
static ENABLED: AtomicBool = AtomicBool::new(false);
static CALLS: AtomicU64 = AtomicU64::new(0);
static BYTES: AtomicU64 = AtomicU64::new(0);
struct Counter;
// SAFETY: all memory operations delegate unchanged to the System allocator.
unsafe impl GlobalAlloc for Counter {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if ENABLED.load(Relaxed) {
            CALLS.fetch_add(1, Relaxed);
            BYTES.fetch_add(layout.size() as u64, Relaxed);
        }
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        if ENABLED.load(Relaxed) {
            CALLS.fetch_add(1, Relaxed);
            BYTES.fetch_add(size as u64, Relaxed);
        }
        unsafe { System.realloc(ptr, layout, size) }
    }
}
#[global_allocator]
static ALLOCATOR: Counter = Counter;
fn measure<T>(work: impl FnOnce() -> T) -> (T, (u64, u64)) {
    CALLS.store(0, Relaxed);
    BYTES.store(0, Relaxed);
    ENABLED.store(true, Relaxed);
    let result = work();
    ENABLED.store(false, Relaxed);
    (result, (CALLS.load(Relaxed), BYTES.load(Relaxed)))
}
fn report(name: &str, samples: &[(u64, u64)]) {
    let mut calls: Vec<_> = samples.iter().map(|v| v.0).collect();
    calls.sort_unstable();
    let mut bytes: Vec<_> = samples.iter().map(|v| v.1).collect();
    bytes.sort_unstable();
    let n = samples.len();
    println!(
        "{name}: {n} samples; allocations p50={} p99={}; requested KiB p50={:.1} p99={:.1}",
        calls[n / 2],
        calls[n * 99 / 100],
        bytes[n / 2] as f64 / 1024.0,
        bytes[n * 99 / 100] as f64 / 1024.0
    );
}
fn main() {
    let traces: Vec<Value> = serde_json::from_str(include_str!(
        "../tests/fixtures/resolved-engine-traces.json"
    ))
    .unwrap();
    let (mut reductions, mut owned, mut projections) = (vec![], vec![], vec![]);
    for trace in traces {
        let input: engine::CreateGame = serde_json::from_value(trace["input"].clone()).unwrap();
        let mut viewers: Vec<engine::PlayerId> =
            input.players.iter().map(|p| p.id.clone()).collect();
        viewers.push("observer".into());
        let mut state = engine::create_game(input).unwrap();
        for step in trace["steps"].as_array().unwrap() {
            let event: engine::GameEvent = serde_json::from_value(step["event"].clone()).unwrap();
            let now = step["now"].as_i64().unwrap();
            let draft = state.clone();
            let (owned_result, counts) =
                measure(|| engine::apply_owned(draft, &event, now).map_err(|(error, _)| error));
            if owned_result.is_ok() {
                owned.push(counts);
            }
            drop(owned_result);
            let (result, counts) = measure(|| {
                engine::apply_owned(state.clone(), &event, now).map_err(|(error, _)| error)
            });
            if let Ok(result) = result {
                state = result.state;
                reductions.push(counts);
                let (views, counts) = measure(|| engine::project_many(&state, &viewers));
                projections.push(counts);
                std::hint::black_box(views);
            }
        }
    }
    report("native apply including draft clone", &reductions);
    report("native apply with existing draft", &owned);
    report("native batch projection", &projections);
}
