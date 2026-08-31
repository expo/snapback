table users:
  name: text <=80

table shows:
  title: text <=200

table subs:
  user: users
  show: shows
  lastListenedAt: time
  by user, lastListenedAt

table episodes:
  show: shows
  publishedAt: time
  title: text <=200
  by show, publishedAt

query inboxBadges():
  subs[viewer] last 50 {
    show: shows[.show].title,
    unreadCount: episodes[.show] after .lastListenedAt first 100 | count
  }
