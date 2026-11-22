import type { Translation } from '../locales'
import type * as en from '../en/quick-polls'

export const quickPolls = {
  errors: {
    quick_poll_not_found: 'Ce lien de sondage ne mène nulle part.',
    quick_poll_expired: 'Ce sondage est terminé.',
    quick_poll_closed: 'Ce sondage est fermé, les horaires sont donc définitifs.',
    quick_poll_full: 'Toutes les places de ce sondage sont prises.',
    quick_poll_rate_limited: 'Doucement. Réessaie un peu plus tard.',
    quick_poll_slots_required: "Peins au moins un créneau d'abord.",
    invalid_quick_poll: 'Quelque chose cloche dans ce sondage. Vérifie et réessaie.',
    invalid_quick_poll_title: "Les titres font jusqu'à 80 caractères.",
    invalid_quick_poll_timezone: 'Choisis un fuseau horaire dans la liste.',
    invalid_quick_poll_window: 'Choisis de 1 à 14 jours, pas tous dans le passé.',
    invalid_quick_poll_hours: 'La journée doit finir au moins un créneau après son début.',
    invalid_quick_poll_slot_minutes: 'Choisis des créneaux de 30 ou 60 minutes.',
    invalid_quick_poll_duration: 'Les plans durent de 15 minutes à 24 heures.',
    invalid_quick_poll_ttl: 'Choisis combien de temps le sondage reste ouvert.',
    invalid_quick_poll_people: 'Un sondage accepte de 2 à 15 personnes.',
    invalid_quick_poll_name: 'Les noms font de 1 à 40 caractères.',
    invalid_slot: 'Certains de ces horaires sont hors du sondage.',
    invalid_slots: "Ces horaires n'ont pas été enregistrés. On réessaie ?",
    duplicate_slot: 'Un horaire apparaît deux fois. On réessaie ?',
    not_allowed: 'Seule la personne qui a créé le sondage peut faire ça.',
  },
} satisfies Translation<typeof en.quickPolls>
