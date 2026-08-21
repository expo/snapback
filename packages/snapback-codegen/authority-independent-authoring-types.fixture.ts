import {
  defineLiveQuery,
  defineQuery,
  type HostPlanQuerySpec,
} from './define.js';

defineQuery({
  table: 'announcements',
  auth: 'public',
  authorityIndependent: true,
});

defineLiveQuery({
  table: 'privateAnnouncements',
  auth: 'authenticated',
});

// @ts-expect-error authority-independent queries must already be public
defineQuery({
  table: 'privateAnnouncements',
  auth: 'authenticated',
  authorityIndependent: true,
});

const publicAuthority = {
  auth: 'public',
  authorityIndependent: true,
} as const;

defineLiveQuery({
  ...publicAuthority,
  table: 'announcements',
  publicInline: true,
});

const withPublicAuthority = <const Spec extends object>(spec: Spec) => ({
  ...spec,
  auth: 'public' as const,
});

defineQuery(withPublicAuthority({
  table: 'announcements',
  authorityIndependent: true,
}));

const withAuthenticatedAuthority = <const Spec extends object>(spec: Spec) => ({
  ...spec,
  auth: 'authenticated' as const,
});

defineQuery(withAuthenticatedAuthority({
  table: 'privateAnnouncements',
}));

// @ts-expect-error publicInline requires the public authority-independent branch
defineLiveQuery({
  table: 'announcements',
  auth: 'public',
  publicInline: true,
});

// A cast can cross the authoring type boundary. Codegen must still reject the
// equivalent runtime declaration with FUNCTION_AUTHORITY_INDEPENDENT_INVALID.
const castDeclaration = {
  table: 'privateAnnouncements',
  auth: 'authenticated',
  authorityIndependent: true,
} as unknown as HostPlanQuerySpec;
defineQuery(castDeclaration);
