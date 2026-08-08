import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

// This app-level join is deliberately separate from Snapback's future
// first-party provider identity store. It lets a ported application keep its
// own user rows while every protected operation starts from ctx.auth.userId.
// @ref LLP 0151#account-lifecycle-storage-and-abuse-budgets — external
// identities are keyed by immutable issuer + subject, never mutable email.
export default defineSchema({
  appUsers: defineTable({
    externalIssuer: v.string(),
    externalSubject: v.string(),
    displayName: v.string(),
    privateNote: v.string(),
  })
    .index('by_external_identity', ['externalIssuer', 'externalSubject'], { unique: true }),
  identityBindings: defineTable({
    principal: v.principal(),
    appUserId: v.id('appUsers'),
    externalIssuer: v.string(),
    externalSubject: v.string(),
  })
    .index('by_principal', ['principal'], { unique: true })
    .index('by_app_user', ['appUserId'], { unique: true })
    .index('by_external_identity', ['externalIssuer', 'externalSubject'], { unique: true }),
}, { auth: { mode: 'sessions' } });
