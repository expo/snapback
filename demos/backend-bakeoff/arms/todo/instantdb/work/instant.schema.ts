import { i } from "@instantdb/core";

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    workspaces: i.entity({
      name: i.string(),
    }),
    memberships: i.entity({
      persona: i.string().unique().indexed(),
    }),
    lists: i.entity({
      name: i.string(),
      ordinal: i.number().indexed(),
      taskOrder: i.json(),
    }),
    tasks: i.entity({
      title: i.string(),
      completed: i.boolean(),
      assignee: i.string(),
      dueDate: i.string(),
      seedKey: i.string().unique().indexed(),
      revision: i.number(),
    }),
  },
  links: {
    membershipUser: {
      forward: {
        on: "memberships",
        has: "one",
        label: "user",
        required: true,
        onDelete: "cascade",
      },
      reverse: { on: "$users", has: "many", label: "memberships" },
    },
    membershipWorkspace: {
      forward: {
        on: "memberships",
        has: "one",
        label: "workspace",
        required: true,
        onDelete: "cascade",
      },
      reverse: { on: "workspaces", has: "many", label: "memberships" },
    },
    listWorkspace: {
      forward: {
        on: "lists",
        has: "one",
        label: "workspace",
        required: true,
        onDelete: "cascade",
      },
      reverse: { on: "workspaces", has: "many", label: "lists" },
    },
    taskList: {
      forward: {
        on: "tasks",
        has: "one",
        label: "list",
        required: true,
        onDelete: "cascade",
      },
      reverse: { on: "lists", has: "many", label: "tasks" },
    },
  },
  rooms: {},
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
