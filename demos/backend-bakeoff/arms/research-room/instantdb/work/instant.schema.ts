import { i } from "@instantdb/react";

const schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    profiles: i.entity({
      email: i.string().unique().indexed(),
      displayName: i.string(),
      createdAt: i.number().indexed(),
    }),
    rooms: i.entity({
      title: i.string().indexed(),
      createdAt: i.number().indexed(),
    }),
    sources: i.entity({
      title: i.string().indexed(),
      body: i.string().indexed(),
      contentHash: i.string().indexed(),
      byteLength: i.number(),
      embedding: i.json(),
      createdAt: i.number().indexed(),
    }),
    questions: i.entity({
      questionKey: i.string().unique().indexed(),
      dedupeKey: i.string().unique().indexed(),
      prompt: i.string(),
      status: i.string().indexed(),
      progressCount: i.number(),
      terminal: i.boolean(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().indexed(),
    }),
    progress: i.entity({
      progressKey: i.string().unique().indexed(),
      ordinal: i.number().indexed(),
      message: i.string(),
      durable: i.boolean(),
      createdAt: i.number().indexed(),
    }),
    answers: i.entity({
      answerKey: i.string().unique().indexed(),
      questionKey: i.string().unique().indexed(),
      text: i.string(),
      citations: i.json(),
      status: i.string().indexed(),
      createdAt: i.number().indexed(),
    }),
    effectAttempts: i.entity({
      attemptKey: i.string().unique().indexed(),
      dedupeKey: i.string().unique().indexed(),
      outcome: i.string().indexed(),
      settlement: i.string().indexed(),
      detail: i.string(),
      createdAt: i.number().indexed(),
    }),
  },
  links: {
    profileUser: {
      forward: { on: "profiles", has: "one", label: "$user", required: true },
      reverse: { on: "$users", has: "one", label: "profile" },
    },
    roomMembers: {
      forward: { on: "rooms", has: "many", label: "members" },
      reverse: { on: "profiles", has: "many", label: "rooms" },
    },
    sourceRoom: {
      forward: { on: "sources", has: "one", label: "room", required: true },
      reverse: { on: "rooms", has: "many", label: "sources" },
    },
    sourceOwner: {
      forward: { on: "sources", has: "one", label: "owner", required: true },
      reverse: { on: "profiles", has: "many", label: "ownedSources" },
    },
    sourceFile: {
      forward: { on: "sources", has: "one", label: "file" },
      reverse: { on: "$files", has: "one", label: "source" },
    },
    questionRoom: {
      forward: { on: "questions", has: "one", label: "room", required: true },
      reverse: { on: "rooms", has: "many", label: "questions" },
    },
    questionAsker: {
      forward: { on: "questions", has: "one", label: "asker", required: true },
      reverse: { on: "profiles", has: "many", label: "questions" },
    },
    progressQuestion: {
      forward: { on: "progress", has: "one", label: "question", required: true },
      reverse: { on: "questions", has: "many", label: "progress" },
    },
    answerQuestion: {
      forward: { on: "answers", has: "one", label: "question", required: true },
      reverse: { on: "questions", has: "one", label: "answer" },
    },
    answerRoom: {
      forward: { on: "answers", has: "one", label: "room", required: true },
      reverse: { on: "rooms", has: "many", label: "answers" },
    },
    attemptQuestion: {
      forward: { on: "effectAttempts", has: "one", label: "question" },
      reverse: { on: "questions", has: "many", label: "attempts" },
    },
  },
});

export default schema;
