# Types — E_OVERFLOW

E_OVERFLOW means integer arithmetic left the value model's range of
−9,007,199,254,740,991 through 9,007,199,254,740,991. For example,
`9007199254740991 + 1` cannot be represented. Bound the inputs and
intermediate arithmetic before adding or multiplying. Decimal and money
columns store integer minor units in that same range; they do not provide
larger integers. For an overflowing aggregate, reduce its contributions or
split the grouping; the refusal names the view and value column without
revealing a hidden computed sum, and the failed write rolls back.
