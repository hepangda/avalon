use anyhow::{Context, Result};
use std::sync::Arc;
use tokio::sync::{Semaphore, oneshot};

/// Bounded CPU admission independent of Tokio's network executor.
#[derive(Clone)]
pub struct CpuPool {
    pool: Arc<rayon::ThreadPool>,
    slots: Arc<Semaphore>,
}

impl CpuPool {
    pub fn new(threads: usize, capacity: usize) -> Result<Self> {
        anyhow::ensure!(threads > 0 && capacity >= threads, "invalid CPU pool size");
        Ok(Self {
            pool: Arc::new(
                rayon::ThreadPoolBuilder::new()
                    .num_threads(threads)
                    .thread_name(|i| format!("avalon-cpu-{i}"))
                    .build()?,
            ),
            slots: Arc::new(Semaphore::new(capacity)),
        })
    }

    pub async fn run<T: Send + 'static>(
        &self,
        job: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T> {
        // Waiting callers remain bounded by HTTP/room admission, rather than
        // spawning one unbounded task per input. A job retains its permit even
        // when its caller disappears, until the actual computation has finished.
        let admitted = std::time::Instant::now();
        let permit = self.slots.clone().acquire_owned().await?;
        let (tx, rx) = oneshot::channel();
        self.pool.spawn(move || {
            let started = std::time::Instant::now();
            let queue_us = started.duration_since(admitted).as_micros() as u64;
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
            tracing::debug!(
                queue_us,
                execution_us = started.elapsed().as_micros() as u64,
                "CPU task completed"
            );
            let _ = tx.send(result);
            drop(permit);
        });
        rx.await
            .context("CPU worker ended")?
            .map_err(|_| anyhow::anyhow!("CPU job panicked"))
    }
}
