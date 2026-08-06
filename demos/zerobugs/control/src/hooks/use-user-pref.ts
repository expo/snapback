import {useZerobugsMutation} from '../data/snapback.ts';
import {useZerobugsQuery} from '../data/queries.ts';

export function useUserPref(key: string): string | undefined {
  const result = useZerobugsQuery('userPref', {key});
  return result.value?.value;
}

export function useSetUserPref() {
  const mutate = useZerobugsMutation('userPref.set');
  return (key: string, value: string) => mutate({key, value});
}

export function useNumericPref(key: string, defaultValue: number): number {
  const value = useUserPref(key);
  return value !== undefined ? parseInt(value, 10) : defaultValue;
}
