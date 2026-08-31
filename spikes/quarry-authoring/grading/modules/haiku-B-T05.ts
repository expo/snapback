const users = table("users");
const promos = table("promos");
const redemptions = table("redemptions");

export const redeemPromo = mutation(
  { code: text() },
  ({ db, ctx, args }) => {
    const promo = db.get(promos.byCode, [args.code]);
    db.require(promo !== null, "PROMO_NOT_FOUND");
    
    db.require(promo.expiresAt > ctx.commitTime, "PROMO_EXPIRED");
    
    const existing = db.get(redemptions.byPromoUser, [promo.id, ctx.viewer]);
    db.require(existing === null, "ALREADY_REDEEMED");
    
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
