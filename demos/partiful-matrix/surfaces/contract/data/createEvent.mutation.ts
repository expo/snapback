import { getMatrixContractLinks } from './runtime-links';
export function createEvent(args: Record<string, unknown>) { return getMatrixContractLinks().createEvent(args); }
