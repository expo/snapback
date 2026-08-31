const users = table("users");
const postings = table("postings");
const applications = privateTable("applications");

export const dashboard = query({}, ({ db, ctx }) => {
  const result: any[] = [];
  for (const posting of db.scan(postings.byEmployerCreated, [ctx.viewer], { order: "desc", take: 20 })) {
    let applicationCount = 0;
    for (const app of db.scan(applications.byPostingAt, [posting.id])) {
      applicationCount++;
    }
    result.push({ posting, applicationCount });
  }
  return result;
});
