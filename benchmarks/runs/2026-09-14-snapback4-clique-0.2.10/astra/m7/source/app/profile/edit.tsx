import React, { useEffect, useState } from "react";
import { Text, ScrollView } from "react-native";
import { router } from "expo-router";
import * as Picker from "expo-image-picker";
import { useQuery, useAsset } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { ProfileForm } from "../../ui";
import { useApp } from "../../src/session";
import { Shell } from "../../src/common";
export default function Edit() {
  const { client, error, setError } = useApp();
  const r = useQuery(api.me, {});
  const p = "data" in r ? r.data : null;
  const [loaded, setLoaded] = useState(false);
  const [values, setValues] = useState({
    displayName: "",
    handle: "",
    bio: "",
    location: "",
    link: "",
  });
  const a = useAsset(p?.avatar?.id);
  useEffect(() => {
    if ("data" in r) {
      if (p)
        setValues({
          displayName: p.displayName,
          handle: p.handle,
          bio: p.bio,
          location: p.location,
          link: p.link ?? "",
        });
      setLoaded(true);
    }
  }, [p?.id, "data" in r]);
  async function save() {
    const w = await client.mutate(api.saveProfile, {
      ...values,
      link: values.link || null,
    });
    if (w.state === "failed") setError(w.why.code + ": " + w.why.message);
    else router.replace("/profile/me");
  }
  async function photo() {
    try {
      const pick = await Picker.launchImageLibraryAsync({
        mediaTypes: ["images"],
      });
      if (pick.canceled) return;
      const bytes = await (await fetch(pick.assets[0].uri)).arrayBuffer();
      const u = await client.upload(bytes);
      if (!u.ok) throw Error(u.why.message);
      const w = await client.mutate(api.avatar, { photo: { id: u.asset.id } });
      if (w.state === "failed") throw Error(w.why.message);
    } catch (e: any) {
      setError(e.message);
    }
  }
  if (!loaded)
    return (
      <Shell>
        <Text>Loading profile…</Text>
      </Shell>
    );
  return (
    <Shell>
      <ScrollView>
        <ProfileForm
          mode="edit"
          values={values}
          onChange={(patch) => setValues({ ...values, ...patch })}
          onPressSave={save}
          onPressAvatar={photo}
          avatarUri={a.status === "ready" ? a.url : undefined}
          errorText={error}
        />
      </ScrollView>
    </Shell>
  );
}
