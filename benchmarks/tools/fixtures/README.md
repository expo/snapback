# Synthetic checked-publisher fixtures

Every artifact below is synthetic. Values, package versions, evidence IDs,
people, and machines do not describe a real benchmark run.

- `pass/`: three paired successful repetitions with counterbalanced order.
- `missing-evidence-manifest.json`: selects the pass records but points at a
  nonexistent proof receipt, so publication must fail closed.
- `subordinated-manifest.json`: selects two paired pass-fixture repetitions and
  declares an explicitly absent minimum success-rate floor; capability outcomes
  headline and ratios vanish.
- `sanitizer/raw-safe.json`: contains fake private-looking arguments and proves
  they stay in the test private store rather than public output.
- `sanitizer/raw-unsafe-redaction.json`: gives a private path as the entire tool
  name, so safe scrubbing would erase a required audit field and must fail.
