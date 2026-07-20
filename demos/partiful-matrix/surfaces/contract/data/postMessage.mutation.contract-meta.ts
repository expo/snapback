import { defineContractModule, mutation } from '@exact/contract/exports';
export default defineContractModule('./postMessage.mutation.ts', { postMessage: mutation({ effects: ['posts.write'], invalidates: ['posts'] }) });
