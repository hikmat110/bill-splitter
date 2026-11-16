// Per-user "has seen the welcome tour" flag. Mirrors draftStorage's stance on
// storage failures, but errs toward "seen": a private-mode webview that can't
// persist the flag must not replay the tour on every open.

const key = (userId: string) => `billsplit.tour.v1.${userId}`

export function hasSeenTour(userId: string): boolean {
  try {
    return localStorage.getItem(key(userId)) === '1'
  } catch {
    return true
  }
}

export function markTourSeen(userId: string): void {
  try {
    localStorage.setItem(key(userId), '1')
  } catch {
    // ignore
  }
}
