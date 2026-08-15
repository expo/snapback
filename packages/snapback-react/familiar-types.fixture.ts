import type {
  FunctionReference as ExplicitFunctionReference,
  GeneratedApi as ExplicitGeneratedApi,
} from '../../tests/fixtures/familiar-todo-explicit/generated/api.d.ts';
import type {
  FunctionReference as FamiliarFunctionReference,
  GeneratedApi as FamiliarGeneratedApi,
} from '../../tests/fixtures/familiar-todo/generated/api.d.ts';
import { skip, useAction, useMutation, useQuery, useQueryState } from './familiar.mjs';
import { useSnapbackQuery } from './index.mjs';

declare const familiar: FamiliarGeneratedApi;
declare const explicit: ExplicitGeneratedApi;
declare const familiarRead: FamiliarFunctionReference<
  'todos.read', 'Query', Record<string, never>, readonly [], 'snapback-familiar-ts-v1'
>;
declare const explicitLive: ExplicitFunctionReference<
  'todos.list', 'LiveQuery', { completed: boolean }, readonly [], 'snapback-explicit-v1'
>;

useQuery(familiar['todos.list'], { completed: false });
useQuery(familiar['todos.list'], 'skip');
useQuery(familiar['todos.list'], skip);
useMutation(familiar['todos.create'])({ title: 'typed' });
useAction(familiar['todos.createFromAction'])({ title: 'typed' });
useQueryState(familiar['todos.list'], { completed: false });
useSnapbackQuery(familiar['todos.list'], { completed: false });

// @ts-expect-error read-delivery Query refs have no familiar live hook
useQuery(familiarRead, {});
// @ts-expect-error explicit-profile live refs do not enter the familiar alias
useQuery(explicitLive, {});
// @ts-expect-error generated explicit-profile refs do not enter the familiar alias
useQuery(explicit['todos.list'], { completed: false });
