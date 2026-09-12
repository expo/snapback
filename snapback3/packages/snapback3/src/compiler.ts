import { lowerProject } from "../../compiler/src/project";
import type { ProjectResult } from "../../compiler/src/ir";

export { lowerSeed } from "../../compiler/src/project";
export type { FrontendDiagnostic, ProjectJson, ProjectResult } from "../../compiler/src/ir";

/** Compile Quarry and check effect TypeScript without executing application code.
 * The server independently certifies the resulting project before using it. */
export function compileProject(root: string, options: { adhocSource?: string } = {}): Promise<ProjectResult> {
  return lowerProject(root, options);
}
