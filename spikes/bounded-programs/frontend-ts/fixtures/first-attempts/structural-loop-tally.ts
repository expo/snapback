const waitlist = privateTable("waitlist");
const waitCounts = maintained("waitCounts", waitlist);

export const waitlistDepth = query({ resourceId: scalar() }, ({ db, args }) => {
  let count = 0;
  for (const entry of db.scan(waitlist.byResource, [args.resourceId], { take: 100 })) {
    count++;
  }
  return count;
});
