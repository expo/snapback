const entries = table("entries");

export const entryCount = query({ resourceId: scalar() }, ({ db, args }) =>
  db.scan(entries.byResource, [args.resourceId]).count(),
);
