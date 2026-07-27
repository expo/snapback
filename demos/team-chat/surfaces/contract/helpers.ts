type Delivery = {
  roomId: string;
  unread: boolean;
};

export function unreadForRoom(rows: Delivery[], roomId: string): number {
  return rows.filter((row) => row.roomId === roomId && row.unread).length;
}

export function shortRoomId(roomId: string): string {
  return roomId.slice(0, 8);
}

function navigate(pathname: string): void {
  const params = new URLSearchParams(location.search);
  history.pushState({}, '', `${pathname}${params.size > 0 ? `?${params}` : ''}`);
  dispatchEvent(new CustomEvent('team-chat-contract:navigate'));
}

export function navigateToRoom(roomId: string): void {
  navigate(`/rooms/${encodeURIComponent(roomId)}`);
}

export function navigateHome(): void {
  navigate('/');
}
