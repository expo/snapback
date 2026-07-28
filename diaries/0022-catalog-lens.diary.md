# 0022 — Catalog Lens relational workout

## 2026-07-27 — bounded owner-visible join

Catalog Lens is a bookstore catalog with owner-scoped books and a public
publisher dimension. Its five-check headless path creates two owners' data,
walks a two-page left join, preserves an unmatched publisher as `null`, and
rejects a tampered opaque cursor.

### What felt good

- `defineRelationalQuery` made source visibility explicit. The root owner rule,
  public joined dimension, projection, indexes, join kind, and bound are
  reviewable in one declaration.
- The generated cursor kept index boundaries and authority binding out of app
  code. Pagination needed no app-authored token format.
- The real server produced the same shape for matched and unmatched joins, and
  owner isolation required no post-query filtering.

### What felt bad or surprising

- The relational declaration is precise but dense. It takes more up-front
  schema/index knowledge than an ORM-style include.
- There was no small shared fixture for a newly authored headless app, so the
  first pass repeated server start, generated-artifact loading, seeding, and
  cleanup boilerplate.

Compared with React plus Supabase, Snapback required more explicit query
planning but removed cursor signing and row-visibility stitching from the
application. I extracted `demos/_kit/headless-app.mjs` and the five-app runner
so future kernels pay the setup cost once.
