export const AppState = Object.freeze({
  currentState: 'active',
  addEventListener() {
    return Object.freeze({ remove() {} });
  },
});
