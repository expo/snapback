import type { InstantRules } from "@instantdb/react";

const rules = {
  $default: { allow: { $default: "false" } },
  attrs: { allow: { create: "false" } },
  $users: {
    allow: {
      view: "auth.id == data.id",
      create: "true",
      update: "false",
      delete: "false",
    },
  },
  workspaces: {
    bind: {
      isMember: "auth.id in data.ref('memberships.user.id')",
    },
    allow: {
      view: "isMember",
      create: "false",
      update: "isMember",
      delete: "false",
    },
  },
  memberships: {
    bind: {
      isMember: "auth.id in data.ref('workspace.memberships.user.id')",
    },
    allow: {
      view: "isMember",
      create: "false",
      update: "false",
      delete: "false",
    },
  },
  lists: {
    bind: {
      isMember: "auth.id in data.ref('workspace.memberships.user.id')",
    },
    allow: {
      view: "isMember",
      create: "isMember",
      update: "isMember",
      delete: "isMember",
    },
  },
  tasks: {
    bind: {
      isMember:
        "auth.id in data.ref('list.workspace.memberships.user.id')",
    },
    allow: {
      view: "isMember",
      create: "isMember",
      update: "isMember",
      delete: "isMember",
    },
  },
} satisfies InstantRules;

export default rules;
