import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { useAsset } from "snapback4/react";

export function AssetUri({
  id,
  style,
}: {
  id: string | null | undefined;
  style?: object;
}): React.JSX.Element | null {
  const asset = useAsset(id ?? null);
  if (!id || asset.status !== "ready") return null;
  return <Image source={{ uri: asset.url }} style={style as never} />;
}

export function useAssetUrl(id: string | null | undefined): string | undefined {
  const asset = useAsset(id ?? null);
  return asset.status === "ready" ? asset.url : undefined;
}

export function AssetOrPlaceholder({
  id,
  style,
}: {
  id: string | null | undefined;
  style?: object;
}): React.JSX.Element {
  const url = useAssetUrl(id);
  if (!url) return <View style={[styles.ph, style]} />;
  return <Image source={{ uri: url }} style={style as never} />;
}

const styles = StyleSheet.create({
  ph: { backgroundColor: "#E8EAEE" },
});
