import { useAuth, useLink, useSignedInViewer } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";

// Your first screen: replace it with your own. `snapback4 check` writes
// snapback/generated/api.ts, a typed handle for each operation in
// snapback/*.q. Read with useQuery(api.yourQuery, args) and render the Read
// with matchRead, or usePage(api.yourList, args) for a query that takes
// `c: cursor ?`; write with useMutation(api.yourMutation). Name hook results
// in props as UseQuery<typeof api.op>, UsePage<…> and UseMutation<…>
// (`npx snapback4 guide client`).
function Home() {
  const auth = useAuth(), link = useLink();
  // Never null here: Account renders this screen only once signed in.
  const viewer = useSignedInViewer();
  return <main>
    <header>
      <h1>Signed in</h1>
      <span role="status">{viewer} · {link === "online" ? "Online" : "Offline"}</span>
      <button onClick={() => void auth.logout()}>Sign out</button>
    </header>
    <p>Your operations, from snapback/generated/api.ts: {Object.keys(api).join(", ") || "none yet"}</p>
  </main>;
}
