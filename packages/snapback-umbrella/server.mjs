// @ref LLP 0253#s31-the-umbrella-package — the familiar package is a thin,
// deletable import-coherence layer; implementation remains in its owners.
export { defineSchema, defineTable } from '@expo/snapback-codegen/define';
export { action, defineAssetUpload, mutation, query } from '@expo/snapback-codegen/familiar';
