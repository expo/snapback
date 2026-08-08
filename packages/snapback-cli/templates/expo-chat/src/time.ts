export function shortTime(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function inboxTime(value: number) {
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
