import { lowerSource, mechanicalBoundRewrite, typecheckSource } from "./compiler";
import { rustCheck } from "./rust-check";

export type GauntletDisposition = "unchanged" | "mechanical" | "refused";
export type GauntletResult = {
  family: "codex" | "fable";
  shape: number;
  disposition: GauntletDisposition;
  operations: number;
  reason: string;
  source: string;
};

export function extractGauntlet(markdown: string): Array<{ shape: number; source: string }> {
  const gauntletStart = markdown.indexOf("### 2. The Clique gauntlet");
  const gauntletEnd = markdown.indexOf("### 3. The spike", gauntletStart);
  const section = markdown.slice(gauntletStart, gauntletEnd < 0 ? undefined : gauntletEnd);
  const headings = [...section.matchAll(/\*\*(\d+)\.[^\n]*\*\*/g)];
  return headings.map((heading, index) => {
    const start = heading.index! + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1]!.index! : section.length;
    const body = section.slice(start, end);
    const blocks = [...body.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)].map((match) => match[1]!.trimEnd());
    return { shape: Number(heading[1]), source: blocks.join("\n\n") };
  });
}

export function assessGauntlet(
  family: "codex" | "fable",
  markdown: string,
  libText: string,
): GauntletResult[] {
  return extractGauntlet(markdown).map(({ shape, source }) => {
    if (!source.trim()) return { family, shape, disposition: "refused", operations: 0, reason: "no TypeScript data program in shape", source };
    const file = `${family}-${shape}.ts`;
    const sourceLib = withoutRedeclaredAmbientConstants(libText, source);
    const first = lowerSource(source, file, sourceLib);
    if (first.ok) {
      if (first.programs.length === 0) {
        return {
          family,
          shape,
          disposition: "unchanged",
          operations: 0,
          reason: "schema-only module; no exported data operation to emit",
          source,
        };
      }
      const checked = rustCheck(first.programs, "synthetic");
      const error = checked.find((item) => item.error)?.error;
      if (error?.family === "E_BOUND") {
        const rewrite = mechanicalBoundRewrite(source);
        const fixed = rewrite === source ? undefined : lowerSource(rewrite, `fixed-${file}`, sourceLib);
        if (fixed?.ok && fixed.programs.length > 0
          && rustCheck(fixed.programs, "synthetic").every((item) => item.error === null)) {
          return { family, shape, disposition: "mechanical", operations: fixed.programs.length, reason: "E_BOUND", source };
        }
      }
      return error
        ? { family, shape, disposition: "refused", operations: first.programs.length, reason: `${error.family}: ${error.message}`, source }
        : { family, shape, disposition: "unchanged", operations: first.programs.length, reason: "all exported data programs lowered and certified", source };
    }
    if (!first.ok && first.diagnostics[0]?.rewrite !== source) {
      const rewrite = first.diagnostics[0]!.rewrite;
      const fixedTypes = typecheckSource(rewrite, `fixed-${file}`, sourceLib);
      const fixed = fixedTypes.length === 0 ? lowerSource(rewrite, `fixed-${file}`) : undefined;
      if (fixed?.ok && fixed.programs.length > 0) {
        const checked = rustCheck(fixed.programs, "synthetic");
        if (checked.every((item) => item.error === null)) {
          return {
            family,
            shape,
            disposition: "mechanical",
            operations: fixed.programs.length,
            reason: first.diagnostics[0]!.family,
            source,
          };
        }
      }
    }
    const reason = first.ok
      ? "shape contains no exported query or mutation"
      : `${first.diagnostics[0]!.family}: ${first.diagnostics[0]!.message}`;
    return { family, shape, disposition: "refused", operations: first.ok ? 0 : 0, reason, source };
  });
}

function withoutRedeclaredAmbientConstants(libText: string, source: string): string {
  const declared = new Set([...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]!));
  return libText
    .split("\n")
    .filter((line) => {
      const match = /^declare const ([A-Za-z_$][\w$]*):/.exec(line);
      return !match || !declared.has(match[1]!);
    })
    .join("\n");
}

if (import.meta.main) {
  const root = decodeURIComponent(new URL("../../../../", import.meta.url).pathname);
  const baseLib = await Bun.file(new URL("../lib.d.ts", import.meta.url)).text();
  const gauntletLib = await Bun.file(new URL("../gauntlet.d.ts", import.meta.url)).text();
  const codex = await Bun.file(`${root}llp/reviews/0329.014-bounded-data-programs.codex.r3.md`).text();
  const fable = await Bun.file(`${root}llp/reviews/0329.014-bounded-data-programs.fable.r3.md`).text();
  const results = [
    ...assessGauntlet("codex", codex, `${baseLib}\n${gauntletLib}`),
    ...assessGauntlet("fable", fable, `${baseLib}\n${gauntletLib}`),
  ];
  console.log(JSON.stringify(results, null, 2));
}
