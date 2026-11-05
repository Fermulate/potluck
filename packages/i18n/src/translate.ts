import { en, type Dictionary } from './en'

type PluralForm = 'zero' | 'one' | 'other'

type Join<Prefix extends string, Key extends string> = Prefix extends '' ? Key : `${Prefix}.${Key}`

/** Every dotted path to a string leaf. */
type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? Join<Prefix, K> : LeafPaths<T[K], Join<Prefix, K>>
}[keyof T & string]

type StripPlural<K> = K extends `${infer Base}_${PluralForm}` ? Base : K

type Lookup<T, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? Lookup<T[Head], Rest>
    : never
  : Path extends keyof T
    ? T[Path]
    : never

/** A translatable key. Plural messages are addressed by their base key (no `_one`/`_other`). */
export type MessageKey = StripPlural<LeafPaths<Dictionary>>

type IsPlural<K extends string> = [Lookup<Dictionary, `${K}_other`>] extends [never] ? false : true

type MessageText<K extends string> =
  Lookup<Dictionary, K> | Lookup<Dictionary, `${K}_${PluralForm}`>

type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never

export type MessageParams<K extends MessageKey> = {
  [P in Placeholders<MessageText<K>>]: string | number
} & (IsPlural<K> extends true ? { count: number } : unknown)

type ParamArgs<K extends MessageKey> = [
  Placeholders<MessageText<K>> | (IsPlural<K> extends true ? 'count' : never),
] extends [never]
  ? []
  : [params: MessageParams<K>]

function flatten(node: object, prefix: string, out: Map<string, string>): Map<string, string> {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else flatten(value as object, path, out)
  }
  return out
}

const messages = flatten(en, '', new Map())
const pluralRules = new Intl.PluralRules('en-US')
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 })

function resolve(key: string, count: unknown): string | undefined {
  if (typeof count === 'number') {
    const exact = count === 0 ? messages.get(`${key}_zero`) : undefined
    const plural =
      exact ?? messages.get(`${key}_${pluralRules.select(count)}`) ?? messages.get(`${key}_other`)
    if (plural !== undefined) return plural
  }
  return messages.get(key)
}

/**
 * Translate `key`, filling `{placeholders}` from `params`. Numbers are formatted with digit
 * grouping and keep every fraction digit. Unknown keys return the key itself; missing params
 * leave the placeholder in place.
 */
export function t<K extends MessageKey>(key: K, ...[params]: ParamArgs<K>): string {
  const values = (params ?? {}) as Record<string, string | number | undefined>
  const template = resolve(key, values.count) ?? key
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]
    if (value === undefined) return match
    return typeof value === 'number' ? numberFormat.format(value) : value
  })
}

/** Whether `key` exists, for keys built at runtime (e.g. activity verbs from the database). */
export function hasMessage(key: string): key is MessageKey {
  if (/_(zero|one|other)$/.test(key)) return false
  return messages.has(key) || messages.has(`${key}_other`)
}
