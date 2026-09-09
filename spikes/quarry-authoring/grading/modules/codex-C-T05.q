table users:
  name: text <=80

table promos:
  code: text <=32
  discount: int
  expiresAt: time
  unique byCode: code

table redemptions:
  promo: promos
  user: users
  at: time
  unique byPromoUser: promo, user

mutation redeemPromo(code: text <=32) -> redemptions:
  p = promos[code = code]! else PROMO_NOT_FOUND
  require commit <= p.expiresAt else PROMO_EXPIRED
  require not exists redemptions[p, viewer] else ALREADY_REDEEMED
  +redemptions { promo: p, user: viewer, at: now }
