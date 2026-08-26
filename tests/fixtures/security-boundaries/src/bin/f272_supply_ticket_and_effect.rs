use snapback_engine::local::LocalSnapback;
use snapback_services::assets::AssetWidthPlanTicketV1;
use snapback_sync::auth::invocation::AuthorizedEffectReservation;

fn stage_crossed(
    engine: &mut LocalSnapback,
    ticket: AssetWidthPlanTicketV1,
    effect: AuthorizedEffectReservation,
) {
    // @attack
    let _ = engine.asset_width_plan_with_authorized_effect(ticket, effect);
}

fn main() {
    let _ = stage_crossed;
}
