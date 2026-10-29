// @ref LLP 3000.011.003.000.000#3 — generated proofs use the published kit and runtime ports.
// @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — the default embedded recipe observes conservation before app callbacks.
use serde_json::{Value, json};
use super::{Options, pretty};

pub(super) fn without_readme(text: &str) -> &str { text.strip_suffix(README_PROOFS).or_else(|| text.strip_suffix(PREVIOUS_STARTER2_README_PROOFS)).or_else(|| text.strip_suffix(PREVIOUS_49_README_PROOFS)).or_else(|| text.strip_suffix(PREVIOUS_COMPACT_MUSE1_README_PROOFS)).or_else(|| text.strip_suffix(PREVIOUS_MUSE1_README_PROOFS)).or_else(|| text.strip_suffix(PREVIOUS_47_README_PROOFS)).or_else(|| text.strip_suffix(PREVIOUS_SCAFFOLD_README_PROOFS)).or_else(|| text.strip_suffix(PREVIOUS_VER1_README_PROOFS)).or_else(|| text.strip_suffix(PREVIOUS_46_README_PROOFS)).or_else(|| text.strip_suffix(PREVIOUS_40_README_PROOFS)).or_else(|| text.strip_suffix(PREVIOUS_30_README_PROOFS)).or_else(|| text.strip_suffix(PREVIOUS_README_PROOFS)).unwrap_or(text) }
