import {api} from 'snapback2/client';
type Result = NonNullable<(typeof api.todos.add)['__result']>;
declare const result: Result;
const row = result.row;
const done: boolean = row.done;
const wrong: number = row.done;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const rowIsNotAny: IsAny<typeof row> = false;
