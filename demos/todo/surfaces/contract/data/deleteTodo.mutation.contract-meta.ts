import { defineContractModule, mutation } from '@exact/contract/exports';

export default defineContractModule('./deleteTodo.mutation.ts', {
  deleteTodo: mutation({ effects: ['todos.write'], invalidates: ['todos'] }),
});
