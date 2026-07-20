import { getMatrixContractLinks } from './runtime-links';
export function rsvp(args: Record<string, unknown>) { return getMatrixContractLinks().rsvp(args); }
