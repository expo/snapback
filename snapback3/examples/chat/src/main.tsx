import { createRoot } from "react-dom/client";
import { createClient } from "snapback3/client";
import { SnapbackProvider } from "snapback3/react";
import { App } from "./workspace";

// Registration is progressive enhancement. A failed installation leaves the
// working page alone; successful updates take effect after old tabs close.
if ('serviceWorker' in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register('/service-worker.js', {
    scope: '/', updateViaCache: 'none',
  }).catch(() => {});
}

const client = createClient({ url: window.location.origin });
createRoot(document.getElementById("root")!).render(
  <SnapbackProvider client={client}>
    <App client={client} />
  </SnapbackProvider>,
);
