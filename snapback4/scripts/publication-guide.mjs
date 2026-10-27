// Publication extractors deliberately consume every bounded reference section.
// Builders should read one section at a time; this is a programmatic corpus check.
import { spawnSync } from "node:child_process";
export function guideReference(cli, card, options = {}) {
  const invoke = args => {
    const result = spawnSync(process.execPath, [cli,"guide",card,...args], {encoding:"utf8",timeout:30_000,maxBuffer:4*1024*1024,...options});
    if (result.status !== 0) throw Error(result.stderr + result.stdout);
    return result.stdout;
  };
  const index = invoke(["--sections"]);
  const numbers = [...index.matchAll(/^\s*(\d+)\. /gm)].map(match=>match[1]);
  if (!numbers.length) return invoke(["--full","--repeat"]);
  const pieces = index.includes("1. Opening (") ? [] : [invoke(["--section","opening","--repeat"])];
  for (const number of numbers) pieces.push(invoke(["--section",number,"--repeat"]));
  return pieces.join("\n\n");
}
