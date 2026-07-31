export type ContractReceiptCapability = 'none' | 'mutation' | 'mutation+subscription';

export const CONTRACT_RECEIPT_CAPABILITY: Readonly<{
  NONE: 'none';
  MUTATION: 'mutation';
  MUTATION_AND_SUBSCRIPTION: 'mutation+subscription';
}>;

/**
 * Map implemented receipt surfaces onto Exact's closed manifest vocabulary.
 * Subscription receipts without mutation receipts are rejected.
 */
export function contractReceiptCapability(options?: {
  mutationReceipts?: boolean;
  subscriptionReceipts?: boolean;
}): ContractReceiptCapability;

export const SNAPBACK_CONTRACT_RECEIPT_CAPABILITY: 'mutation+subscription';
