# Shapes

`shape card = { fields }` works on rows/pages/fields; `...card` splices it and
`shape card from cards` imports it. Shapes use their defining module's focal
row/context, never caller locals. Cycles, depth >8, and >4,096 nodes refuse.

See `guide quarry` for related topics.
