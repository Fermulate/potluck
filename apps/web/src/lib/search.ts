/**
 * Tiny search param validators for route definitions. Route files are part of the first
 * download, so they stay free of schema libraries. Anything malformed is dropped.
 *
 * Two router habits shape them:
 * - The address is read as JSON where it can be, so `?q=30` arrives as the number 30 and
 *   `?new=true` as a boolean. Text params take numbers and booleans back as text.
 * - TanStack Router lays a route's validated params over the raw ones, so a key a validator
 *   leaves out still reaches `useSearch()` as whatever the address held. A validator therefore
 *   returns every key it owns, `undefined` when the value is no good.
 */
type Search = Record<string, unknown>

/** A param as text: strings as they are, numbers and booleans the address parsed back to text. */
export function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
    return String(value)
  }
  return undefined
}

/** `{ [key]: string }`, the param as text, or `undefined` for anything else. */
export function stringParam<K extends string>(key: K) {
  return (search: Search): { [P in K]?: string } =>
    ({ [key]: textValue(search[key]) }) as { [P in K]?: string }
}

/** `{ [key]: boolean }` when the param is a boolean, `undefined` otherwise. */
export function booleanParam<K extends string>(key: K) {
  return (search: Search): { [P in K]?: boolean } =>
    ({ [key]: typeof search[key] === 'boolean' ? search[key] : undefined }) as {
      [P in K]?: boolean
    }
}

export const redirectSearch = stringParam('redirect')
