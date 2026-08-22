import { api } from './generated/api';
import type { FunctionResult, Id } from './generated/api';

const created = null as unknown as FunctionResult<typeof api.createTodo>;
const changed = null as unknown as FunctionResult<typeof api.markDone>;
const document = null as unknown as FunctionResult<typeof api.createAndRead>;
const opaque = null as unknown as FunctionResult<typeof api.echoOpaqueExpression>;

const id: Id<'todos'> = created;
const count: number = changed;
const title: string = document.title;
const unknownResult: unknown = opaque;

void [id, count, title, unknownResult];
