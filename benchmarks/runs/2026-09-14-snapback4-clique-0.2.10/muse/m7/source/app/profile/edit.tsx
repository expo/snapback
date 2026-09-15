import React, { useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ProfileForm, ProfileFormValues } from "../../ui-kit/src/ProfileForm";
import { useClient, useQuery } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { readData, useAssetUrl, uploadFile } from "../../lib/helpers";

export default function EditProfile() {
  const router = useRouter();
  const client: any = useClient();
  const profRead = useQuery(api.myProfile, {});
  const profile = readData<any>(profRead);
  const currentAvatar = useAssetUrl(profile?.avatar?.id);
  const [values, setValues] = useState<ProfileFormValues | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<any>(null);
  if (!profile) return <View style={{ padding: 24 }}><Text>Loading…</Text></View>;
  const v: ProfileFormValues = values ?? {
    displayName: profile.displayName ?? "",
    handle: profile.handle ?? "",
    bio: profile.bio ?? "",
    location: profile.location ?? "",
    link: profile.link ?? "",
  };
  const save = async (vals: ProfileFormValues) => {
    setSaving(true);
    setError(undefined);
    try {
      const args: any = {
        displayName: vals.displayName,
        handle: vals.handle.trim(),
        bio: vals.bio || null,
        location: vals.location || null,
        link: vals.link || null,
      };
      if (avatarFile) args.avatar = { id: await uploadFile(client, avatarFile) };
      const w = await client.mutate(api.upsertProfile, args);
      if (w.state === "failed") {
        setError(`Save failed: ${w.why?.code ?? "unknown"}`);
        setSaving(false);
        return;
      }
      router.back();
    } catch (err: any) {
      setError(`Save failed: ${err?.message ?? err}`);
      setSaving(false);
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: "#fff", padding: 12 }}>
      <ProfileForm
        mode="edit"
        values={v}
        avatarUri={avatarPreview ?? currentAvatar ?? undefined}
        onChange={(patch) => setValues({ ...v, ...patch })}
        onPressAvatar={() => inputRef.current?.click?.()}
        onPressSave={save}
        saving={saving}
        errorText={error}
      />
      {Platform.OS === "web"
        ? React.createElement("input", {
            ref: inputRef,
            type: "file",
            accept: "image/jpeg,image/png,image/webp",
            style: { display: "none" },
            testID: "sm-profile-avatar-file",
            onChange: (e: any) => {
              const f = e.target.files?.[0];
              if (f) {
                setAvatarFile(f);
                setAvatarPreview(URL.createObjectURL(f));
              }
              e.target.value = "";
            },
          } as any)
        : null}
    </View>
  );
}
