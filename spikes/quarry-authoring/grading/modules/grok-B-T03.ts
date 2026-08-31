const users = table("users");              // { id, name }
const postings = table("postings");        // { id, employerId, title, createdAt }
                                           // index postings.byEmployerCreated: (employerId, createdAt)
const applications = privateTable("applications");
                                           // { id, postingId, applicantId, at }
                                           // readable only to the posting's employer and the applicant
                                           // index applications.byPostingAt: (postingId, at)

const applicationCounts = maintained("applicationCounts", applications); // keyed by postingId

export const dashboard = query({}, ({ db, ctx }) => {
  let result: any[] = [];
  for (const posting of db.scan(postings.byEmployerCreated, [ctx.viewer], { order: "desc", take: 20 })) {
    const counts = db.get(applicationCounts, posting.id);
    result.push({
      posting,
      applicationCount: counts === null ? 0 : counts.count,
    });
  }
  return result;
});
