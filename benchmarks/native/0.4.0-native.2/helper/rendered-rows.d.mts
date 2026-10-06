export function reconcileRenderedRows<T, R>(
  data: readonly T[],
  renderedKeys: readonly string[],
  keyFor: (item: T, index: number) => string,
  toObservation: (item: T) => R|null,
  inverted?: boolean,
): R[];

export function committedSearchResultIds(
  token: string,
  rows: readonly { messageId: string }[],
): string[];
