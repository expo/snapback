# Programs

Keys are positional (`table[value, …]`) or named (`table[column = value, …]`).
Point reads need a unique key; `exists` accepts a prefix. `by index`
disambiguates. Range syntax is `[after cursor] first|last N [by index]`;
repeats/permutations refuse. `first` is ascending. `last` is descending.
Shapes use `{ * }`, fields, or `name: expression`. Nested point reads preserve
page `complete`/`capped`; hidden rows yield `null`. Early exit, count or `require`
inside a shape refuses. Canonical JSON byte bounds price selected fields
(`*` selects all) at declared maxima (text: `4·max + 16`).

See `guide quarry` for related topics.
