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

`selected-prefix-shape-first.json` and `selected-prefix-shape-last.json`
are engine-minted unfinished-shape cursors from the same baseline compiler
control. Each reads one item at `lane = 0` and attempts to count 9,000 details
in its returned shape under the default 8,192-row meter. The first request
returns an empty meter-cut page with an inclusive token. Before saving it,
the generator follows it and requires `E_SHAPE_EXCEEDS_METER`.

With only the explicit-index call to `selected_prefix` removed as above:

```sh
EQ_MINT_BASELINE=1 cargo test -p snapback4-lang --test selected_prefix_cursors baseline_minted_unfinished_shape
```

The prefix and `cursor_pins` assertions reject minting with the normalized
compiler. The normal tests do not rewrite the files: they assert the saved
full-key descriptor, mint a different normalized token for the same row, and
require the refusal on the first follow of either encoding, in both directions.
Round-2 mint and pre-fix failure logs are under `reports/20260928-eq/round2/`.
The page continuation regression also tampers with each prefix component of
a freshly minted current-format token and requires `E_INPUT`.
