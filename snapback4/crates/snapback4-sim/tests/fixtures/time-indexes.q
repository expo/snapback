table events:
  principal: principal
  at: time
  by byBucket: bucket(at, 2h, 30m), at, id
  by byOwnerHour: principal, hour(at, 30m), at, id
  public 'events'
  sync public
  insert <- allow
  update <- allow

table checkins:
  principal: principal
  at: time
  unique byDay: principal, day(at) else ALREADY_HERE 'Already checked in.'
  public 'checkins'
  sync public
  insert <- .principal = viewer

query buckets(start: int, end: int, c: cursor ?):
  return events[bucket >= start, bucket < end] after c first 3 by byBucket

query hourPage(h: int, c: cursor ?):
  return events[viewer, h] after c first 10 by byOwnerHour

query allBuckets(c: cursor ?):
  return events[] after c first 3 by byBucket

query ordinalMerge(c: cursor ?):
  return merge events after c first 10 by byOwnerHour:
    [viewer]

mutation move(eventId: events, at: time):
  return update events[eventId] { at }

mutation checkin():
  return insert checkins { principal: viewer, at: now }
