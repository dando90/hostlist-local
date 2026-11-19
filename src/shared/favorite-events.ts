export const FAVORITES_CHANGED_STORAGE_KEY = "hostlist.favorites-changed.v1";

export function notifyFavoritesChanged(hostId: string) {
  try {
    window.localStorage.setItem(FAVORITES_CHANGED_STORAGE_KEY, `${hostId}:${Date.now()}`);
  } catch {
    // The database remains the source of truth if browser storage is unavailable.
  }
}
