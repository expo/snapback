# N_RECEIPT_PREDICTION

N_RECEIPT_PREDICTION identifies the first static receipt dependency in a mutation; the whole mutation queues without a predicted row. The compiler follows helpers, aliases, loops and both branches, including untaken branches. Clause-owned fields, receipt builtins, derived maintained columns and aggregates, dependent keys, and whole-row value consumers require server settlement.

Use only clean fields and stable ids to predict. Ordinary sends, joins and creates retain pending rows. Remove an incompatible `predicts:` assertion, which refuses with E_NOT_PREDICTABLE; `snapback4 why <op>` explains the dependency and location. No runtime per-value taint is used. Once provisional allocation touches clause-owned state, any refusal keeps custody in the outbox for the server.
