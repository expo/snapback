# Programs — E_OP

E_OP means the requested operation or route does not exist, or was called
through the wrong door. For example, `client.mutate(api.thread, args)`
cannot run a query; use `client.query(api.thread, args)`. Run
`snapback4 check` and use the generated API's module-qualified names.
Call actions with `client.act`; run jobs with `snapback4 run <job> '{}'`
or a schedule, since jobs are not client operations. Check the HTTP path
when the message instead names an unknown route.
