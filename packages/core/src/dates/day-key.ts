const formats = new Map<string, Intl.DateTimeFormat>()

/** Calendar day (`YYYY-MM-DD`) of an instant as seen in `timeZone`. */
export function dayKey(value: string | number | Date, timeZone: string): string {
  let format = formats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formats.set(timeZone, format)
  }
  return format.format(new Date(value))
}
