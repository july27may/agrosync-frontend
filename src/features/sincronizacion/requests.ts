export const SYNC_REQUEST = 'agrosync:sync-request'

export function notifySyncRequest() {
  window.dispatchEvent(new Event(SYNC_REQUEST))
}
