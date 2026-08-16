# Generated evidence

The harness writes, per operating system:

- `<date>-phase2-<os>.jsonl`
- `<date>-phase2-<os>.md`
- `<date>-phase2-<os>-<milestone>.png`

Receipts are run output, not fixtures. Bearers appear only as `bearerSha256`;
passwords and recovery-code values must not appear at all. P6 and the final
post-render leakage scan always run; there is no scan-enabling CLI flag.
