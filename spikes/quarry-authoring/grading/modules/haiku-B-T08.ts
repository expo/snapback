const users = table("users");
const journals = table("journals");
const entries = privateTable("entries");
const coaches = table("coaches");

export const addEntry = mutation(
  { journalId: id(journals), entryText: text({ max: 4096 }) },
  ({ db, ctx, args }) => {
    const journal = db.get(journals, args.journalId);
    const isOwner = journal && journal.ownerId === ctx.viewer;
    const isCoach = db.exists(coaches.byJournalUser, [args.journalId, ctx.viewer]);

    db.require(isOwner || isCoach, "NOT_ALLOWED");

    const entryId = ctx.newId();
    db.insert(entries, {
      id: entryId,
      journalId: args.journalId,
      at: ctx.now(),
      text: args.entryText,
    });

    return entryId;
  },
);
