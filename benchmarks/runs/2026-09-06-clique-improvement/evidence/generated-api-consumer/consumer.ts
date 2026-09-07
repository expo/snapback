import { api } from "snapback2/client";
type Result = NonNullable<(typeof api.todos.add)["__result"]>;
declare const result: Result;
const done: boolean = result.row.done;
// @ts-expect-error a boolean field is not a number
const wrong: number = result.row.done;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const rowIsNotAny: IsAny<Result["row"]> = false;
void [done, wrong, rowIsNotAny];
