// All Aboard — temporary web interaction glue (Exact LLP 0336 P1/P2).
//
// P1 moved home-screen pager recognition, wheel handling, click suppression,
// arrow keys, and mnemonic keys into Contract. Two deliberately narrow slices
// survive until framework-owned presentation/motion primitives replace them:
//
//   - swipe right dismisses stations, settings, and trip screens;
//   - Escape / ArrowLeft activate the same visible Back affordance;
//   - compact-train taps use the progressive View Transitions morph.
//
// The directions modal is not handled here: its `dismiss=` declaration is
// honored by the Contract modal barrier.

type Cleanup = () => void;

const SLOP_PX = 12;
const COMMIT_PX = 64;
const COMMIT_VELOCITY = 0.5;

export function installSheetDismissal(root: HTMLElement): Cleanup {
  const q = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const targetId = () => q('trip-screen')
    ? 'trip-back'
    : q('settings-screen')
      ? 'settings-back'
      : q('stations-screen')
        ? 'stations-back'
        : null;

  let pointerId: number | null = null;
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let mode: 'horizontal' | 'rejected' | null = null;
  let samples: Array<{ t: number; x: number }> = [];

  const onPointerDown = (event: PointerEvent) => {
    if (!targetId() || !event.isPrimary || event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest('input, textarea, select')) return;
    pointerId = event.pointerId;
    x0 = event.clientX;
    y0 = event.clientY;
    dx = 0;
    mode = null;
    samples = [{ t: performance.now(), x: x0 }];
  };

  const onPointerMove = (event: PointerEvent) => {
    if (pointerId === null || event.pointerId !== pointerId || mode === 'rejected') return;
    dx = event.clientX - x0;
    const dy = event.clientY - y0;
    samples.push({ t: performance.now(), x: event.clientX });
    if (samples.length > 6) samples.shift();
    if (mode === null) {
      if (Math.abs(dx) > SLOP_PX && Math.abs(dx) > Math.abs(dy) * 1.25) mode = 'horizontal';
      else if (Math.abs(dy) > SLOP_PX + 2 && Math.abs(dy) > Math.abs(dx) * 1.25) mode = 'rejected';
    }
  };

  const endPointer = (event: PointerEvent, cancelled: boolean) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    pointerId = null;
    const engaged = mode === 'horizontal';
    mode = null;
    if (!engaged || cancelled || dx <= 0) return;
    const first = samples[0];
    const last = samples.at(-1);
    const velocity = first && last ? (last.x - first.x) / Math.max(1, last.t - first.t) : 0;
    if (dx < COMMIT_PX && velocity < COMMIT_VELOCITY) return;
    const id = targetId();
    if (!id) return;
    event.preventDefault();
    q(id)?.click();
  };

  const onPointerUp = (event: PointerEvent) => endPointer(event, false);
  const onPointerCancel = (event: PointerEvent) => endPointer(event, true);
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) {
      if (event.key === 'Escape') target.blur();
      return;
    }
    if (event.key !== 'Escape' && event.key !== 'ArrowLeft') return;
    const id = targetId();
    if (!id) return;
    event.preventDefault();
    q(id)?.click();
  };

  // Preserve the upstream tap-to-select morph added while this work was in
  // flight. It is unrelated to pager recognition and remains progressive
  // enhancement until Contract owns shared-element transitions.
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

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('click', onCaptureClick, true);
  window.addEventListener('keydown', onKeyDown);

  return () => {
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel);
    root.removeEventListener('click', onCaptureClick, true);
    window.removeEventListener('keydown', onKeyDown);
  };
}
