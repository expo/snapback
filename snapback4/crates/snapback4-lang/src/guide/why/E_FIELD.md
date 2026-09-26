# Types — E_FIELD

E_FIELD means a runtime field selection has no such field. For example,
a raw object `{ title: 'hello' }` has no `body`; select `title` or construct
the declared object instead. Compile the program so field names are checked,
and narrow an optional row with `row ! else NOT_FOUND` when presence is
required. Ordinary Quarry field access propagates a null base as null;
that is not evidence that the row exists.
