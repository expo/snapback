# Exact numbers: `decimal`, `divmod`

Fractional literals are exact decimal values: `2.50` infers `decimal 2`, so a
standalone return or `amount = 2.50` keeps that descriptor. In a `money USD`
position it means $2.50. Both use the integer `250` on the wire; it is cents,
not a change to the amount. UI formatting divides by the descriptor's scale.
Excess precision refuses instead of rounding.

Integer literals stay integers. Use `10.0` for ten whole decimal/money units;
`10` cannot silently turn into `1000` cents. Zero is exact at every scale.
Already bound values keep their descriptor: no scalar alias or defaulted list
is rescaled because of a later destination. For `values: [decimal 3] <=4 ?`,
write `values ?? [2.000, 3.000]`; `[2, 3]` refuses instead of becoming
`[2000, 3000]`. Supplied minor-unit values pass through unchanged.

Matching brands admit `+ - < <= > >= = != min max`; unary `-` and `* int`
preserve them. Money × decimal → money either order; decimal ×
decimal → left brand; money × money refuses.
`/` and `%` rewrite to `divmod(a, b).quotient` and `.remainder`.

`divmod(a,int)` keeps numeric brands; time gives int. Euclidean remainder is
nonnegative; quotient floors for positive divisors. `share` keeps the amount
brand, needs matching bounded recipients, and gives remainder units in ascending
value order. Wire arguments use integer minor units; seeds normalize
whole-unit JSON numbers or decimal strings, refusing exponents and excess precision.

See `guide quarry` for related topics.
