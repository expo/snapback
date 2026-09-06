//! Unicode 17 search foundation. No builtin/compiler/runtime activation in this module.
// @ref LLP 1001#unicode-search-foundation — pinned Unicode, independent fields and stable counting passes.
pub use crate::unicode_tables::{
    MAX_DECOMPOSITION_DEPTH, MAX_LOOKUP_PROBES, MAX_NFD_SCALARS, TABLE_DIGEST,
};
use crate::unicode_tables::{compose_pair, decompose_at, range_value, tables};
use std::{collections::HashMap, fmt};
pub const SEARCH_CONTRACT: &str = "u17-nfc-scf-nfc-wsp-p";
/// U=4N and scalar/segment positions fit u32. Independent of field maxima/Q;
/// resource certification imposes much smaller application bounds.
pub const MAX_SEARCH_SOURCE_SCALARS: usize = 0x3fff_ffff;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchInputError(pub &'static str);
impl SearchInputError {
    pub fn code(&self) -> &'static str {
        "E_INPUT"
    }
}
impl fmt::Display for SearchInputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "E_INPUT: {}", self.0)
    }
}
impl std::error::Error for SearchInputError {}

pub fn scalar_length(source: &str, source_max: usize) -> Result<usize, SearchInputError> {
    if source_max > MAX_SEARCH_SOURCE_SCALARS {
        return Err(SearchInputError("invalid search source bound"));
    }
    let n = source.chars().take(source_max + 1).count();
    if n > source_max {
        return Err(SearchInputError(
            "search source exceeds its declared scalar maximum",
        ));
    }
    Ok(n)
}
/// Existing Text input domain, distinct from low-level NFC's full scalar domain.
/// Two scalar validation passes, no scratch; callers price input validation separately.
pub fn validate_search_source(source: &str, source_max: usize) -> Result<usize, SearchInputError> {
    let n = scalar_length(source, source_max)?;
    if source
        .chars()
        .any(|cp| (cp as u32) < 0x20 && !matches!(cp, '\t' | '\n' | '\r'))
    {
        return Err(SearchInputError(
            "search text contains a disallowed control character",
        ));
    }
    Ok(n)
}
/// For byte input boundaries; Rust &str already excludes surrogate scalars and malformed UTF-8.
pub fn scalar_text(source: &[u8], source_max: usize) -> Result<&str, SearchInputError> {
    let text =
        std::str::from_utf8(source).map_err(|_| SearchInputError("invalid Unicode scalar text"))?;
    scalar_length(text, source_max)?;
    Ok(text)
}

/// Logical pass ledger, excluding immutable decoded tables, input and returned strings.
/// A table lookup is at most MAX_LOOKUP_PROBES binary probes under the pinned tables.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NormalizationStats {
    pub input_scalars: usize,
    pub output_scalars: usize,
    pub output_chunks: usize,
    pub decomposition_visits: usize,
    pub reorder_visits: usize,
    pub ccc_bucket_visits: usize,
    pub segment_bucket_visits: usize,
    pub composition_visits: usize,
    pub fold_visits: usize,
    pub table_lookups: usize,
    pub peak_scalars: usize,
    pub scratch_bytes: usize,
}
pub fn normalization_scratch_bytes(source_max: usize) -> Result<usize, SearchInputError> {
    scalar_length("", source_max)?;
    // Shared upper bound: 20U+1028 typed bytes, plus the TS UTF-16 chunk builder's
    // <=4U payload, 24 bytes per 256-unit chunk, and 2080 fixed bytes. Final text
    // is output, not scratch. Rust writes directly into that final output string.
    source_max
        .checked_mul(96)
        .and_then(|n| n.checked_add(3108 + 24 * source_max.div_ceil(32)))
        .ok_or(SearchInputError("invalid search source bound"))
}
pub fn normalization_steps(s: &NormalizationStats) -> usize {
    2 * s.input_scalars
        + s.output_scalars
        + s.output_chunks
        + s.decomposition_visits
        + s.reorder_visits
        + s.ccc_bucket_visits
        + s.segment_bucket_visits
        + s.composition_visits
        + s.fold_visits
        + s.table_lookups
}
/// Named passes plus bounded table lookups as primitives, not CPU cycles.
pub fn normalization_step_bound(source_max: usize) -> Result<usize, SearchInputError> {
    scalar_length("", source_max)?;
    // Two stages: decompose <=2(D+1)U, reorder <=8U, compose <=2U, fold <=U,
    // lookups <=2(D+1)U+9U, output <=U; segment buckets <=4U+4.
    source_max
        .checked_mul(2 + 4 * (4 * (MAX_DECOMPOSITION_DEPTH + 1) + 25))
        .and_then(|n| n.checked_add(1028 + source_max.div_ceil(32)))
        .ok_or(SearchInputError("invalid search source bound"))
}

/// Reuses the same typed buffers between both NFC stages and sequential fields.
pub struct SearchNormalizer {
    a: Box<[u32]>,
    b: Box<[u32]>,
    sa: Box<[u32]>,
    sb: Box<[u32]>,
    counts: Box<[u32]>,
    ccc_counts: [u32; 256],
    len: usize,
    meter: NormalizationStats,
}
impl Default for SearchNormalizer {
    fn default() -> Self {
        Self {
            a: Box::default(),
            b: Box::default(),
            sa: Box::default(),
            sb: Box::default(),
            counts: vec![0].into_boxed_slice(),
            ccc_counts: [0; 256],
            len: 0,
            meter: Default::default(),
        }
    }
}
impl SearchNormalizer {
    pub fn normalize(
        &mut self,
        source: &str,
        source_max: usize,
    ) -> Result<(String, NormalizationStats), SearchInputError> {
        self.run(source, source_max, true)
    }
    pub fn nfc(
        &mut self,
        source: &str,
        source_max: usize,
    ) -> Result<(String, NormalizationStats), SearchInputError> {
        self.run(source, source_max, false)
    }
    fn run(
        &mut self,
        source: &str,
        source_max: usize,
        fold: bool,
    ) -> Result<(String, NormalizationStats), SearchInputError> {
        let n = scalar_length(source, source_max)?;
        let u = n * 4;
        if self.a.len() < u {
            // Drop old buffers before growth; the new allocation never overlaps old scratch.
            self.a = Box::default();
            self.b = Box::default();
            self.sa = Box::default();
            self.sb = Box::default();
            self.counts = Box::default();
            self.a = vec![0; u].into_boxed_slice();
            self.b = vec![0; u].into_boxed_slice();
            self.sa = vec![0; u].into_boxed_slice();
            self.sb = vec![0; u].into_boxed_slice();
            self.counts = vec![0; u + 1].into_boxed_slice();
        }
        self.meter = NormalizationStats {
            input_scalars: n,
            scratch_bytes: 16 * self.a.len() + 4 * self.counts.len() + 1024,
            ..Default::default()
        };
        self.len = n;
        for (i, c) in source.chars().enumerate() {
            self.a[i] = c as u32;
        }
        self.canonical();
        if fold {
            for i in 0..self.len {
                self.meter.fold_visits += 1;
                self.meter.table_lookups += 1;
                self.a[i] = (self.a[i] as i32 + range_value(&tables().folding, self.a[i])) as u32;
            }
            self.canonical();
        }
        self.meter.output_scalars = self.len;
        let mut text = String::with_capacity(self.len * 4);
        for cp in &self.a[..self.len] {
            text.push(char::from_u32(*cp).expect("pinned scalar table"));
        }
        Ok((text, self.meter.clone()))
    }
    fn canonical(&mut self) {
        let mut written = 0;
        for i in 0..self.len {
            decompose(self.a[i], &mut self.b, &mut written, &mut self.meter);
        }
        std::mem::swap(&mut self.a, &mut self.b);
        self.len = written;
        self.meter.peak_scalars = self.meter.peak_scalars.max(written);
        // R2: stable CCC pass, then stable starter-segment pass; leading marks use segment 0.
        self.ccc_counts.fill(0);
        self.meter.ccc_bucket_visits += 256;
        let mut segment = 0;
        for i in 0..written {
            self.meter.table_lookups += 1;
            self.meter.reorder_visits += 1;
            let cls = range_value(&tables().combining, self.a[i]) as usize;
            if cls == 0 {
                segment += 1;
            }
            self.sa[i] = segment;
            self.ccc_counts[cls] += 1;
        }
        let mut sum = 0;
        for count in &mut self.ccc_counts {
            let n = *count;
            *count = sum;
            sum += n;
        }
        self.meter.ccc_bucket_visits += 256;
        for i in 0..written {
            self.meter.table_lookups += 1;
            self.meter.reorder_visits += 1;
            let cls = range_value(&tables().combining, self.a[i]) as usize;
            let pos = self.ccc_counts[cls] as usize;
            self.ccc_counts[cls] += 1;
            self.b[pos] = self.a[i];
            self.sb[pos] = self.sa[i];
        }
        let count_len = segment as usize + 1;
        self.counts[..count_len].fill(0);
        self.meter.segment_bucket_visits += count_len;
        for i in 0..written {
            self.counts[self.sb[i] as usize] += 1;
            self.meter.reorder_visits += 1;
        }
        sum = 0;
        for count in &mut self.counts[..count_len] {
            let n = *count;
            *count = sum;
            sum += n;
        }
        self.meter.segment_bucket_visits += count_len;
        for i in 0..written {
            let pos = &mut self.counts[self.sb[i] as usize];
            self.a[*pos as usize] = self.b[i];
            *pos += 1;
            self.meter.reorder_visits += 1;
        }
        let (mut out, mut starter, mut last) = (0, None, 0);
        for i in 0..written {
            let cp = self.a[i];
            self.meter.composition_visits += 1;
            self.meter.table_lookups += 1;
            let cls = range_value(&tables().combining, cp);
            let composite = starter
                .filter(|_| last == 0 || last < cls)
                .and_then(|at: usize| {
                    self.meter.table_lookups += 1;
                    compose_pair(self.a[at], cp)
                });
            if let Some(composite) = composite {
                self.a[starter.unwrap()] = composite;
            } else {
                self.a[out] = cp;
                if cls == 0 {
                    starter = Some(out);
                }
                out += 1;
                last = cls;
            }
        }
        self.len = out;
    }
}
fn decompose(cp: u32, out: &mut [u32], len: &mut usize, meter: &mut NormalizationStats) {
    meter.decomposition_visits += 1;
    if (0xac00..=0xd7a3).contains(&cp) {
        let x = cp - 0xac00;
        out[*len] = 0x1100 + x / 588;
        out[*len + 1] = 0x1161 + (x % 588) / 28;
        *len += 2;
        if x % 28 != 0 {
            out[*len] = 0x11a7 + x % 28;
            *len += 1;
        }
    } else {
        meter.table_lookups += 1;
        if let Some(ds) = decompose_at(cp) {
            for child in &ds[1..=ds[3] as usize] {
                decompose(*child, out, len, meter);
            }
        } else {
            out[*len] = cp;
            *len += 1;
        }
    }
}
pub fn normalize_search(source: &str, source_max: usize) -> Result<String, SearchInputError> {
    SearchNormalizer::default()
        .normalize(source, source_max)
        .map(|v| v.0)
}
pub fn is_search_boundary(cp: char) -> bool {
    range_value(&tables().boundaries, cp as u32) != 0
}
pub fn search_words(
    source: Option<&str>,
    source_max: usize,
) -> Result<Vec<String>, SearchInputError> {
    search_field_words(&[(source, source_max)])
}
pub fn search_field_words(
    fields: &[(Option<&str>, usize)],
) -> Result<Vec<String>, SearchInputError> {
    let mut normalizer = SearchNormalizer::default();
    let mut seen = HashMap::new();
    for (source, source_max) in fields {
        scalar_length("", *source_max)?;
        if let Some(source) = source {
            validate_search_source(source, *source_max)?;
            let (text, _) = normalizer.normalize(source, *source_max)?;
            for word in text.split(is_search_boundary).filter(|s| !s.is_empty()) {
                let next = seen.len();
                seen.entry(word.to_owned()).or_insert(next);
            }
        }
    }
    let mut words = vec![String::new(); seen.len()];
    for (word, position) in seen {
        words[position] = word;
    }
    Ok(words)
}
/// None is empty search, never a wildcard. Token occurrences are counted before any deduplication.
pub fn search_query_token(
    source: &str,
    source_max: usize,
    normalizer: &mut SearchNormalizer,
) -> Result<Option<String>, SearchInputError> {
    validate_search_source(source, source_max)?;
    let (text, _) = normalizer.normalize(source, source_max)?;
    let mut tokens = text.split(is_search_boundary).filter(|s| !s.is_empty());
    let first = tokens.next();
    if tokens.next().is_some() {
        return Err(SearchInputError("search one word"));
    }
    Ok(first.map(str::to_owned))
}

#[cfg(test)]
#[path = "unicode_tests.rs"]
mod tests;
