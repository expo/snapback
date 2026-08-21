import {
  defineJsQuery,
  defineLiveQuery,
  defineQuery,
  type HostPlanQuerySpec,
} from './define.js';

defineQuery({
  table: 'announcements',
});

defineQuery({
  table: 'announcements',
  auth: 'optional-user',
});

defineQuery({
  table: 'announcements',
  auth: 'public',
});

defineQuery({
  table: 'announcements',
  auth: 'public',
  authorityIndependent: false,
  publicInline: false,
});

defineQuery({
  table: 'privateAnnouncements',
  auth: 'authenticated',
  requires: ['verified'],
});

defineQuery({
  table: 'announcements',
  auth: 'public',
  authorityIndependent: true,
  publicInline: false,
});

defineQuery({
  table: 'announcements',
  auth: 'public',
  authorityIndependent: true,
  publicInline: true,
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

// @ts-expect-error auth: 'public' is missing and required when authorityIndependent is true
defineQuery({
  table: 'announcements',
  authorityIndependent: true,
});

// @ts-expect-error optional-user queries cannot be authority-independent
defineQuery({
  table: 'announcements',
  auth: 'optional-user',
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

// @ts-expect-error the helper cannot make an authority-independent query authenticated
defineQuery(withAuthenticatedAuthority({
  table: 'privateAnnouncements',
  authorityIndependent: true,
}));

// @ts-expect-error publicInline requires the public authority-independent branch
defineLiveQuery({
  table: 'announcements',
  auth: 'public',
  publicInline: true,
});

// @ts-expect-error publicInline is not a field on opaque JavaScript queries
defineJsQuery({ reads: ['announcements'], auth: 'public', authorityIndependent: true, publicInline: true, handler: async () => [] });

// A cast can cross the authoring type boundary. Codegen must still reject the
// equivalent runtime declaration with FUNCTION_AUTHORITY_INDEPENDENT_INVALID.
const castDeclaration = {
  table: 'privateAnnouncements',
  auth: 'authenticated',
  authorityIndependent: true,
} as unknown as HostPlanQuerySpec;
defineQuery(castDeclaration);
