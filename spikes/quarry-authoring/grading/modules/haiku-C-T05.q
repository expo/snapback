table users:
  name: text <=80

table promos:
  code: text <=32
  discount: int
  expiresAt: time
  unique code

table redemptions:
  promo: promos
  user: users
  at: time
  unique promo, user

mutation redeemPromo(code: text <=32) -> redemptions:
  p = promos[code = code]! else PROMO_NOT_FOUND
  require p.expiresAt > commit else PROMO_EXPIRED
  require not exists redemptions[p, viewer] else ALREADY_REDEEMED
  +redemptions { promo: p, user: viewer, at: now }
