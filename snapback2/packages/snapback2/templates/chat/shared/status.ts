import type { Refusal } from "snapback2/client";

export function sendAdvice(refusal: Refusal): string {
  if (refusal.code === "NOT_MEMBER" || refusal.code === "MEMBERSHIP_REQUIRED") return "Join this conversation before sending.";
  if (refusal.family === "transport") return "Reconnect and try again. Your draft is kept.";
  if (refusal.family === "auth") return "Sign in to send. Your draft is kept.";
  return "Your draft is kept. Open details for the next step.";
}

export function recoveryAdvice(refusal: Refusal): string {
  if (refusal.code === "E_AUTH_SUPERSEDED") return "Account changed. Check saved work in your current account.";
  if (refusal.family === "auth") return "Sign in to sync your saved messages.";
  if (refusal.family === "transport") return "Sync paused. Your messages are saved; try again.";
  return "Sync stopped. Your messages are saved.";
}

export function refusalDetails(refusal: Refusal): string {
  return [refusal.code, refusal.message, refusal.rewrite].filter(Boolean).join("\n");
}
