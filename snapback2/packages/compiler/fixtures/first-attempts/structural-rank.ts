const waitlist = privateTable("waitlist");
const waitCounts = maintained("waitCounts", waitlist);

export const largestWait = query({ resourceId: scalar() }, ({ db, args }) =>
  db.scan(waitlist.byResource, [args.resourceId], { take: 100 })
    .sort((a, b) => b.amount - a.amount)[0],
);
