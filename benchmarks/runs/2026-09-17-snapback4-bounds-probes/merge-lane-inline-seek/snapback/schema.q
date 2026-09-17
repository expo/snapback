use personas alice

table posts:
  authorId: principal
  at: time
  hourAt: int
  by byHourAt: hourAt, at, id
  public 'posts'
  insert <- .authorId = viewer

table hours:
  hourAt: int
  unique byHour: hourAt
  public 'hours'
  insert <- viewer = 'dev:alice'

-- a lane source whose range seek holds inline expressions
query inline(at: time, c: cursor ?):
  return merge posts after c last 10 by byHourAt:
    [h.hourAt] for h in hours[hourAt >= hour(at - 86400000), hourAt <= hour(at)] first 25 by byHour

-- the same seek with the two expressions bound to locals first
query bound(at: time, c: cursor ?):
  startHour = hour(at - 86400000)
  endHour = hour(at)
  return merge posts after c last 10 by byHourAt:
    [h.hourAt] for h in hours[hourAt >= startHour, hourAt <= endHour] first 25 by byHour

-- control: the same inline seek on a direct page, not a lane source
query direct(at: time, c: cursor ?):
  return hours[hourAt >= hour(at - 86400000), hourAt <= hour(at)] after c first 25 by byHour
