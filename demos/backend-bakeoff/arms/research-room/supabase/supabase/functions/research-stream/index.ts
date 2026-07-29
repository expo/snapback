import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async () => {
  const serverCredential = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return Response.json({ ok: true, serverCredentialLoaded: Boolean(serverCredential) });
});
