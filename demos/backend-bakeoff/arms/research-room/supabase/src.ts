import { createClient } from "@supabase/supabase-js";
import "./style.css";

const url = import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:58431";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const status = document.querySelector<HTMLDivElement>("#status")!;

if (!key) {
  status.textContent = "Build-time shell ready; runtime credentials are injected only for local acceptance.";
} else {
  const supabase = createClient(url, key);
  const { data, error } = await supabase.from("rooms").select("name");
  status.textContent = error ? "Sign in to view a room." : `${data.length} authorized rooms`;
}
