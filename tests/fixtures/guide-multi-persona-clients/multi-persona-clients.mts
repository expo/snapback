import {
  DEFAULT_AUTH_STORAGE_PARTITION,
  createSnapbackAppClient,
} from '@expo/snapback-client';

type AppClientInput = Parameters<typeof createSnapbackAppClient>[0];
type PersonaClientInput = Omit<AppClientInput, 'rqsStore' | 'storagePartition'>;

export async function createAcceptancePersonas(
  input: PersonaClientInput,
  workerId: string,
) {
  const uncheckedInput = input as AppClientInput;
  if (uncheckedInput.storagePartition === DEFAULT_AUTH_STORAGE_PARTITION) {
    throw new Error('do not pass DEFAULT_AUTH_STORAGE_PARTITION to a multi-persona helper');
  }
  if (Object.hasOwn(uncheckedInput, 'rqsStore')) {
    throw new Error('multi-persona clients must not share one injected rqsStore');
  }
  const partitionFor = (persona: string) => `acceptance:${workerId}:${persona}`;
  const henryPartition = partitionFor('henry');
  const miaPartition = partitionFor('mia');

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
