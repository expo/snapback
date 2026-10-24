//! One reusable, bounded interpreter pool; it never receives a store handle.
use rayon::prelude::*;
use std::sync::OnceLock;

#[cfg(test)]
thread_local! { static SERIAL: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

// @ref LLP 3000.009.001.000.002#3.3 — only private interpretation overlaps; accepting predecessors, authority and publication stay on the committer.
pub(super) fn map<T: Send, R: Send>(items: Vec<T>, run: impl Fn(T) -> R + Sync + Send) -> Vec<R> {
    #[cfg(test)]
    if SERIAL.with(|serial| serial.get()) {
        return items.into_iter().map(run).collect();
    }
    if items.len() < 2 {
        return items.into_iter().map(run).collect();
    }
    static POOL: OnceLock<Option<rayon::ThreadPool>> = OnceLock::new();
    let pool = POOL.get_or_init(|| {
        let workers = std::thread::available_parallelism()
            .map_or(1, |n| n.get().saturating_sub(2).clamp(1, 8));
        if workers < 2 {
            return None;
        }
        rayon::ThreadPoolBuilder::new()
            .num_threads(workers)
            .thread_name(|n| format!("snapback4-wave-{n}"))
            .build()
            .ok()
    });
    match pool {
        Some(pool) => pool.install(|| items.into_par_iter().map(run).collect()),
        None => items.into_iter().map(run).collect(),
    }
}

#[cfg(test)]
pub(in crate::engine) fn serial<T>(run: impl FnOnce() -> T) -> T {
    struct Restore(bool);
    impl Drop for Restore {
        fn drop(&mut self) {
            SERIAL.with(|s| s.set(self.0));
        }
    }
    let _restore = Restore(SERIAL.with(|s| s.replace(true)));
    run()
}

#[cfg(test)]
mod tests {
    #[test]
    fn pool_keeps_input_order_and_uses_bounded_workers() {
        let names = super::map((0..32).collect(), |n| {
            std::thread::sleep(std::time::Duration::from_millis(1));
            (n, std::thread::current().name().unwrap_or("").to_owned())
        });
        assert_eq!(
            names.iter().map(|(n, _)| *n).collect::<Vec<_>>(),
            (0..32).collect::<Vec<_>>()
        );
        let workers = names
            .iter()
            .filter(|(_, name)| name.starts_with("snapback4-wave-"))
            .map(|(_, name)| name)
            .collect::<std::collections::BTreeSet<_>>();
        assert!(workers.len() <= 8);
        if std::thread::available_parallelism().unwrap().get() >= 4 {
            assert!(
                workers.len() > 1,
                "qualification must exercise concurrent workers"
            );
        }
        let here = std::thread::current().id();
        assert_eq!(
            super::map(vec![1], |_| std::thread::current().id()),
            vec![here]
        );
    }
}
