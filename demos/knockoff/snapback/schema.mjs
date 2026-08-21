import {
  defineAuth,
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

// The broker verifies Apple or Google, then hands the app one ordinary
// email-code exchange. Provider credentials and assertions never enter the
// app bundle or Snapback rows. This is LLP 0151's local app-owned broker seam,
// not the unbuilt first-party provider program.
const authProgram = defineAuth({
  version: 1,
  custody: 'volatile-explicit',
  externalSessionEntry: true,
  mechanisms: {
    emailCode: {
      kind: 'email-code',
      identityKind: 'email',
      provider: 'emailCode',
      canonicalization: 'email-v1',
      delivery: 'broker-capture',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false, claiming: [] },
  secretReferences: {},
});

export const profiles = defineTable({
  principal: v.optional(v.principal()),
  handle: v.string(),
  displayName: v.string(),
  bio: v.string(),
  avatarUrl: v.string(),
  verified: v.boolean(),
  followers: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_principal', ['principal'], { unique: true })
  .index('by_handle', ['handle'], { unique: true })
  .sync();

export const posts = defineTable({
  authorId: v.id('profiles'),
  body: v.string(),
  createdAt: v.integer(),
  replyToId: v.optional(v.id('posts')),
  likeCount: v.integer(),
  replyCount: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_created', ['createdAt'])
  .index('by_author_created', ['authorId', 'createdAt'])
  .sync();

export const likes = defineTable({
  postId: v.id('posts'),
  principal: v.principal(),
})
  .visibility({ kind: 'public-read' })
  .index('by_post', ['postId'])
  .index('by_post_principal', ['postId', 'principal'], { unique: true })
  .sync();

export default defineSchema(
  { profiles, posts, likes },
  { auth: { mode: 'sessions' }, authProgram },
);
