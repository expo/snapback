import {
  type FunctionArgs,
  type FunctionResult,
  type LiveQueryHandle,
  type QueryOutput,
  SnapbackClient,
} from "@expo/snapback-client";
import { useAction, useMutation, useQuery } from "@expo/snapback/react";
import { api } from "./generated/api";

type Todo = FunctionResult<typeof api.todos.create>;
type TodoId = FunctionArgs<typeof api.todos.get>["id"];
declare const todoId: TodoId;
declare const client: SnapbackClient;

const point = useQuery(api.todos.get, { id: todoId });
const requiredPoint = useQuery(api.todos.getRequired, { id: todoId });
const list = useQuery(api.todos.list, {});
const recordList = useQuery(api.todos.recordList, {});
const boundedRecords = useQuery(api.todos.boundedRecords, {});
const unionRecords = useQuery(api.todos.unionRecords, {});
const singletonRecord = useQuery(api.todos.singletonRecord, {});
const summary = useQuery(api.todos.summary, {});
const count = useQuery(api.todos.count, {});
const create = useMutation(api.todos.create);
const returnTodoId = useMutation(api.todos.returnTodoId);
const createFromAction = useAction(api.todos.createFromAction);

const pointContract: Todo | null | undefined = point;
const requiredPointContract: Todo | undefined = requiredPoint;
const listContract: readonly Todo[] | undefined = list;
const recordListContract: readonly Readonly<{ title: string }>[] | undefined = recordList;
const boundedRecordsContract: readonly Readonly<{ rank: number }>[] | undefined = boundedRecords;
const unionRecordsContract: readonly (
  | Readonly<{ kind: "title"; title: string }>
  | Readonly<{ kind: "count"; count: number }>
)[] | undefined = unionRecords;
const singletonRecordContract: readonly [Readonly<{ title: string }>] | undefined = singletonRecord;
const summaryContract: Readonly<{ label: string; total: number }> | undefined = summary;
const countContract: number | undefined = count;
const mutationContract: Promise<Todo> = create({ title: "mutation" });
const mutationIdContract: Promise<TodoId> = returnTodoId({ id: todoId });
const actionContract: Promise<Todo> = createFromAction({ title: "action" });
const headlessPointContract: Promise<QueryOutput<Todo | null>> = client.query(
  api.todos.get,
  { args: { id: todoId } },
);
const headlessRequiredPointContract: Promise<QueryOutput<Todo>> = client.query(
  api.todos.getRequired,
  { args: { id: todoId } },
);
const headlessListContract: Promise<QueryOutput<readonly Todo[]>> = client.query(
  api.todos.list,
  { args: {} },
);
const headlessLivePointContract: Promise<LiveQueryHandle<Todo | null>> = client.liveQuery(
  api.todos.get,
  {
    connectionId: "typed-point-query",
    args: { id: todoId },
    onUpdate: (todo) => {
      const updateContract: Todo | null = todo;
      void updateContract;
    },
  },
);

// @ts-expect-error A nullable point result is one document, never a row array.
const wrongPointProjection: readonly Todo[] | undefined = point;

void pointContract;
void requiredPointContract;
void listContract;
void recordListContract;
void boundedRecordsContract;
void unionRecordsContract;
void singletonRecordContract;
void summaryContract;
void countContract;
void mutationContract;
void mutationIdContract;
void actionContract;
void headlessPointContract;
void headlessRequiredPointContract;
void headlessListContract;
void headlessLivePointContract;
void wrongPointProjection;
