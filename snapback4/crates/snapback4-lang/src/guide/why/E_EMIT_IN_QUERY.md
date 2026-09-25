# Programs — E_EMIT_IN_QUERY

E_EMIT_IN_QUERY means a query tried to enqueue an external effect.
For example, `query send():` cannot contain `emit notify { body: 'hello' }`;
declare `effect notify` and change the operation to `mutation send():`.
Call that mutation for the send intent. Queries may rerun to refresh a
screen, so they only read; mutations and jobs keep emitted effects in
their commit for a worker with a service token to perform (guide effects).
Moving the emit into a helper called by the query does not make it legal.
