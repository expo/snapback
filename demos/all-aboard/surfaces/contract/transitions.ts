// Progressive web-only shared-element polish for compact-train selection.
// This is presentation enhancement, not input recognition: the router and
// Contract pager own every command/binding (Exact LLP 0336 P1/P2).

export function installTrainSelectionTransition(root: HTMLElement): () => void {
  const q = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const reducedMotion =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let morphing = false;
  let redispatching = false;

  const onCaptureClick = (event: MouseEvent) => {
    if (redispatching || morphing || reducedMotion) return;
    const doc = document as Document & {
      startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> };
    };
    if (typeof doc.startViewTransition !== 'function' || !q('station-screen') || q('directions-sheet')) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const row = target.closest('[data-testid^="train-"]');
    if (!(row instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const oldHero = q('hero-departure');
    row.style.viewTransitionName = 'aa-train-in';
    if (oldHero) oldHero.style.viewTransitionName = 'aa-train-out';
    morphing = true;
    const transition = doc.startViewTransition(async () => {
      redispatching = true;
      try {
        row.click();
      } finally {
        redispatching = false;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      q('hero-departure')?.style.setProperty('view-transition-name', 'aa-train-in');
    });
    transition.finished.catch(() => {}).finally(() => {
      morphing = false;
      row.style.removeProperty('view-transition-name');
      oldHero?.style.removeProperty('view-transition-name');
      q('hero-departure')?.style.removeProperty('view-transition-name');
    });
  };

  root.addEventListener('click', onCaptureClick, true);
  return () => root.removeEventListener('click', onCaptureClick, true);
}
