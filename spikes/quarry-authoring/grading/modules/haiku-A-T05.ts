const users = table("users");             // { id, name }
const promos = table("promos");           // { id, code, discount, expiresAt }
                                          // unique index promos.byCode: (code)
const redemptions = table("redemptions"); // { id, promoId, userId, at }
                                          // unique index redemptions.byPromoUser: (promoId, userId)

export const redeemPromo = mutation(
  { code: text() },
  ({ db, ctx, args }) => {
    const promo = db.get(promos.byCode, [args.code]);
    db.require(promo !== null, "PROMO_NOT_FOUND");
    db.require(promo.expiresAt > ctx.commitTime, "PROMO_EXPIRED");
    
    const existing = db.get(redemptions.byPromoUser, [promo.id, ctx.viewer]);
    db.require(!existing, "ALREADY_REDEEMED");
    
    const redemptionId = ctx.newId();
    db.insert(redemptions, {
      id: redemptionId,
      promoId: promo.id,
      userId: ctx.viewer,
      at: ctx.commitTime,
    });
    
    return redemptionId;
  }
);
