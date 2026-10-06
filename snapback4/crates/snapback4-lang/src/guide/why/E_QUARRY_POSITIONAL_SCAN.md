# Reads — E_QUARRY_POSITIONAL_SCAN

E_QUARRY_POSITIONAL_SCAN means the argument types do not identify one declared
unique key, or a positional key would scan a population. An `id` or reference
to the target table selects identity; otherwise key column types must accept
the arguments in declared order. Synthesized indexes never decide positions.
Ambiguity lists named forms such as `conversations[slug = x]` and
`conversations[alias = x]`; `check --fix` applies the first context-verified
choice. Check that it names your intended key. Nullable keys still need guards.
Use `posts where .authorId = owner last 20 by .at` for a population.

References keep their table identity: `replies[id = r]` with `r: replies`
reads a reply, while `replies where .postId = p first 20 by .id` with
`p: posts` reads its replies. Using a reference to a different table as this identity
refuses; a declared unique reference column can accept it; a generic `id` does not carry that table-identity check.
An absent, hidden or null point target returns null. A predicate read returns
a page, empty when no visible row matches. A reference does not prove existence.
`snapback4 why <operation>` shows each read's source site, selected index,
column/key bindings, result form and selection reason; the same facts appear
in `check --json` execution sites. These are binder facts, not measured work.
