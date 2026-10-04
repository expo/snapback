import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useAsset, useMutation, useQuery } from "snapback4/react";
import { isReady } from "snapback4/contract";
import { ProfileForm, type ProfileFormValues } from "@snapback-bench/social-ui";
import { api } from "../snapback/generated/api";
import { HiddenFileInput, useUploader } from "./media";
import { Platform } from "react-native";

export default function ProfileEdit() {
  const mine = useQuery(api.myProfile, {});
  const save = useMutation(api.saveProfile);
  const place = useMutation(api.placeAvatar);
  const upload = useUploader();
  const data = isReady(mine) ? mine.data : null;
  const [values, setValues] = useState<ProfileFormValues>({
    displayName: "",
    handle: "",
    bio: "",
    location: "",
    link: "",
  });
  useEffect(() => {
    if (!data) return;
    setValues({
      displayName: data.displayName,
      handle: data.handle,
      bio: data.bio ?? "",
      location: data.location ?? "",
      link: data.link ?? "",
    });
  }, [data?.id]);
  const avatar = useAsset(data?.avatar?.id ?? null);

  async function onAvatar(files: File[]) {
    const file = files[0];
    if (!file) return;
    const asset = await upload(file);
    await place.run({ avatar: { id: asset.id } });
  }

  if (!data) return null;
  return (
    <View>
      <HiddenFileInput testID="sm-profile-avatar-file" accept="image/*" onFiles={(files) => void onAvatar(files)} />
      <ProfileForm
        mode="edit"
        values={values}
        avatarUri={avatar.status === "ready" ? avatar.url : undefined}
        onChange={(patch) => setValues({ ...values, ...patch })}
        onPressAvatar={() => {
          if (Platform.OS !== "web") return;
          const node = document.querySelector('[data-testid="sm-profile-avatar-file"]') as HTMLInputElement | null;
          node?.click();
        }}
        onPressSave={async (next) => {
          const result = await save.run({
            displayName: next.displayName,
            handle: next.handle,
            bio: next.bio || null,
            location: next.location || null,
            link: next.link || null,
          });
          if (result.state !== "failed") router.back();
        }}
        saving={save.inFlight}
        errorText={save.last?.state === "failed" ? save.last.why.message : undefined}
      />
    </View>
  );
}
