import {isReady, type Read} from '../../../src/contract.ts';
export function absentValue(read: Read<{id: string}[] | null>): null | undefined {
 if (isReady(read) && read.presence === 'absent') { const claimed: null = read.data; return claimed; }
}
