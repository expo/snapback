import { getMatrixContractLinks } from './runtime-links';
export function guestList(args: { eventId: string }) { return getMatrixContractLinks().guestList(args); }
