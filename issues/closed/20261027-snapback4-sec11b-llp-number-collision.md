# Reconcile SEC11b's provisional LLP identity before Integration 29

Status: Resolved
Date: 2026-10-27
Scope: Snapback 4 / excluded sb4-b31-sec11 branch

Integration 28 lands SEC12's evaluable-release-security document as LLP
3000.036.004.002. The still-running SEC11b branch independently uses that
provisional number for approval-act questions. Before 0.4.45 merges it, assign
that unpublished conflicting document a fresh identity and update its live refs;
retain original review artifacts and record provenance. Do not merge it here.

The same branch reserves .003 for assignment scope and .004 for transitions.
SECP's original .001 collision was therefore corrected to final .005, after an
unpublished intermediate .003 assignment. Fifteen security branches were checked
for an existing .005 allocation; none was present. SEC11b, REL3 and SEC13 remain
excluded from this landing.

Resolution (SEC11b, 2026-10-27): assigned the unpublished approval amendment
3000.036.004.006, retaining its same parent/scope. Live annotations and Related
links use the final identity. Original review artifacts and immutable measurement
packets preserve their provisional .002 filenames and provenance. The final
amendment records the mapping. Assignment .003 and transitions .004 remain.
