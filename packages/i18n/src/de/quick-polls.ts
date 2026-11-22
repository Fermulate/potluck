import type { Translation } from '../locales'
import type * as en from '../en/quick-polls'

export const quickPolls = {
  errors: {
    quick_poll_not_found: 'Dieser Umfragelink führt nirgendwohin.',
    quick_poll_expired: 'Diese Umfrage ist vorbei.',
    quick_poll_closed: 'Diese Umfrage ist geschlossen, die Zeiten stehen fest.',
    quick_poll_full: 'Alle Plätze in dieser Umfrage sind vergeben.',
    quick_poll_rate_limited: 'Langsam. Versuch es etwas später noch mal.',
    quick_poll_slots_required: 'Male zuerst mindestens eine Zeit.',
    invalid_quick_poll: 'Etwas an dieser Umfrage stimmt nicht. Prüf sie und versuch es noch mal.',
    invalid_quick_poll_title: 'Titel haben bis zu 80 Zeichen.',
    invalid_quick_poll_timezone: 'Wähle eine Zeitzone aus der Liste.',
    invalid_quick_poll_window: 'Wähle 1 bis 14 Tage, nicht alle in der Vergangenheit.',
    invalid_quick_poll_hours: 'Der Tag muss mindestens einen Block nach seinem Beginn enden.',
    invalid_quick_poll_slot_minutes: 'Wähle Blöcke von 30 oder 60 Minuten.',
    invalid_quick_poll_duration: 'Pläne dauern 15 Minuten bis 24 Stunden.',
    invalid_quick_poll_ttl: 'Wähle, wie lange die Umfrage offen bleibt.',
    invalid_quick_poll_people: 'Eine Umfrage nimmt 2 bis 15 Personen.',
    invalid_quick_poll_name: 'Namen haben 1 bis 40 Zeichen.',
    invalid_slot: 'Einige dieser Zeiten liegen außerhalb der Umfrage.',
    invalid_slots: 'Diese Zeiten wurden nicht gespeichert. Noch mal versuchen?',
    duplicate_slot: 'Eine Zeit kommt doppelt vor. Noch mal versuchen?',
    not_allowed: 'Das kann nur, wer die Umfrage erstellt hat.',
  },
} satisfies Translation<typeof en.quickPolls>
