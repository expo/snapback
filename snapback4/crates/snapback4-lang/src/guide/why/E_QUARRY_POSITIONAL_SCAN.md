# Reads — E_QUARRY_POSITIONAL_SCAN

E_QUARRY_POSITIONAL_SCAN means a positional key would scan a population.
Use `posts where .authorId = owner last 20 by .at`; `posts[id = postId]` reads
one id, and named keys such as `profiles[principal = viewer]` read unique keys.

References keep their table identity: `replies[id = r]` with `r: replies`
reads a reply, while `replies where .postId = p first 20 by .id` with
`p: posts` reads its replies. Passing a reference to a different table
refuses; a generic `id` does not carry that table-identity check.
An absent, hidden or null point target returns null. A predicate read returns
a page, empty when no visible row matches. A reference does not prove existence.
`snapback4 why <operation>` shows each read's source site, selected index,
column/key bindings, result form and selection reason; the same facts appear
in `check --json` execution sites. These are binder facts, not measured work.
