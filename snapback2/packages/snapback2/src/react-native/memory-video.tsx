import React, { useState } from "react";
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ViewProps } from "react-native";

interface Props extends ViewProps {
  source: string;
  onPlaybackStart(): void;
  onFinished(): void;
  onError(event: { nativeEvent: { message: string } }): void;
}
let Native: React.ComponentType<Props> | undefined;
export function memoryVideoAvailable(): boolean {
  return requireOptionalNativeModule("SnapbackMemoryVideo") !== null;
}
export function MemoryVideo(props: Props): React.ReactElement | null {
  const [finished, setFinished] = useState(false);
  if (finished) return null;
  Native ??= requireNativeView<Props>("SnapbackMemoryVideo");
  return <Native {...props} onPlaybackStart={() => props.onPlaybackStart()} onFinished={() => { setFinished(true); props.onFinished(); }} />;
}
