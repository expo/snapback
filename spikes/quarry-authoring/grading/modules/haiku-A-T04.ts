const users = table("users");
const contests = table("contests");
const entries = privateTable("entries");
                                       // { id, contestId, bakerId, score, at }
                                       // index entries.byContestScore: (contestId, score)

const topScoreByContest = maintained("topScoreByContest", entries);
// Maintains the maximum score for each contest
// Structure: { contestId, maxScore }

export const topScore = query({ contestId: scalar() }, ({ db, args }) => {
  const record = db.get(topScoreByContest, args.contestId);
  return record?.maxScore ?? null;
});
