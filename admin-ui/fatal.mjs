// Render boot failures without crossing an HTML parser. The response-backed
// error message is untrusted text and this origin holds the local admin token.
export function renderFatal(document, message) {
  const root = document.getElementById('exact-root');
  if (!root) return false;

  const pre = document.createElement('pre');
  pre.style.cssText =
    'margin:24px;color:#c0362c;font:13px ui-monospace,Menlo,monospace;white-space:pre-wrap';
  pre.textContent = `Admin console failed to start:\n${message}`;
  root.replaceChildren(pre);
  return true;
}
