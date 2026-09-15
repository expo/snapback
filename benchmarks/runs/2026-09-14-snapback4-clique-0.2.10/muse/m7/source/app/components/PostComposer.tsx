import React, { useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Composer, ComposerAttachment } from "../../ui-kit/src/Composer";
import { useClient } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { uploadFile, captureVideoPoster } from "../../lib/helpers";

/** Inline post composer (feed) — also used by the /compose route. */
export function PostComposer({ onPosted }: { onPosted?: () => void }) {
  const client: any = useClient();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [files, setFiles] = useState<{ kind: "image" | "video"; file: File }[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<any>(null);

  const pick = () => inputRef.current?.click?.();

  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    setError(undefined);
    const nextAtt = [...attachments];
    const nextFiles = [...files];
    for (const f of Array.from(list)) {
      const isVideo = f.type.startsWith("video/");
      const isImage = f.type.startsWith("image/");
      if (!isVideo && !isImage) {
        setError("Only JPEG/PNG/WebP images or MP4 video");
        continue;
      }
      if (isVideo && nextFiles.length > 0) {
        setError("A post carries one video and no images");
        continue;
      }
      if (!isVideo && (nextFiles.some((x) => x.kind === "video") || nextFiles.filter((x) => x.kind === "image").length >= 4)) {
        setError("A post carries at most 4 images and no video");
        continue;
      }
      const url = URL.createObjectURL(f);
      if (isVideo) {
        const poster = (await captureVideoPoster(url)) ?? transparentPixel();
        nextAtt.push({ kind: "video", uri: url, posterUri: poster });
        nextFiles.push({ kind: "video", file: f });
      } else {
        nextAtt.push({ kind: "image", uri: url });
        nextFiles.push({ kind: "image", file: f });
      }
    }
    setAttachments(nextAtt);
    setFiles(nextFiles);
  };

  const submit = async (body: string) => {
    if (sending) return;
    setSending(true);
    setError(undefined);
    try {
      const hasVideo = files.some((f) => f.kind === "video");
      const images = files.filter((f) => f.kind === "image");
      const kind = hasVideo ? "video" : images.length > 0 ? "images" : "text";
      const args: any = { body, kind };
      if (images[0]) args.i1 = { id: await uploadFile(client, images[0].file) };
      if (images[1]) args.i2 = { id: await uploadFile(client, images[1].file) };
      if (images[2]) args.i3 = { id: await uploadFile(client, images[2].file) };
      if (images[3]) args.i4 = { id: await uploadFile(client, images[3].file) };
      if (hasVideo) args.clip = { id: await uploadFile(client, files.find((f) => f.kind === "video")!.file) };
      const w = await client.mutate(api.createPost, args);
      if (w.state === "failed") {
        setError(`Post failed: ${w.why?.code ?? "unknown"}`);
      } else {
        setText("");
        setAttachments([]);
        setFiles([]);
        onPosted?.();
      }
    } catch (err: any) {
      setError(`Post failed: ${err?.message ?? err}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <View>
      <Composer
        variant="post"
        value={text}
        onChangeText={setText}
        onSend={submit}
        maxLength={500}
        sending={sending}
        onPressAttach={pick}
        attachments={attachments}
        onRemoveAttachment={(i) => {
          setAttachments(attachments.filter((_, j) => j !== i));
          setFiles(files.filter((_, j) => j !== i));
        }}
      />
      {Platform.OS === "web"
        ? React.createElement("input", {
            ref: inputRef,
            type: "file",
            accept: "image/jpeg,image/png,image/webp,video/mp4",
            multiple: true,
            style: { display: "none" },
            testID: "sm-compose-file",
            onChange: (e: any) => {
              onFiles(e.target.files);
              e.target.value = "";
            },
          } as any)
        : null}
      {error ? <Text testID="sm-compose-error">{error}</Text> : null}
    </View>
  );
}

function transparentPixel(): string {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}
