export interface SnippetParts {
  /** Text before the match, with a leading "…" when it was cut. */
  before: string
  /** The matched words as written in the text; empty when the query is not in it. */
  match: string
  /** Text after the match, with a trailing "…" when it was cut. */
  after: string
}

/**
 * A short piece of `text` around the first match of `query` (case-insensitive), split so the
 * match can be highlighted. The window is small enough that the match stays on screen in two
 * lines on a phone, and cuts fall on spaces where one is near.
 */
export function snippetParts(text: string, query: string, width = 56): SnippetParts {
  const flat = text.replace(/\s+/g, ' ').trim()
  const needle = query.trim()
  const at = needle ? flat.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1
  if (at < 0) {
    return flat.length <= width
      ? { before: flat, match: '', after: '' }
      : { before: `${flat.slice(0, width).trimEnd()}…`, match: '', after: '' }
  }

  const matchEnd = at + needle.length
  // A little more room after the match than before it reads more naturally.
  const room = Math.max(0, width - needle.length)
  let start = Math.max(0, at - Math.floor(room / 3))
  let end = Math.min(flat.length, matchEnd + (room - (at - start)))
  start = Math.max(0, Math.min(start, end - width))
  if (start > 0) {
    const space = flat.indexOf(' ', start)
    if (space >= 0 && space < at && space - start < 10) start = space + 1
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end)
    if (space >= matchEnd && end - space < 10) end = space
  }
  return {
    before: `${start > 0 ? '…' : ''}${flat.slice(start, at)}`,
    match: flat.slice(at, matchEnd),
    after: `${flat.slice(matchEnd, end).trimEnd()}${end < flat.length ? '…' : ''}`,
  }
}

/** The same piece as plain text. */
export function snippetAround(text: string, query: string, width = 56): string {
  const { before, match, after } = snippetParts(text, query, width)
  return `${before}${match}${after}`
}
