# The checker — rules every program must satisfy

Snapback compiles each program to a bounded IR and refuses anything it cannot
statically certify. Your submission is checked as written; there is no repair
round. The rules:

1. **Every read is bounded.** A `scan` must carry a literal `take` (or an
   argument with a declared max). Loops may only iterate a page, a bounded
   list argument, `range(a, b)`, or a `recurse(...)` result. `while` and
   recursion are refused (`E_UNBOUND_SCAN`, `E_BOUND`). Pick real bounds; a
   page's `.hasMore` tells the client there was more.

2. **No ambient anything.** `Date`, `Math.random`, `fetch`, timers, and I/O do
   not exist in data programs (`E_AMBIENT_TIME`). The only clocks are
   `ctx.now()` and `ctx.commitTime`; the only id source is `ctx.newId()`.

3. **Two clocks, two jobs.** `ctx.now()` is the *client's intent clock* — use
   it only as a stored timestamp value. Any comparison that grants or denies
   something (expiry, deadline, window) must use `ctx.commitTime`, the
   engine's clock at commit. Comparing `ctx.now()` against a deadline is the
   classic wrong program: the client's clock is attacker-controlled.

4. **Structural facts must be declared.** A reduction — `.count()`, `.sort(...)[0]`
   as a max, a loop tally — over rows whose read visibility is not uniformly
   true for the caller is refused (`E_STRUCTURAL_COUNT`): it would leak a fact
   about rows the caller cannot see. The admitted route for a population fact
   (a total, a maximum, a rank) is a **maintained aggregate**
   (`maintained(name, source)`, read with `db.get`) — exact, complete, and a
   declared disclosure.

5. **A page reduction is never a total.** `.count()` over a bounded page counts
   *the page*, not the population — even over public rows. For display counts
   use `.countCapped()` and render "N+" at the cap; for a real total, maintain
   it. An exact reduction with no bound is refused (`E_UNBOUND_COUNT`).

6. **Absence is a value.** `db.get` returns `null`; handle it. On a
   restricted table (`privateTable`), null does not distinguish "absent" from
   "hidden" — do not branch existence-claims on it.

7. **Writes are guarded explicitly.** The engine enforces read visibility;
   mutations enforce their own authorization with `db.require(cond, "CODE")`
   before writing. Refusal codes are stable SCREAMING_SNAKE strings.

8. **Unique indexes are constraints.** An insert that would duplicate a unique
   index key is refused by the engine at commit — rely on that rather than
   racy check-then-insert where a unique key exists.
