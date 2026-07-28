// @ref LLP 0080#3-visibility-and-authority — visibility is explicit for
// both sources and owner-scoped output; field names never imply authority.

import {
  arg,
  authUserId,
  defineMutation,
  defineRelationalQuery,
  insert,
  runtimeNow,
  v,
} from '../../_kit/define.mjs';
import schema from './schema.mjs';

export const addBook = defineMutation({
  auth: 'authenticated',
  args: {
    isbn: v.string(),
    title: v.string(),
    publisherSlug: v.string(),
  },
  plan: insert('books', {
    ownerId: authUserId(),
    isbn: arg('isbn'),
    title: arg('title'),
    publisherSlug: arg('publisherSlug'),
    createdAt: runtimeNow(),
  }),
});

export const addPublisher = defineMutation({
  auth: 'authenticated',
  args: { slug: v.string(), name: v.string(), country: v.string() },
  plan: insert('publishers', {
    slug: arg('slug'),
    name: arg('name'),
    country: arg('country'),
  }),
});

export const booksWithPublisher = defineRelationalQuery({
  root: schema.tables.books,
  joined: schema.tables.publishers,
  join: [{ root: 'publisherSlug', joined: 'slug' }],
  kind: 'left',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: 'owner',
  },
  projection: {
    isbn: { root: 'isbn' },
    title: { root: 'title' },
    publisherSlug: { root: 'publisherSlug' },
    publisherName: { joined: 'name' },
    publisherCountry: { joined: 'country' },
  },
  take: 3,
  rootIndex: 'by_owner_created',
  joinedIndex: 'by_slug',
});
