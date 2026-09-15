import React, { useEffect, useRef } from "react";
import { Platform, Pressable, Text, View } from "react-native";

export function WebFileButton({
  testID,
  accept,
  multiple,
  label,
  onFiles,
}: {
  testID: string;
  accept: string;
  multiple?: boolean;
  label?: string;
  onFiles: (files: File[]) => void;
}): React.JSX.Element | null {
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const existing = document.getElementById(testID);
    const el = (existing instanceof HTMLInputElement ? existing : document.createElement("input")) as HTMLInputElement;
    el.type = "file";
    el.id = testID;
    el.setAttribute("data-testid", testID);
    el.setAttribute("accept", accept);
    el.multiple = !!multiple;
    el.style.position = "fixed";
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.zIndex = "1";
    el.style.width = "1px";
    el.style.height = "1px";
    el.style.opacity = "0";
    el.style.overflow = "hidden";
    el.style.pointerEvents = "auto";
    const handler = () => {
      const list = el.files;
      if (!list || list.length === 0) return;
      onFilesRef.current(Array.from(list));
    };
    el.addEventListener("change", handler);
    if (!existing) document.body.appendChild(el);
    return () => {
      el.removeEventListener("change", handler);
    };
  }, [accept, multiple, testID]);

  if (Platform.OS !== "web") {
    return label ? (
      <Pressable testID={testID} onPress={() => undefined}>
        <Text>{label}</Text>
      </Pressable>
    ) : (
      <View testID={testID} />
    );
  }
  return label ? (
    <Pressable
      testID={`${testID}-trigger`}
      onPress={() => (document.getElementById(testID) as HTMLInputElement | null)?.click()}
    >
      <Text>{label}</Text>
    </Pressable>
  ) : (
    <View />
  );
}
