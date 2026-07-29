import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  profiles: defineTable({
    namespace: v.string(), subject: v.string(), name: v.string(),
  }).index("by_namespace_subject", ["namespace", "subject"]).index("by_namespace", ["namespace"]),
  organizations: defineTable({
    namespace: v.string(), name: v.string(), slug: v.string(),
  }).index("by_namespace", ["namespace"]),
  memberships: defineTable({
    namespace: v.string(), organizationId: v.id("organizations"),
    subject: v.string(), role: v.union(v.literal("owner"), v.literal("member")),
    active: v.boolean(),
  })
    .index("by_org_subject", ["organizationId", "subject"])
    .index("by_namespace", ["namespace"]),
  teams: defineTable({
    namespace: v.string(), organizationId: v.id("organizations"),
    name: v.string(), key: v.string(),
  }).index("by_org_key", ["organizationId", "key"]).index("by_namespace", ["namespace"]),
  projects: defineTable({
    namespace: v.string(), organizationId: v.id("organizations"),
    name: v.string(), state: v.string(),
  }).index("by_org_name", ["organizationId", "name"]).index("by_namespace", ["namespace"]),
  labels: defineTable({
    namespace: v.string(), organizationId: v.id("organizations"),
    name: v.string(), color: v.string(),
  }).index("by_org_name", ["organizationId", "name"]).index("by_namespace", ["namespace"]),
  issues: defineTable({
    namespace: v.string(), organizationId: v.id("organizations"),
    teamId: v.id("teams"), projectId: v.id("projects"),
    assigneeSubject: v.string(), identifier: v.string(), sequence: v.number(),
    title: v.string(), description: v.string(), status: v.string(),
    priority: v.number(), boardPosition: v.number(), revision: v.number(),
    triageScore: v.optional(v.number()),
  })
    .index("by_org_sequence", ["organizationId", "sequence"])
    .index("by_org_status", ["organizationId", "status", "sequence"])
    .index("by_org_assignee", ["organizationId", "assigneeSubject", "sequence"])
    .index("by_org_project", ["organizationId", "projectId", "sequence"])
    .index("by_org_triage", ["organizationId", "triageScore", "sequence"])
    .index("by_namespace", ["namespace"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["namespace", "organizationId"],
    }),
  issueLabels: defineTable({
    namespace: v.string(), organizationId: v.id("organizations"),
    issueId: v.id("issues"), labelId: v.id("labels"),
  })
    .index("by_issue_label", ["issueId", "labelId"])
    .index("by_label_issue", ["labelId", "issueId"])
    .index("by_namespace", ["namespace"]),
  comments: defineTable({
    namespace: v.string(), organizationId: v.id("organizations"),
    issueId: v.id("issues"), authorSubject: v.string(),
    sequence: v.number(), body: v.string(),
  }).index("by_issue_sequence", ["issueId", "sequence"]).index("by_namespace", ["namespace"]),
  activities: defineTable({
    namespace: v.string(), organizationId: v.id("organizations"),
    issueId: v.id("issues"), actorSubject: v.string(),
    sequence: v.number(), kind: v.string(), body: v.string(),
  }).index("by_issue_sequence", ["issueId", "sequence"]).index("by_namespace", ["namespace"]),
});
