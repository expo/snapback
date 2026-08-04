// The Snapback brand mark for the admin console sidebar.
//
// Returns the canonical toggle-switch mark from `brand/snapback-mark.svg` as an
// inline SVG string for Contract's `image svgSource=…`. The two pills are the
// visible ink; the two ring "eyes" on the left track and the snapped-back knob
// on the right are mask knockouts, so they read as transparent and let the
// sidebar show through — the same geometry as the brand master.
//
// The ink color is baked into the markup rather than applied with `tintColor`
// on purpose: `tintColor` rewrites every painted node to `currentColor` (see
// the dom-mirror's `applyInlineSvgTint`), which would also recolor the mask's
// black/white knockout fills and collapse the luminance mask. Baking the fill
// leaves the mask untouched.
//
// The console no longer renders the mark this way: inline `svgSource` needs an
// innerHTML sink, which the operator pages' Trusted Types policy refuses, so
// the sidebar serves `public/snapback-mark-{light,dark}.svg` as a themed
// `image` instead and `theme.ts` publishes the resolved scheme the renderer
// picks between them with. This module stays as the mark's parameterized
// source for surfaces that can take inline SVG.
//
// @ref LLP 0017#console-surfaces — sidebar brand presentation only; this is a
//   console surface detail, not an admin fact.

export function snapbackMark(ink: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="194 574 865 280" role="img" aria-label="Snapback">' +
    '<title>Snapback</title>' +
    '<defs>' +
    '<mask id="snapback-admin-knockout">' +
    '<rect x="194" y="574" width="865" height="280" fill="#fff"/>' +
    // left track: two ring eyes (annular knockouts) with ink pupils
    '<circle cx="354" cy="713" r="37.75" fill="none" stroke="#000" stroke-width="27.5"/>' +
    '<circle cx="546" cy="713" r="37.75" fill="none" stroke="#000" stroke-width="27.5"/>' +
    // right track: solid knob knockout
    '<circle cx="901" cy="712" r="46" fill="#000"/>' +
    '</mask>' +
    '</defs>' +
    `<g fill="${ink}" mask="url(#snapback-admin-knockout)">` +
    // left pill
    '<rect x="212" y="592" width="534" height="244" rx="122"/>' +
    // right pill: rounded right cap, concave left edge hugging the left pill
    '<path d="M 714.66 592 L 919 592 A 122 122 0 0 1 919 836 L 714.66 836 A 152 152 0 0 0 714.66 592 Z"/>' +
    '</g>' +
    '</svg>'
  );
}
