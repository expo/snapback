import type {DefaultParams} from 'wouter';

export function getIDFromString(value: string): {idField: 'shortID' | 'id'; idValue: number | string} {
  const shortID = Number(value);
  return Number.isSafeInteger(shortID) && String(shortID) === value
    ? {idField: 'shortID', idValue: shortID}
    : {idField: 'id', idValue: value};
}

export function getID(params: DefaultParams) {
  if (!params.id) throw new Error('missing issue id route parameter');
  return getIDFromString(params.id);
}
