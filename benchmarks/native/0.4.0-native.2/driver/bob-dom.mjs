// Executed inside the browser against the supplied kit's ordinary DOM.
export function messageRows(nodes) {
 return nodes.map(n => ({
  messageId: n.getAttribute('aria-valuetext'),
  body: n.querySelectorAll('[data-testid="sm-convo-body"]').length === 1
   ? n.querySelector('[data-testid="sm-convo-body"]').textContent : null,
 }));
}
