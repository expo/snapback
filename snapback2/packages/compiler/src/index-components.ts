import type { IndexComponent, SearchContract } from "./ir";
// Compiler metadata uses the foundation's literal type without loading its generated Unicode tables.
export const SEARCH_CONTRACT: SearchContract = "u17-nfc-scf-nfc-wsp-p";
export const MAX_SEARCH_SOURCE_SCALARS = 0x3fffffff;

export const columnComponents = (columns: readonly string[]): IndexComponent[] => columns.map(Column => ({ Column }));
export const columnAt = (components: readonly IndexComponent[], position: number): string | undefined => {
  const component = components.at(position);
  return component && "Column" in component ? component.Column : undefined;
};
export const derivedPosition = (components: readonly IndexComponent[]): number => components.findIndex(c => "WordPrefixes" in c);
export const ordinaryColumns = (components: readonly IndexComponent[]): string[] | undefined =>
  components.every(c => "Column" in c) ? components.map(c => (c as { Column: string }).Column) : undefined;
export const componentLabel = (component: IndexComponent): string => "Column" in component
  ? component.Column : `wordPrefixes(${component.WordPrefixes.fields.join(", ")})`;

// @ref LLP 1001#unicode-search-foundation — derived slots have no source-column identity and admit only bounded text fields.
export function componentProblem(
  components: unknown, unique: boolean,
  column: (name: string) => { indexable: boolean; textMax?: number } | undefined,
): string | undefined {
  if (!Array.isArray(components) || !components.length) return "index components must be non-empty";
  if (components.length > 8) return "indexes support at most 8 components";
  const names = new Set<string>();
  let derived = false;
  for (const [position, component] of components.entries()) {
    if (!component || typeof component !== "object" || Array.isArray(component) || Object.keys(component).length !== 1) return "index components must be Column or WordPrefixes descriptors";
    if (typeof component.Column === "string") {
      if (names.has(component.Column)) return `index repeats column ${component.Column}`;
      names.add(component.Column);
      const type = column(component.Column);
      if (!type) return `index names unknown column ${component.Column}`;
      if (!type.indexable) return `index column ${component.Column} has non-indexable type`;
    } else if (component.WordPrefixes) {
      const value = component.WordPrefixes;
      if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "contract,fields"
        || value.contract !== SEARCH_CONTRACT) return "wordPrefixes requires the pinned Unicode search contract";
      if (derived) return "an index permits exactly one wordPrefixes component";
      derived = true;
      if (unique) return "wordPrefixes indexes cannot be unique";
      if (position === components.length - 1) return "wordPrefixes requires an ordinary ordering suffix";
      if (!Array.isArray(value.fields) || !value.fields.length || value.fields.some((v: unknown) => typeof v !== "string")
        || new Set(value.fields).size !== value.fields.length) return "wordPrefixes requires distinct declared text fields";
      for (const field of value.fields) {
        const max = column(field)?.textMax;
        if (max === undefined || !Number.isSafeInteger(max) || max < 1 || max > MAX_SEARCH_SOURCE_SCALARS) {
          return `wordPrefixes field ${field} must be a declared bounded required or optional text column`;
        }
      }
    } else return "index components must be Column or WordPrefixes descriptors";
  }
}
