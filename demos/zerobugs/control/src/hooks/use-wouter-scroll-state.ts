import {useWindowScrollHistory} from '../windowing/history-state.ts';

export function useWouterScrollState<TStartRow>(identity = window.location.pathname) {
  return useWindowScrollHistory<TStartRow>(identity);
}
