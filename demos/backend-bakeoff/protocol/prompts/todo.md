# Neutral build prompt: Offline shared Todo

Build the frozen Todo shell into a working React web application using
**the assigned backend's idiomatic recommended path**.

Do not introduce a cross-provider repository, gateway, polling loop, or generic
backend interface. Provider SDK calls, schema, policies/rules, functions,
subscriptions, auth, offline configuration, generated code, and deployment
configuration must remain visible in this arm. You may alter the shell only
where the provider requires integration or an acceptance fact requires visible
state; retain accessibility labels and `data-testid` values.

Use the native auth path to create:

- Alice and Bob, members of the primary workspace;
- Mallory, an outsider.

Implement four ordered lists with 25 tasks each in the primary workspace.
Tasks have title, completion, assignee, due date, and stable ordering. Members
can create, edit, complete, reopen, reorder, and delete. Preserve two-client
native realtime, offline retained boot, one queued offline create and update,
reconnect settlement without duplication, a documented concurrent-title
conflict outcome, membership isolation, logout retained-data behavior, and
deterministic seed/cleanup.

Run every scenario in `acceptance/todo.v1.json`. A GAP or unsupported behavior
is a valid honest result but not a pass. Retain authoritative backend checks,
transport attribution, target identity, expected-check count, command results,
and cleanup proof. Stop on an LLP 0102 Stop-class defect.

The timed diagnostic budget is 240 active minutes and 200 tool calls. Freeze
the timed result at the first limit, then continue only as an explicitly
untimed learning extension.
