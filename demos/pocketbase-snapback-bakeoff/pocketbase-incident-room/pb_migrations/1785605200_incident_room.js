migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  users.listRule = '@request.auth.id != ""';
  users.viewRule = '@request.auth.id != ""';
  users.createRule = '';
  users.updateRule = 'id = @request.auth.id';
  users.deleteRule = 'id = @request.auth.id';
  users.fields.add(new TextField({ name: 'name', required: true, max: 80 }));
  app.save(users);

  const rooms = new Collection({
    id: 'rooms0000000000',
    type: 'base',
    name: 'rooms',
    listRule: 'members.id ?= @request.auth.id',
    viewRule: 'members.id ?= @request.auth.id',
    createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id && @request.body.members ?= @request.auth.id',
    updateRule: 'owner = @request.auth.id',
    deleteRule: 'owner = @request.auth.id',
    fields: [
      { name: 'name', type: 'text', required: true, max: 120 },
      { name: 'owner', type: 'relation', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: 'members', type: 'relation', required: true, maxSelect: 20, collectionId: users.id, cascadeDelete: false },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
  });
  app.save(rooms);

  const incidents = new Collection({
    id: 'incidents000000',
    type: 'base',
    name: 'incidents',
    listRule: 'room.members.id ?= @request.auth.id',
    viewRule: 'room.members.id ?= @request.auth.id',
    createRule: '@request.auth.id != "" && @request.body.room.members.id ?= @request.auth.id',
    updateRule: 'room.members.id ?= @request.auth.id',
    deleteRule: 'room.owner = @request.auth.id',
    fields: [
      { name: 'room', type: 'relation', required: true, maxSelect: 1, collectionId: rooms.id, cascadeDelete: true },
      { name: 'title', type: 'text', required: true, max: 160 },
      { name: 'summary', type: 'editor', required: true, maxSize: 4000 },
      { name: 'severity', type: 'select', required: true, maxSelect: 1, values: ['sev1', 'sev2', 'sev3'] },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['open', 'acknowledged', 'resolved'] },
      { name: 'commander', type: 'relation', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: false },
      { name: 'attachment', type: 'file', maxSelect: 1, maxSize: 5242880, mimeTypes: ['image/png', 'image/jpeg', 'text/plain'], protected: true },
      { name: 'acknowledgedAt', type: 'date' },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: [
      'CREATE INDEX idx_incidents_room_status ON incidents (room, status)',
      'CREATE INDEX idx_incidents_severity ON incidents (severity)',
    ],
  });
  app.save(incidents);

  const messages = new Collection({
    id: 'messages0000000',
    type: 'base',
    name: 'messages',
    listRule: 'incident.room.members.id ?= @request.auth.id',
    viewRule: 'incident.room.members.id ?= @request.auth.id',
    createRule: '@request.auth.id != "" && @request.body.incident.room.members.id ?= @request.auth.id',
    updateRule: 'author = @request.auth.id',
    deleteRule: 'author = @request.auth.id',
    fields: [
      { name: 'incident', type: 'relation', required: true, maxSelect: 1, collectionId: incidents.id, cascadeDelete: true },
      { name: 'author', type: 'relation', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: false },
      { name: 'body', type: 'text', required: true, max: 1000 },
      { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['message', 'system'] },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE INDEX idx_messages_incident ON messages (incident)'],
  });
  app.save(messages);

  const activity = new Collection({
    id: 'activity0000000',
    type: 'base',
    name: 'activity',
    listRule: 'incident.room.members.id ?= @request.auth.id',
    viewRule: 'incident.room.members.id ?= @request.auth.id',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'incident', type: 'relation', required: true, maxSelect: 1, collectionId: incidents.id, cascadeDelete: true },
      { name: 'actor', type: 'relation', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: false },
      { name: 'action', type: 'text', required: true, max: 120 },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
  });
  app.save(activity);

  const presence = new Collection({
    id: 'presence0000000',
    type: 'base',
    name: 'presence',
    listRule: 'incident.room.members.id ?= @request.auth.id',
    viewRule: 'incident.room.members.id ?= @request.auth.id',
    createRule: '@request.auth.id != "" && @request.body.user = @request.auth.id && @request.body.incident.room.members.id ?= @request.auth.id',
    updateRule: 'user = @request.auth.id',
    deleteRule: 'user = @request.auth.id',
    fields: [
      { name: 'incident', type: 'relation', required: true, maxSelect: 1, collectionId: incidents.id, cascadeDelete: true },
      { name: 'user', type: 'relation', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: 'state', type: 'select', required: true, maxSelect: 1, values: ['viewing', 'typing'] },
      { name: 'expiresAt', type: 'date', required: true },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_presence_incident_user ON presence (incident, user)'],
  });
  app.save(presence);

  const ada = new Record(users);
  ada.set('id', 'userada00000000');
  ada.set('email', 'ada@example.test');
  ada.set('password', 'correct-horse-ada');
  ada.set('name', 'Ada');
  app.save(ada);

  const grace = new Record(users);
  grace.set('id', 'usergrace000000');
  grace.set('email', 'grace@example.test');
  grace.set('password', 'correct-horse-grace');
  grace.set('name', 'Grace');
  app.save(grace);

  const outsider = new Record(users);
  outsider.set('id', 'usermallory0000');
  outsider.set('email', 'mallory@example.test');
  outsider.set('password', 'correct-horse-mallory');
  outsider.set('name', 'Mallory');
  app.save(outsider);

  const room = new Record(rooms);
  room.set('id', 'roomops00000000');
  room.set('name', 'Production Operations');
  room.set('owner', ada.id);
  room.set('members', [ada.id, grace.id]);
  app.save(room);

  const incident = new Record(incidents);
  incident.set('id', 'incidentapi0000');
  incident.set('room', room.id);
  incident.set('title', 'API latency elevated');
  incident.set('summary', 'The p95 latency is above the service objective.');
  incident.set('severity', 'sev2');
  incident.set('status', 'open');
  incident.set('commander', ada.id);
  app.save(incident);

  const message = new Record(messages);
  message.set('id', 'messagefirst000');
  message.set('incident', incident.id);
  message.set('author', ada.id);
  message.set('body', 'Investigating the database connection pool.');
  message.set('kind', 'message');
  app.save(message);
}, (app) => {
  for (const name of ['presence', 'activity', 'messages', 'incidents', 'rooms']) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch { /* already absent */ }
  }
  const users = app.findCollectionByNameOrId('users');
  for (const email of ['ada@example.test', 'grace@example.test', 'mallory@example.test']) {
    try { app.delete(app.findAuthRecordByEmail('users', email)); } catch { /* already absent */ }
  }
  users.fields.removeByName('name');
  users.listRule = null;
  users.viewRule = null;
  users.createRule = '';
  users.updateRule = 'id = @request.auth.id';
  users.deleteRule = 'id = @request.auth.id';
  app.save(users);
});
