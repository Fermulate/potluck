import type { Translation } from '../locales'
import type * as en from '../en/quick-polls'

export const quickPolls = {
  errors: {
    quick_poll_not_found: 'Ese enlace de encuesta no lleva a ningún sitio.',
    quick_poll_expired: 'Esta encuesta terminó.',
    quick_poll_closed: 'Esta encuesta está cerrada, así que los horarios son finales.',
    quick_poll_full: 'Todos los lugares de esta encuesta están ocupados.',
    quick_poll_rate_limited: 'Con calma. Inténtalo de nuevo un poco más tarde.',
    quick_poll_slots_required: 'Pinta al menos una hora primero.',
    invalid_quick_poll: 'Algo de esta encuesta no está bien. Revísala e inténtalo de nuevo.',
    invalid_quick_poll_title: 'Los títulos tienen hasta 80 caracteres.',
    invalid_quick_poll_timezone: 'Elige una zona horaria de la lista.',
    invalid_quick_poll_window: 'Elige de 1 a 14 días, no todos en el pasado.',
    invalid_quick_poll_hours: 'El día tiene que terminar al menos un bloque después de empezar.',
    invalid_quick_poll_slot_minutes: 'Elige bloques de 30 o 60 minutos.',
    invalid_quick_poll_duration: 'Los planes duran de 15 minutos a 24 horas.',
    invalid_quick_poll_ttl: 'Elige cuánto tiempo queda abierta la encuesta.',
    invalid_quick_poll_people: 'Una encuesta admite de 2 a 15 personas.',
    invalid_quick_poll_name: 'Los nombres tienen de 1 a 40 caracteres.',
    invalid_slot: 'Algunas de esas horas están fuera de la encuesta.',
    invalid_slots: 'Esas horas no se guardaron. ¿Lo intentamos otra vez?',
    duplicate_slot: 'Una hora aparece dos veces. ¿Lo intentamos otra vez?',
    not_allowed: 'Solo quien creó la encuesta puede hacer eso.',
  },
} satisfies Translation<typeof en.quickPolls>
