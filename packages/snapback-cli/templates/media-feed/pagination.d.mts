export declare function mergePagedArchive<Row extends { _id: string; pageKey: string }>(input: {
  archive: readonly Row[];
  head: readonly Row[];
  page?: readonly Row[];
  previousHead?: readonly Row[];
}): readonly Row[];
