table users:
  name: text <=80

table journals:
  owner: users
  title: text <=200

table entries:
  journal: journals
  at: time
  text: text <=8192
  by byJournalAt: journal, at
  read e <- journals[e.journal].owner = viewer
            or exists coaches[e.journal, viewer]

table coaches:
  journal: journals
  user: users
  unique byJournalUser: journal, user

mutation addEntry(journalId: journals, entryText: text <=8192) -> entries:
  j = journals[journalId]! else NOT_ALLOWED
  require j.owner = viewer or exists coaches[journalId, viewer] else NOT_ALLOWED
  +entries { journal: journalId, at: now, text: entryText }
