CHANGES_REQUIRED

Reviewed candidate `ecb3c6ed058d17f62a85f97b06ce23718467c57b` against original `0236bda88698e98a045c7b05fbe1aef10f35c580`. One material remaining defect.

**[P1] Admission can exempt an ID that the actual rebuild never replaces.** Location: `snapback2/crates/snapback2-core/src/successor.rs:304` and `:314`, interacting with the sequential rebuild at `:562` and projection recomputation at `:750`.

Concrete trigger:

1. The predecessor maintains `aTotals = count events by group`. An event with `group="valid"` produces aggregate ID `k = [{"String":"valid"}]`. An ordinary `zTotals` table contains `{id:k, group:"x", value:9}`, valid under its existing `text <=80` column.
2. The successor replaces the `aTotals` maintain with an ordinary table, preserving its columns/indexes and widening `group` to `text 2..2000`. It adds `maintain zTotals = count aTotals by group`, which inherits that text constraint. Each generation separately satisfies the prohibition against maintained targets also being sources.
3. Admission projects `zTotals` from the existing `aTotals` row and exempts `zTotals[k]` from validation.
4. Rebuilding proceeds in table-name order. It first clears the retired `aTotals` projection. Recomputing the `zTotals` projection now yields no rows or owned IDs, so its existing invalid `group="x"` row survives.

**Static result:** the successor can install with that invalid survivor. The same admission/rebuild mismatch is shared by migration application and changed-schema reopening. The underlying ordering exists in the original; this is a remaining instance of the scoped survivor-admission defect.

**Required outcome:** admission exemptions must match the rows the completed rebuild actually replaces or removes, including transitions where a former target becomes a source. This scenario must refuse `E_SUCCESSOR_ROW_INVALID` and preserve the previous generation, rows, indexes, and sequence. Cover both additive application and an exact mixed-drop migration that must roll back.

I inspected the governing instructions, rules, LLP1000/1001/1002/1016 sections and current operator/Quarry guides; traced certification, source validation, projection ownership, destructive-plan comparison, rebuild constraints, transaction boundaries and owner refusal propagation. The added tests cover ordinary survivors, required fields and preservation, but not this transition.

**Analysis actually executed:** read-only source inspection, verification of 1,915 manifest-listed file hashes and the patch hash, reconstruction of the public witnesses’ generation hashes, and a pure in-memory transcription of the projection/exemption/rebuild ordering. That model demonstrated the mismatched ID sets. It was not a Rust reproduction or compiler run. Six paths containing “review” were conservatively excluded from hashing.

**Supplied execution evidence:** the NEW local reconstruction records two baseline invariant failures, baseline public installation of the violation, candidate refusal/preservation for the supplied scenario, 47 candidate Rust passes, and successful package/caps/ref/diff checks. Baseline public exit 0 asserts the violation; candidate exit 0 asserts refusal/preservation. I did not run those commands. These receipts do not cover the finding above or establish broad, production, scale, phone or publication qualification.

Review-command failures retained: zsh denied heredoc temporary-file creation; `rg` reported four guessed paths absent (`runner_maintains.rs`, `watcher.rs`, `refusal.rs`, `engine/validation.rs`); Python emitted denied temporary-cache diagnostics but completed. Subsequent correct-path reads and Node analyses succeeded. No deadlines were extended or source files changed.