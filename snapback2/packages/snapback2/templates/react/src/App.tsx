import { Auth } from "./Auth";
import { DevOverlay, useConnection } from "snapback2/react";

export function App() { return <Auth><Home /></Auth>; }

function Home() {
  const connection = useConnection();
  return <main><h1>Snapback 2</h1><p>Backend connection: {connection}.</p><DevOverlay /></main>;
}
