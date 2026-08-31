const users = table("users");        // { id, name }
const journals = table("journals");  // { id, ownerId, title }
const entries = privateTable("entries");
                                     // { id, journalId, at, text }
                                     // readable only to the journal's owner and its coaches
                                     // index entries.byJournalAt: (journalId, at)
const coaches = table("coaches");    // { id, journalId, userId }
                                     // index coaches.byJournalUser: (journalId, userId)

export const addEntry = mutation(
  { journalId: id(journals), entryText: text({ max: 4096 }) },
  ({ db, ctx, args }) => {
    const journal = db.get(journals, args.journalId);
    const isOwner = journal !== null && journal.ownerId === ctx.viewer;
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
