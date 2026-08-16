import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
    userId: v.string(),
  })
    // @ref LLP 0234#phase-g2--d2-enforcing-closure — listTodos and createTodo
    // bind userId to authUserId(), so this is the row's principal field.
    .visibility({ kind: 'owner', field: 'userId' })
    .index('by_user', ['userId'])
    .sync(),
});
