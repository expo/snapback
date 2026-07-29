import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/fixture/research",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(
      JSON.stringify({
        recordId: "external-record-001",
        payloadHash: "sha256:deterministic-external-fixture-v1",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }),
});

export default http;
