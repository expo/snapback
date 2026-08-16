const identity = (value) => value;

export const createContext = (value) => ({ value });
export const useCallback = identity;
export const useContext = (context) => context?.value;
export const useEffect = () => {};
export const useMemo = (factory) => factory();
export const useRef = (current) => ({ current });
export const useState = (initial) => [initial, () => {}];
export const useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();

export default Object.freeze({
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
});
