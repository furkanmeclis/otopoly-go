/**
 * A web path that arrived while the user couldn't open it yet (signed out, picking an organization).
 * Kept in memory only: it belongs to this app launch. `NotificationsHost` replays it once the
 * user is inside an organization.
 */
let pending: string | null = null;

export function setPendingLink(webPath: string | null) {
  pending = webPath;
}

export function takePendingLink() {
  const value = pending;
  pending = null;
  return value;
}
