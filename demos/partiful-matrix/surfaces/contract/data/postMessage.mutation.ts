import { getMatrixContractLinks } from './runtime-links';
export function postMessage(args: Record<string, unknown>) { return getMatrixContractLinks().postMessage(args); }
