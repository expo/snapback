# Actions — E_SERVER_REQUIRED

One `use server` in any module (`schema.q` is usual) enables the whole
project; repeating it is harmless. Actions, routes and schedules naming an
action require it. Effects (including secrets, retry, backoff, deadline and
cancellation), jobs, schedules naming a job and service seats need no directive.
E_SERVER_REQUIRED refuses each gated declaration; its rewrite is `use server`.

One `use server` in any module (`schema.q` is usual) enables the whole
project; repeating it is harmless. Actions, routes and schedules naming an
action require it. Effects (including secrets, retry, backoff, deadline and
cancellation), jobs, schedules naming a job and service seats need no directive.
This block extends the core schema above.
