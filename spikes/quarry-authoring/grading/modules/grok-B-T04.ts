const users = table("users");          // { id, name }
const contests = table("contests");    // { id, title, endsAt }
const entries = privateTable("entries");
                                       // { id, contestId, bakerId, score, at }
                                       // readable only to the entry's own baker until the contest closes
                                       // index entries.byContestScore: (contestId, score)

const topScores = maintained("topScores", entries); // engine-maintained max score per contest, keyed by contestId

export const topScore = query({ contestId: id(contests) }, ({ db, args }) => {
  return db.get(topScores, args.contestId);
});
