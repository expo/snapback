import {dataAdapter} from './data/snapback.ts';

/** Adapter-backed equivalent of the pin's optional route warm-up. */
export async function preload(projectName: string): Promise<void> {
  await dataAdapter.query('issuePreloadV2', {projectName});
}
