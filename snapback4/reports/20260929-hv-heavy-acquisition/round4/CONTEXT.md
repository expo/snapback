# HV round 4 context

Scope: integrate WD and recover 3,099 B from HV's merged web artifact without
changing row images, shared keys, publication, strict persistence or admission.
Applied llp-orient read-only from lane-sq/vendor/llp/skills/llp-orient/SKILL.md
(the local symlink remains uninitialized). No Snapback 4 foundation link;
3000, 3000.007 and 3000.019 remain in current.

Constraints and rationale:
- LLP 3000#4 and LLP 2000.000#12: independent workspace; fixed commissioned cap.
- LLP 3000.002#proposed-device-representation-and-codec-redesign: size-first
  profile, shared map construction, ObjectFields key-capacity exception;
  optional folding is not counted twice or assumed present on publication Macs.
- LLP 3000.007#20.4: canonical compact images, full ordered key bytes, complete
  indexes before publication/replay, atomic undo, bounded drain and strict save.
- LLP 3000.007#20.4.1: word-index deferral remains unimplemented.
- LLP 3000.015#3: retain saved caller admission and decoder plus witness scratch.

Read rounds 0–3 prompts and reports, existing context and current sync guide.
Round-3 reviews are explicitly deferred to a later commission. Merge origin/main
4226fc9733 in d08c43ed6a: production code merges cleanly, both journal sides
retained, identical folding stages consolidated using WD's reference comment.
No change to delivery await inventory is needed (WD did not touch it).

Risk: iterator changes must preserve empty/gapped ranges, page boundaries,
direction and limit. Existing differential BTreeMap tests plus affected device,
heavy fixture and browser tests protect those semantics. Record each candidate's
actual wasm build. Likely docs: existing persistence LLP and this report/journal.
Hand-off: none. No push or publication.

Decision: select the explicitly authorized exact Binaryen dependency. The source
iterator trial saves only 522 B and is discarded. The pinned optimizer produces
the existing native-Binaryen output exactly, leaving HV runtime code unchanged.
Independent Mac/Linux clean installs and repeats pass the fixed cap. Same-input
optimizer bytes match across hosts; full Rust builds and gzip implementations
still differ. Investigated and appended the existing host-reproducibility ticket,
without claiming that issue solved or retaining the unsuccessful path-remap trial.
