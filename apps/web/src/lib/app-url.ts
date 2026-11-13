/** Public origin for links people share (invites, feeds). Falls back to wherever we are. */
export function appOrigin(): string {
  const configured = import.meta.env.VITE_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  return window.location.origin
}

export function inviteUrl(code: string): string {
  return `${appOrigin()}/join/${encodeURIComponent(code)}`
}

/** A plan's guest availability link (`/a/<code>`), short enough to paste in a group chat. */
export function guestUrl(code: string): string {
  return `${appOrigin()}/a/${encodeURIComponent(code)}`
}
