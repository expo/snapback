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
  promo = promos[code]! else NO_PROMO
  require promo.expiresAt > commit else PROMO_EXPIRED
  require not exists redemptions[promo, viewer] else ALREADY_REDEEMED
  +redemptions { promo, user: viewer, at: now }
