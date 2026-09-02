const users = table("users");
const postings = table("postings");              // index postings.byEmployerCreated: (employerId, createdAt)
const applications = privateTable("applications");
                                                 // index applications.byPostingAt: (postingId, at)
const applicationCounts = maintained("applicationCounts", applications);

export const dashboard = query({}, ({ db, ctx }) => {
  const result = [];
  
  for (const posting of db.scan(postings.byEmployerCreated, [ctx.viewer], { order: "desc", take: 20 })) {
    const countData = db.get(applicationCounts, posting.id);
    result.push({
      posting,
      applicationCount: countData?.count ?? 0
    });
  }
  
  return result;
});
