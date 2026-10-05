//! Connection-local activation tuning with a single low-memory retry.
// @ref LLP 3000.002#implementation-follow-up — cache/sorter workspace is configurable, not an RSS ceiling.
use super::*;

pub(super) const ENV: &str = "SNAPBACK4_ADOPTION_CACHE_MIB";
pub(super) const DEFAULT_MIB: u32 = 64;

fn parse(value: &str) -> Result<u32, RuntimeError> {
    value.parse::<u32>().ok().filter(|mib| *mib <= 512).ok_or_else(|| {
        RuntimeError::Input(format!("{ENV} must be an integer from 0 to 512 MiB; 0 retains the caller's cache setting"))
    })
}

pub(super) fn configured_mib() -> Result<u32, RuntimeError> {
    match std::env::var(ENV) {
        Ok(value) => parse(&value),
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_MIB),
        Err(_) => Err(RuntimeError::Input(format!("{ENV} must contain an integer from 0 to 512 MiB"))),
    }
}

// Keep headroom for Rust row images, SQLite statements and sorters. This is
// deliberately conservative under an address-space limit, not an RSS promise.
fn bounded_bytes(requested: u64, limit: Option<u64>, mapped: Option<u64>) -> u64 {
    match limit {
        Some(limit) => requested.min(limit / 4).min(limit.saturating_sub(mapped.unwrap_or(0)) / 4),
        None => requested,
    }
}

fn address_space() -> (Option<u64>, Option<u64>) {
    #[cfg(target_os = "linux")]
    {
        // procfs avoids introducing unsafe FFI into the core. Missing procfs or
        // an unlimited RLIMIT_AS leaves the explicit caller configuration intact.
        let limit = std::fs::read_to_string("/proc/self/limits").ok().and_then(|s| {
            s.lines().find_map(|line| line.strip_prefix("Max address space")?
                .split_whitespace().next()?.parse::<u64>().ok())
        });
        let mapped = std::fs::read_to_string("/proc/self/status").ok().and_then(|s| {
            s.lines().find_map(|line| line.strip_prefix("VmSize:")?
                .split_whitespace().next()?.parse::<u64>().ok())
        }).map(|kib| kib.saturating_mul(1024));
        (limit, mapped)
    }
    #[cfg(not(target_os = "linux"))]
    { (None, None) }
}

impl Store {
    pub(super) fn with_activation_cache<T>(
        &mut self,
        mib: u32,
        mut attempt: impl FnMut(&mut Self) -> Result<T, RuntimeError>,
    ) -> Result<T, RuntimeError> {
        if mib == 0 { return attempt(self); }
        let schemas = ["main", "temp"];
        let mut original = [0i64; 2];
        let mut bytes = [0u64; 2];
        for (i, schema) in schemas.iter().enumerate() {
            original[i] = self.conn.pragma_query_value(Some(schema), "cache_size", |r| r.get(0))?;
            let page: u64 = self.conn.pragma_query_value(Some(schema), "page_size", |r| r.get::<_, i64>(0))? as u64;
            bytes[i] = if original[i] < 0 { original[i].unsigned_abs().saturating_mul(1024) }
                else { (original[i] as u64).saturating_mul(page) };
        }
        let (limit, mapped) = address_space();
        let requested = u64::from(mib) * 1024 * 1024;
        let budget = bounded_bytes(requested, limit, mapped);
        if budget < requested {
            crate::diagnostic!("snapback4: activation cache target reduced from {mib} MiB to {} KiB for address-space headroom", budget / 1024);
        }
        // A caller that already supplies this much cache keeps both settings.
        if budget <= bytes.iter().sum() { return attempt(self); }
        // Reserve enough temp cache for immediate uniqueness checking during
        // staging. Both caches share the configured target; preserve larger
        // caller settings rather than silently reducing them.
        let target = budget / 2 / 1024;
        let tuned = std::array::from_fn::<_, 2, _>(|i| {
            if target * 1024 > bytes[i] { -(target as i64) } else { original[i] }
        });
        if tuned == original { return attempt(self); }
        let started = std::time::Instant::now();
        let result = (|| {
            for (schema, value) in schemas.iter().zip(tuned) {
                self.conn.pragma_update(Some(schema), "cache_size", value)?;
            }
            attempt(self)
        })();
        let nomem = matches!(&result, Err(RuntimeError::Sql(error))
            if error.sqlite_error_code() == Some(rusqlite::ErrorCode::OutOfMemory));
        // The failed transaction has dropped before we can borrow Store again.
        // Never replay an attempt whose transaction remains open; still restore
        // its cache settings on that defensive error path.
        let retry = nomem && self.conn.is_autocommit();
        let released = if retry {
            self.conn.flush_prepared_statement_cache();
            self.conn.release_memory()
        } else { Ok(()) };
        let mut restored = true;
        for (schema, value) in schemas.iter().zip(original) {
            if let Err(error) = self.conn.pragma_update(Some(schema), "cache_size", value) {
                // A committed activation must not become a reported failure
                // because restoring a connection-local hint failed.
                crate::diagnostic!("snapback4: could not restore activation {schema}.cache_size: {error}");
                restored = false;
            }
        }
        if !restored { return result; }
        if retry {
            released?;
            self.conn.release_memory()?;
            // Autocommit alone does not prove the predecessor is still active.
            // A competing publication (or an ambiguous commit failure) must not
            // be replayed under the old in-memory identity.
            if super::activation::identity(&self.conn)? != self.identity { return result; }
            let failed = started.elapsed();
            crate::diagnostic!("snapback4: activation ran out of SQLite memory; rolled back and retrying once with caller main/temp cache_size={original:?} ({ENV}=0 keeps these settings)");
            let result = attempt(self);
            if result.is_ok() && !self.adoption_report.phases.is_empty() {
                self.adoption_report.phases.insert(0, ("memory fallback (rolled back)", failed));
            }
            result
        } else {
            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_space_headroom_limits_both_caches_together() {
        let mib = 1024 * 1024;
        assert_eq!(bounded_bytes(64 * mib, None, Some(20 * mib)), 64 * mib);
        assert_eq!(bounded_bytes(64 * mib, Some(96 * mib), None), 24 * mib);
        assert_eq!(bounded_bytes(64 * mib, Some(96 * mib), Some(32 * mib)), 16 * mib);
        assert_eq!(bounded_bytes(64 * mib, Some(96 * mib), Some(100 * mib)), 0);
    }

    #[test]
    fn activation_cache_configuration_has_an_explicit_opt_out_and_range() {
        assert_eq!(parse("0").unwrap(), 0);
        assert_eq!(parse("8").unwrap(), 8);
        assert_eq!(parse("512").unwrap(), 512);
        for value in ["", "-1", "513", "1.5", "fast"] { assert!(parse(value).is_err()); }
    }

    #[test]
    fn activation_cache_retries_only_nomem_once_and_respects_caller_settings() {
        for (budget, original, code, expected_calls) in [
            (64, 7, rusqlite::ffi::SQLITE_NOMEM, 2),
            (64, 7, rusqlite::ffi::SQLITE_FULL, 1),
            (0, 7, rusqlite::ffi::SQLITE_NOMEM, 1),
            (64, -131_072, rusqlite::ffi::SQLITE_NOMEM, 1),
            (8, 7, rusqlite::ffi::SQLITE_NOMEM, 2),
        ] {
            let mut store = Store::memory().unwrap();
            store.conn().pragma_update(None, "cache_size", original).unwrap();
            store.conn().pragma_update(Some("temp"), "cache_size", 9).unwrap();
            let mut calls = 0;
            let result: Result<(), RuntimeError> = store.with_activation_cache(budget, |store| {
                calls += 1;
                let expected = if budget != 0 && original == 7 && calls == 1 { -i64::from(budget) * 512 } else { original };
                assert_eq!(store.conn().pragma_query_value(None, "cache_size", |r| r.get::<_, i64>(0)).unwrap(), expected);
                let temp = if budget != 0 && original == 7 && calls == 1 { -i64::from(budget) * 512 } else { 9 };
                assert_eq!(store.conn().pragma_query_value(Some("temp"), "cache_size", |r| r.get::<_, i64>(0)).unwrap(), temp);
                Err(rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(code), None).into())
            });
            assert!(result.is_err());
            assert_eq!(calls, expected_calls);
            assert_eq!(store.conn().pragma_query_value(Some("temp"), "cache_size", |r| r.get::<_, i64>(0)).unwrap(), 9);
            assert_eq!(store.conn().pragma_query_value(None, "cache_size", |r| r.get::<_, i64>(0)).unwrap(), original);
        }
    }
}
