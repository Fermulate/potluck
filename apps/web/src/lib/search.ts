/**
 * Tiny search param validators for route definitions. Route files are part of the first
 * download, so they stay free of schema libraries. Anything malformed is dropped.
 */
type Search = Record<string, unknown>

/** `{ [key]: string }` when the param is a string, `{}` otherwise. */
export function stringParam<K extends string>(key: K) {
  return (search: Search): { [P in K]?: string } =>
    typeof search[key] === 'string' ? ({ [key]: search[key] } as { [P in K]?: string }) : {}
}

/** `{ [key]: boolean }` when the param is a boolean, `{}` otherwise. */
export function booleanParam<K extends string>(key: K) {
  return (search: Search): { [P in K]?: boolean } =>
    typeof search[key] === 'boolean' ? ({ [key]: search[key] } as { [P in K]?: boolean }) : {}
}

export const redirectSearch = stringParam('redirect')
