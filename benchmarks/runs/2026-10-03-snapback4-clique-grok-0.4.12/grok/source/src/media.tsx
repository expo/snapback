import { createElement, useRef } from "react";
import { Platform } from "react-native";
import { useClient } from "snapback4/react";

export const VIDEO_POSTER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export async function blobFromUri(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return await response.blob();
}

export function HiddenFileInput({
  testID,
  accept,
  multiple,
  onFiles,
}: {
  testID: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  if (Platform.OS !== "web") return null;
  return createElement("input", {
    ref: input,
    type: "file",
    accept,
    multiple: !!multiple,
    "data-testid": testID,
    "aria-label": testID,
    style: { position: "absolute", width: 1, height: 1, opacity: 0.01, zIndex: 2 },
    onChange: (event: { currentTarget: HTMLInputElement }) => {
      const list = event.currentTarget.files;
      if (!list || list.length === 0) return;
      onFiles(Array.from(list));
      event.currentTarget.value = "";
    },
  });
}

export function useUploader() {
  const client = useClient();
  return async function upload(file: Blob) {
    const result = await client.upload(file);
    if (!result.ok) throw new Error(result.why.message);
    return result.asset;
  };
}
