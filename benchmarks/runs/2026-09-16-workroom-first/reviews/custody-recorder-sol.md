# Shared custody recorder isolation — Sol source review

2026-09-17. Native Codex GPT-5.6 Sol, xhigh, independent original reviewer;
session `01a0b0c3-3991-7771-a0ee-cad63c56a1bc`.
Started 20:08:42.655Z, completed 20:10:05.042Z, exit 0.
Source-only review of the pinned helper repair and current W8 caller.
Helper SHA-256 `32234d430e1235248e19e87795d0bb0d74cd42f1c5da41abe1d0cfdb32bc2a2c`.
The reviewer did not author the repair or receive the peer's findings.

The received public answer follows verbatim. Original answer SHA-256:
`eb9add77d43b40773a6493b0d7ccaf344ca3dfb72c76b58d4e3c1033725f90dc`.

> READY
>
> `ProcessCustody.emit` now isolates recorder exceptions and latches exactly one non-recursive `PILOT_CUSTODY_RECORD_FAILED` uncertainty, allowing cleanup and verified signalling to continue. `_cleanup` recomputes receipt and completion-event status after the final emission, so even a first failure there is non-green. The W8 helper pin matches the revised helper, and its `cleanup.ok === true` gate correctly propagates the uncertainty. No material caller regression found.
