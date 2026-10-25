MATERIAL

1. **Conditional freezes need a separate population-safety rule (§20.2; §21 “Registration and guarded source”).** Treating frozen predicates like read predicates is unsafe under intentional hiding. For example, a visible document freezes its evidence while `exists locks[document = .id]`. Hiding an acknowledged null-bearing lock leaves the document visible but makes the predicate false, permitting edits. Predicate IR equality does not preserve that constraint; positive existence has opposite safety polarity for a freeze versus a grant.

   **Required change:** Include conditional immutability explicitly in writer-time population analysis. Conservatively refuse freezes depending on affected populations unless a closed syntactic rule establishes that hiding cannot enable an otherwise prohibited write. Cover trusted system writes too.

2. **The current-workflow guarantee conflicts with the retained selective strategy (§20.1; §21 “Selection and identity”).** §20 explicitly permits a selective predecessor workflow without independent intent. §21 promises that every default view uses the current authored workflow, including current operations unless paused. The selective strategy does not establish that guarantee. Previously committed selective views also remain selectable through their immutable manifests; digest/CAS validation authenticates those views without establishing current-closure compliance. Redeployment’s registry comparison does not cover direct rollback or restart.

   **Required change:** Explicitly retire or restrict the selective strategy and define admission for existing registered views, refusing incompatible selections with concrete re-registration advice. Alternatively, narrow the current-workflow promise and disclose the actual strategy and operation surface.

These are design findings. No files were edited and no tests were run.
