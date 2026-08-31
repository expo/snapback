const users = table("users");
const contests = table("contests");
const entries = privateTable("entries");
                                       // { id, contestId, bakerId, score, at }
                                       // readable only to the entry's own baker until the contest closes
                                       // index entries.byContestScore: (contestId, score)
const topScores = maintained("topScores", entries);

export const topScore = query({ contestId: scalar() }, ({ db, args }) => {
  const agg = db.get(topScores, args.contestId);
  return agg?.score ?? null;
});
