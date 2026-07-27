// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — native
// startup weight and evaluation time cover the app startup HBC. The Exact
// runtime archive separately installs its authenticated shared-runtime HBC
// before this artifact, as required by Exact LLP 0127#runtime-bundle-strategy;
// bundling runtime-entry here would install the same global graph twice.
import './partitime/native-performance-witness.js';
import './main.native.js';
