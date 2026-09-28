# Baseline cursor fixture

`selected-prefix-cursors.json` contains actual engine-minted tokens, not hand
encodings. Generated on the same schema and generation with the pre-EQ compiler
behavior restored: the explicit-index early return in `Requests::read` does
not call `selected_prefix`. No other planner change is needed for these inputs.
The runtime cursor format is unchanged. The test checks the old prefix and
full typed suffix before using each saved token against the normalized plan.

`EQ_MINT_BASELINE=1 cargo test -p snapback4-lang --test selected_prefix_cursors`
regenerates only under that baseline compiler; its prefix assertion rejects
regeneration with normalization enabled. Logs are in
`reports/20260928-eq/round1/mint-baseline-cuts.log`.

The 24 tokens cross first/last, existing prefix/no prefix, argument/literal:
one full page, one examined-meter cut before the matching group, and one cut
past it. The latter cuts return no matching rows. The normal test resumes all
three, walks the full matching group without loss/duplication, tests inclusive
positions and canonical encoding, and rejects invalid table/index/order/column
names/generation/variant/scope and unmarked-plan conversion.
