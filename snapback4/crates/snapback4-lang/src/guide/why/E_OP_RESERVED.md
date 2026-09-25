# Programs — E_OP_RESERVED

E_OP_RESERVED means an application's refusal code starts with the
platform's reserved `E_` prefix. For example,
`require allowed else E_AUTH` must use
`require allowed else NOT_MEMBER`. Pick an UPPER_SNAKE application code
at the use site and handle that code on the client. The same rule applies
to a unique index's `else` hook; it does not require adding the code to the
platform registry.
