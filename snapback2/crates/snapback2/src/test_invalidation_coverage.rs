//! Applicability proof for the derived invalidation silence witness.
// @ref LLP 1002#7-test-and-the-receipt — an impossible disjoint commit is named, not fabricated.

use snapback2_core::{AuthoritativeTrace, Generation, ProgramKind};
use std::collections::BTreeSet;

pub(super) fn every_probe_write_is_covered(
    trace: &AuthoritativeTrace,
    generation: &Generation,
) -> bool {
    let covered = trace
        .ranges
        .iter()
        .filter(|range| {
            range.prefix.is_empty()
                && range.after.is_none()
                && range.before.is_none()
                && range.gt.is_none()
                && range.gte.is_none()
                && range.lt.is_none()
                && range.lte.is_none()
        })
        .map(|range| range.table.as_str())
        .collect::<BTreeSet<_>>();
    let mut write_sites = generation
        .programs()
        .values()
        .filter(|(program, _)| program.kind == ProgramKind::Mutation)
        .map(|(_, certificate)| certificate.write_sites.as_slice())
        .peekable();
    write_sites.peek().is_some()
        && write_sites.all(|sites| {
            !sites.is_empty()
                && sites
                    .iter()
                    .all(|site| covered.contains(site.table.as_str()))
        })
}
