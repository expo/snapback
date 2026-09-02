const users = table("users");          // { id, name }
const contests = table("contests");    // { id, title, endsAt }
const entries = privateTable("entries");
                                       // { id, contestId, bakerId, score, at }
                                       // readable only to the entry's own baker until the contest closes
                                       // index entries.byContestScore: (contestId, score)

const contestTopScores = maintained("contestTopScores", entries);
                                       // { id: contestId, topScore } — exact maximum score by contest

export const topScore = query(
  { contestId: id(contests) },
  ({ db, args }) => {
    const aggregate = db.get(contestTopScores, args.contestId);
    return aggregate === null ? null : aggregate.topScore;
  },
);
