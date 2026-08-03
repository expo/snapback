export type FakeExpoOutcome =
  | 'ok'
  | { ticketError: 'DeviceNotRegistered' | 'InvalidCredentials' | 'MessageRateExceeded' }
  | { receiptError: 'DeviceNotRegistered' | 'MessageTooBig' | 'InvalidCredentials' | 'MessageRateExceeded' }
  | { receiptPending: true };

export interface FakeExpoPushService {
  readonly baseUrl: string;
  readonly sends: Array<{ messageCount: number; planKind: string }>;
  readonly receiptPolls: Array<{ ticketCount: number }>;
  enqueueTickets(outcomes: readonly FakeExpoOutcome[]): void;
  enqueueSocketDrop(): void;
  close(): Promise<void>;
}

export function startFakeExpoPushService(): Promise<FakeExpoPushService>;
