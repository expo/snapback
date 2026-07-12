// Contract-facing capability facts shared by the adapter and code generator.
//
// @ref LLP 0034#3-d2--receipts-rewritten-in-rev-2 — receipt claims come from the
//   shipped adapter surface, not a hand-maintained generator default.

export const CONTRACT_RECEIPT_CAPABILITY = Object.freeze({
  NONE: 'none',
  MUTATION: 'mutation',
  MUTATION_AND_SUBSCRIPTION: 'mutation+subscription',
});

/**
 * Map implemented receipt surfaces onto Exact's closed manifest vocabulary.
 * Subscription receipts without mutation receipts are intentionally rejected:
 * Exact has no honest manifest value for that combination.
 */
export function contractReceiptCapability({
  mutationReceipts = false,
  subscriptionReceipts = false,
} = {}) {
  if (subscriptionReceipts && !mutationReceipts) {
    throw new Error('Contract receipt capability cannot represent subscription receipts without mutation receipts.');
  }
  if (subscriptionReceipts) return CONTRACT_RECEIPT_CAPABILITY.MUTATION_AND_SUBSCRIPTION;
  if (mutationReceipts) return CONTRACT_RECEIPT_CAPABILITY.MUTATION;
  return CONTRACT_RECEIPT_CAPABILITY.NONE;
}

// The Snapback app adapter exposes the kit's bounded mutation and subscription
// receipt ring through surface.receipts(). Keep this as the sole product claim
// consumed by generated Contract data manifests.
export const SNAPBACK_CONTRACT_RECEIPT_CAPABILITY = contractReceiptCapability({
  mutationReceipts: true,
  subscriptionReceipts: true,
});
