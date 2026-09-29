// Exact profile table, myProfile and saveProfile from the read-only 0.4.7 comparative.
export const profileSchema = `use personas alice, bob
table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=2048 format url ?
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  search displayName, handle
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  sync public last 2000 by .handle

query myProfile():
  return profiles[principal = viewer]
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200 ?, location: text <=50 ?, link: text <=2048 format url ?):
  upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
  return null

table notes:
  owner: principal
  body: text
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation unrelated():
  insert notes { owner: viewer, body: 'hello' }
`;
export const profileRows = ['alice', 'bob'].map(person => ({ table: 'profiles', row: {
  id: person, principal: 'dev:' + person, displayName: person, handle: person,
  bio: null, location: null, link: null, avatar: null,
} }));
