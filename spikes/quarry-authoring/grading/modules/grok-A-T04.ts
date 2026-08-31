const users = table("users");          // { id, name }
const contests = table("contests");    // { id, title, endsAt }
const entries = privateTable("entries");
                                       // { id, contestId, bakerId, score, at }
                                       // readable only to the entry's own baker until the contest closes
                                       // index entries.byContestScore: (contestId, score)

const topScores = maintained("topScores", entries); // { id: contestId, score } — public max(score) grouped by contestId

export const topScore = query({ contestId: scalar() }, ({ db, args }) => {
  const row = db.get(topScores, args.contestId);
  return row === null ? null : row.score;
});
