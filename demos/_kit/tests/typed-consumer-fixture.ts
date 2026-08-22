// LLP 0032 P3(b): the typed consumer fixture. The tsc gate
// (scripts/check-generated-types) compiles every demo's generated API
// declaration pair through relative .mjs imports, so emitted-invalid-TypeScript
// (the S5.D2 class —
// `updatedAt?: number |` shipped because no TypeScript ever compiled the
// output) and arg-type regressions fail in CI instead of at a consumer.

import type {
  GeneratedApi as TodoApi,
} from '../../todo/snapback/generated/api.mjs';
import type {
  GeneratedApi as TodoV2Api,
} from '../../todo-v2/snapback/generated/api.mjs';
import type {
  GeneratedApi as AllAboardApi,
} from '../../all-aboard/snapback/generated/api.mjs';
import type {
  GeneratedApi as CursorsApi,
} from '../../cursors-web/snapback/generated/api.mjs';
import type {
  GeneratedApi as GraffitiApi,
} from '../../graffiti/snapback/generated/api.mjs';

type ArgsOf<Ref> = Ref extends { readonly __args?: infer Args } ? Args : never;
type ValueOf<Ref> = Ref extends { readonly __value?: infer V } ? V : never;
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

// A real consumer: typed args flow into a call surface.
declare function callFunction<Ref>(reference: Ref, args: ArgsOf<Ref>): Promise<unknown>;
declare const todo: TodoApi;
declare const todoV2: TodoV2Api;
declare const allAboard: AllAboardApi;
declare const cursors: CursorsApi;
declare const graffiti: GraffitiApi;

export async function exerciseTypedConsumers(): Promise<void> {
  await callFunction(todo.createTodo, { title: 'typed' });
  await callFunction(todo.listTodos, {});
  await callFunction(todoV2.listTodos, {});
  await callFunction(graffiti.listCells, { boardId: 'main' });
  // @ts-expect-error — createTodo requires a title; a silent arg-type
  // regression to `unknown` would make this line an error and fail the gate.
  await callFunction(todo.createTodo, {});
  void allAboard;
}

// Pinned type-level facts.
type _todoCreateArgs = Expect<IsExact<ArgsOf<TodoApi['createTodo']>, { title: string }>>;
type _todoListArgs = Expect<IsExact<ArgsOf<TodoApi['listTodos']>, Record<string, never>>>;
type _graffitiListArgs = Expect<IsExact<ArgsOf<GraffitiApi['listCells']>, { boardId: string }>>;
// The S5.D2 regression site: cursors-web's ephemeral value type carries an
// optional field that codegen once emitted as invalid TS (`number |`).
type _cursorsValue = ValueOf<CursorsApi['ephemeral']['webCursors']>;
type _cursorsOptionalField = Expect<
  IsExact<_cursorsValue extends { updatedAt?: infer T } ? T : never, number>
>;
export type TypedConsumerProofs = [_todoCreateArgs, _todoListArgs, _graffitiListArgs, _cursorsOptionalField];
