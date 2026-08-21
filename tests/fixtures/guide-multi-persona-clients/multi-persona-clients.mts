import {
  DEFAULT_AUTH_STORAGE_PARTITION,
  createSnapbackAppClient,
} from '@expo/snapback-client';

type AppClientInput = Parameters<typeof createSnapbackAppClient>[0];

export async function createAcceptancePersonas(
  input: Omit<AppClientInput, 'storagePartition'>,
  workerId: string,
) {
  const partitionFor = (persona: string) => `acceptance:${workerId}:${persona}`;
  const henryPartition = partitionFor('henry');
  const miaPartition = partitionFor('mia');
  if (
    henryPartition === DEFAULT_AUTH_STORAGE_PARTITION
    || miaPartition === DEFAULT_AUTH_STORAGE_PARTITION
  ) throw new Error('acceptance personas must not use the default auth storage partition');

  const [henry, mia] = await Promise.all([
    createSnapbackAppClient({
      ...input,
      storagePartition: henryPartition,
    }),
    createSnapbackAppClient({
      ...input,
      storagePartition: miaPartition,
    }),
  ]);
  return { henry, mia };
}
