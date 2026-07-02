// E5 (ENG-22531): the per-user cursor color choices. Same palette as the
// boot identity assignment so the picker and the URL param agree.
//
// Lives in its own module (not App.tsx) so App.tsx exports only the
// component: mixed exports disable Vite's React Fast Refresh and turn every
// App edit into a full reload (the error-DX probe caught this live — the
// console message names the rule).
export const CURSOR_PALETTE = ['#5e6ad2', '#2fbf71', '#f2994a', '#e14f62', '#2d9cdb', '#bb6bd9'];
