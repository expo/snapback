// Kept as the reproduction entry point; the asserted helper belongs to the SDK tests.
import {recoverTimeline} from '../../packages/snapback4/test/helpers/timeline-recovery.mjs';
export {recoverTimeline};
console.log(JSON.stringify(await recoverTimeline(),null,2));
