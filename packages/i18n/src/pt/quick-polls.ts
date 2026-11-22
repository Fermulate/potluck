import type { Translation } from '../locales'
import type * as en from '../en/quick-polls'

export const quickPolls = {
  errors: {
    quick_poll_not_found: 'Esse link de enquete não leva a lugar nenhum.',
    quick_poll_expired: 'Esta enquete terminou.',
    quick_poll_closed: 'Esta enquete está fechada, então os horários são finais.',
    quick_poll_full: 'Todas as vagas desta enquete estão ocupadas.',
    quick_poll_rate_limited: 'Calma. Tente de novo um pouco mais tarde.',
    quick_poll_slots_required: 'Pinte pelo menos um horário primeiro.',
    invalid_quick_poll: 'Algo nesta enquete não está certo. Confira e tente de novo.',
    invalid_quick_poll_title: 'Títulos têm até 80 caracteres.',
    invalid_quick_poll_timezone: 'Escolha um fuso horário da lista.',
    invalid_quick_poll_window: 'Escolha de 1 a 14 dias, não todos no passado.',
    invalid_quick_poll_hours: 'O dia precisa terminar pelo menos um bloco depois de começar.',
    invalid_quick_poll_slot_minutes: 'Escolha blocos de 30 ou 60 minutos.',
    invalid_quick_poll_duration: 'Planos duram de 15 minutos a 24 horas.',
    invalid_quick_poll_ttl: 'Escolha por quanto tempo a enquete fica aberta.',
    invalid_quick_poll_people: 'Uma enquete aceita de 2 a 15 pessoas.',
    invalid_quick_poll_name: 'Nomes têm de 1 a 40 caracteres.',
    invalid_slot: 'Alguns desses horários estão fora da enquete.',
    invalid_slots: 'Esses horários não foram salvos. Tentamos de novo?',
    duplicate_slot: 'Um horário aparece duas vezes. Tentamos de novo?',
    not_allowed: 'Só quem criou a enquete pode fazer isso.',
  },
} satisfies Translation<typeof en.quickPolls>
