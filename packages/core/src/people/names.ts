/** First word of a display name ("Ava" for " Ava Chen"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}
