import type { Read } from '../../../src/contract.ts';
type Row = { id: string };
declare function renderRow(read: Read<Row>): void;
export function renderTypedRow<T extends Row>(read: Read<T>): void { renderRow(read); }
