import {
  db,
  type DataDiagnosticV1,
  type DataQueryStateV1,
  type DataTransactionHandleV1,
  type DataWatchHandleV1,
} from '@expo/snapback-react/data';

type Todo = Readonly<{ _id: string; title: string; position: number }>;
type TodoDescriptor = Readonly<{
  artifactKind: 'dataQuery';
  readonly __result?: Todo;
}>;
type TodoChunk = Readonly<{
  artifactKind: 'dataTransactionChunk';
  resource: 'todos';
  operation: 'create';
  args: Readonly<{ title: string; position: number }>;
  readonly __result?: Todo;
}>;

declare module '@expo/snapback-react/data' {
  interface SnapbackDataBinding {
    readonly data: Readonly<{
      todos: Readonly<{
        using(index: 'by_owner_position'): Readonly<{
          orderBy(field: 'position', direction: 'asc'): Readonly<{
            take(limit: 2): TodoDescriptor;
          }>;
        }>;
      }>;
      readonly __snapbackDataTypeBinding?: Readonly<{
        tx: Readonly<{
          todos: Readonly<{
            create(args: Readonly<{ title: string; position: number }>): TodoChunk;
          }>;
        }>;
      }>;
    }>;
  }
}

const descriptor = db.todos.using('by_owner_position').orderBy('position', 'asc').take(2);
const query: DataQueryStateV1<Readonly<{ rows: readonly Readonly<Todo>[]; cursor: `dc1.${string}` | null; complete: boolean }>> = db.useQuery(descriptor);
const skipped: 'skipped' = db.useQuery('skip').status;
const watch: DataWatchHandleV1<Readonly<{ rows: readonly Readonly<Todo>[]; cursor: `dc1.${string}` | null; complete: boolean }>> = db.watch(descriptor);
const transaction: DataTransactionHandleV1<readonly [Todo]> = db.transact(
  db.tx.todos.create({ title: 'typed', position: 1 }),
);
const diagnostics: readonly DataDiagnosticV1[] = [query.error].filter(
  (value): value is DataDiagnosticV1 => value !== null,
);

void [skipped, watch, transaction, diagnostics];
