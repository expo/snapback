onRecordCreateRequest((e) => {
  if (!e.auth) throw new UnauthorizedError('Authentication required');
  e.record.set('commander', e.auth.id);
  e.record.set('status', 'open');
  e.next();
}, 'incidents');

onRecordCreateRequest((e) => {
  if (!e.auth) throw new UnauthorizedError('Authentication required');
  e.record.set('author', e.auth.id);
  e.record.set('kind', 'message');
  e.next();
}, 'messages');

routerAdd('POST', '/api/incident-room/incidents/{id}/acknowledge', (e) => {
  const incidentId = e.request.pathValue('id');
  let result = null;
  e.app.runInTransaction((tx) => {
    const incident = tx.findRecordById('incidents', incidentId);
    if (!tx.canAccessRecord(incident, e.requestInfo(), incident.collection().updateRule)) {
      throw new ForbiddenError('Incident not available');
    }
    if (incident.getString('status') === 'resolved') {
      throw new BadRequestError('Resolved incidents cannot be acknowledged');
    }
    incident.set('status', 'acknowledged');
    incident.set('acknowledgedAt', new DateTime());
    tx.save(incident);

    const activity = new Record(tx.findCollectionByNameOrId('activity'));
    activity.set('incident', incident.id);
    activity.set('actor', e.auth.id);
    activity.set('action', 'acknowledged');
    tx.save(activity);
    result = { incident: incident.publicExport(), activity: activity.publicExport() };
  });
  return e.json(200, result);
}, $apis.requireAuth('users'));

cronAdd('expire-presence', '*/1 * * * *', () => {
  const expired = $app.findRecordsByFilter('presence', 'expiresAt < {:now}', '', 200, 0, {
    now: new DateTime(),
  });
  for (const record of expired) $app.delete(record);
});
