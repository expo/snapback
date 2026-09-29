import { useState } from "react";
import { router } from "expo-router";
import { Button, ScrollView, Text, TextInput } from "react-native";
import { useAuth, useMutation, useQuery, useViewer } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { Avatar, PhotoPicker, ReadState } from "./ui";

export default function Profile() {
  const viewer = useViewer()!, auth = useAuth();
  const profile = useQuery(api.profile, { principal: viewer });
  const save = useMutation(api.saveProfile), avatar = useMutation(api.placeAvatar);
  const follow = useMutation(api.follow), unfollow = useMutation(api.unfollow);
  const [name, setName] = useState(""), [principal, setPrincipal] = useState("");
  return <ScrollView contentContainerStyle={{ padding: 16 }}>
    <Text selectable>{viewer}</Text><Text>Share this account ID to follow or invite.</Text>
    <ReadState read={profile} />
    {"data" in profile && <><Text>{profile.data?.name}</Text><Avatar id={profile.data?.avatar?.id ?? null} /></>}
    <TextInput accessibilityLabel="Display name" value={name} onChangeText={setName} maxLength={80} />
    <Button title="Save profile" disabled={!name.trim() || save.inFlight} onPress={() => void save.run({ name })} />
    {"data" in profile && profile.data && <PhotoPicker title="Choose avatar" onUploaded={id => { void avatar.run({ avatar: { id } }); }} />}
    <TextInput accessibilityLabel="Account to follow" value={principal} onChangeText={setPrincipal} />
    <Button title="Follow" disabled={!principal || follow.inFlight} onPress={() => void follow.run({ principal })} />
    <Button title="Unfollow" disabled={!principal || unfollow.inFlight} onPress={() => void unfollow.run({ principal })} />
    {principal && principal !== viewer && <Person principal={principal} />}
    {[save.last, avatar.last, follow.last, unfollow.last].map((write, index) => write?.state === "failed" ? <Text key={index}>{write.why.message}</Text> : null)}
    <Button title="Sign out" onPress={() => void auth.logout()} />
  </ScrollView>;
}

function Person({ principal }: { principal: string }) {
  const profile = useQuery(api.profile, { principal });
  const name = "data" in profile ? profile.data?.name : null;
  return <><ReadState read={profile} /><Button title={`Message ${name ?? principal}`}
    onPress={() => router.push({ pathname: "/dm/[other]", params: { other: principal } })} /></>;
}
