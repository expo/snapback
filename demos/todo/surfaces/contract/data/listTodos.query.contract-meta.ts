import { defineContractModule, query } from '@exact/contract/exports';

export default defineContractModule('./listTodos.query.ts', {
  listTodos: query({ reads: ['todos'], readMode: 'sync', cacheKey: 'todos' }),
});
