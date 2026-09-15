import { ProfileForm } from "@snapback-bench/social-ui";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { useClient, useMutation, useQuery } from "snapback4/react";
import { api } from "../../src/api.generated";
import { useAssetUrl } from "../../src/AssetMedia";
import { WebFileButton } from "../../src/WebFile";
import { settle } from "../../src/ops";

export default function EditProfile(): React.JSX.Element {
  const router = useRouter();
  const client = useClient();
  const me = useQuery(api.me, {});
  const setProfile = useMutation(api.setProfile);
  const data = me && !("loading" in me) && !("denied" in me) ? me.data : null;
  const [values, setValues] = useState({
    displayName: "",
    handle: "",
    bio: "",
    location: "",
    link: "",
  });
  const [error, setError] = useState<string | undefined>();
  const avatar = useAssetUrl(data?.avatar?.id);

  useEffect(() => {
    if (!data) return;
    setValues({
      displayName: data.displayName,
      handle: data.handle,
      bio: data.bio ?? "",
      location: data.location ?? "",
      link: data.link ?? "",
    });
  }, [data]);

  async function onAvatar(files: File[]) {
    const file = files[0];
    if (!file) return;
    const uploaded = await client.upload(await file.arrayBuffer());
    if (!uploaded.ok) return;
    await settle(client, api.setAvatar, { avatar: { id: uploaded.asset.id } });
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#fff" }}>
      <WebFileButton testID="sm-profile-avatar-file" accept="image/*" onFiles={(f) => void onAvatar(f)} />
      <ProfileForm
        mode="edit"
        values={values}
        avatarUri={avatar}
        onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
        onPressAvatar={() =>
          (document.getElementById("sm-profile-avatar-file") as HTMLInputElement | null)?.click()
        }
        onPressSave={async (next) => {
          const write = await setProfile.run({
            displayName: next.displayName,
            handle: next.handle,
            bio: next.bio,
            location: next.location,
            link: next.link || "https://example.com/user",
          });
          if (write.state === "failed") {
            setError(write.why.message ?? write.why.code);
            return;
          }
          router.replace("/me");
        }}
        errorText={error}
      />
    </ScrollView>
  );
}
