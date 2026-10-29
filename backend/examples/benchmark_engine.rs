//! Measure native typed rules separately from JSON decoding and database I/O.
use avalon_server::engine::{self, CreateGame, GameEvent, PlayerId};
use serde_json::Value;
use std::time::Instant;
fn report(name: &str, mut samples: Vec<u128>) {
    samples.sort_unstable();
    let n = samples.len();
    println!(
        "{name}: samples={n}, p50={:.3}ms p99={:.3}ms max={:.3}ms",
        samples[n / 2] as f64 / 1e6,
        samples[(n * 99 / 100).min(n - 1)] as f64 / 1e6,
        samples[n - 1] as f64 / 1e6
    );
}
fn main() {
    let traces: Vec<Value> = serde_json::from_str(include_str!(
        "../tests/fixtures/resolved-engine-traces.json"
    ))
    .unwrap();
    let (mut cloned, mut owned, mut singles, mut batches) = (vec![], vec![], vec![], vec![]);
    for trace in traces {
        let input: CreateGame = serde_json::from_value(trace["input"].clone()).unwrap();
        let mut viewers: Vec<PlayerId> = input.players.iter().map(|p| p.id.clone()).collect();
        viewers.push("observer".into());
        let mut state = engine::create_game(input).unwrap();
        for step in trace["steps"].as_array().unwrap() {
            let event: GameEvent = serde_json::from_value(step["event"].clone()).unwrap();
            let now = step["now"].as_i64().unwrap();
            let draft = state.clone();
            let start = Instant::now();
            let result = engine::apply_owned(draft, &event, now);
            let elapsed = start.elapsed().as_nanos();
            if result.is_ok() {
                owned.push(elapsed);
            }
            drop(result);
            let start = Instant::now();
            let result = engine::apply_owned(state.clone(), &event, now);
            let elapsed = start.elapsed().as_nanos();
            if let Ok(result) = result {
                cloned.push(elapsed);
                state = result.state;
                let start = Instant::now();
                for viewer in &viewers {
                    std::hint::black_box(engine::project(&state, viewer));
                }
                singles.push(start.elapsed().as_nanos());
                let start = Instant::now();
                std::hint::black_box(engine::project_many(&state, &viewers));
                batches.push(start.elapsed().as_nanos());
            }
        }
    }
    report("native apply including draft clone", cloned);
    report("native apply with existing draft", owned);
    report("native individual projections", singles);
    report("native batch projection", batches);
}
