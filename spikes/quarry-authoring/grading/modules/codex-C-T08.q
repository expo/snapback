table users:
  name: text <=80

table journals:
  owner: users
  title: text <=200

table entries:
  journal: journals
  at: time
  text: text <=8192
  by journal, at
  read e <- journals[e.journal].owner = viewer
            or exists coaches[e.journal, viewer]

table coaches:
  journal: journals
  user: users
  unique journal, user

mutation addEntry(journalId: journals, entryText: text <=8192) -> entries:
  journal = journals[journalId]! else NOT_ALLOWED
  require journal.owner = viewer or exists coaches[journalId, viewer] else NOT_ALLOWED
  +entries { journal: journalId, at: now, text: entryText }
