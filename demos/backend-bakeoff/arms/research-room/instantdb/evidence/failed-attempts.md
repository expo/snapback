# Failed attempts and corrections

1. The first configuration push received an interactive confirmation and
   exited without applying changes in the non-interactive runner. Adding the
   documented global `--yes` flag made the push deterministic. Raw CLI output
   stayed in ignored mode-0600 state.
2. Initial create rules used `newData.ref`. Instant's rule language supports
   `data.ref` during create; `newData.ref` does not exist. The official common
   mistakes guide made the correction explicit.
3. `data.ref` always returns a list, including one-to-one links. Equality
   comparisons were replaced with membership checks.
4. A newly uploaded `$files` row could not be linked while its view rule only
   traversed the not-yet-created reverse source link. Owner-path view access
   resolved that bootstrap dependency while preserving member access after
   linking.
5. The admin Storage response returns the file id under `data.id`, not at the
   top level.
6. Replaying an answer upsert changed the authorization action from create to
   update. The answer update rule was made room-member scoped so stable-id retry
   could remain idempotent.
7. An initial performance write omitted the required question link. The harness
   was corrected and the fresh target was reset exactly before the final run.

These were harness/schema-authoring mistakes, not acceptance failures or Stop
defects. Every retry reset only the fresh arm-owned target.
