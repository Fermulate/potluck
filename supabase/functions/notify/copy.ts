// Push copy per language, keyed by the recipient's `profiles.locale`. The app's strings live in
// packages/i18n; edge functions only ship what is under supabase/functions, so these few lines
// are kept here. Anything missing falls back to English.

export interface PushCopy {
  expenseNew: string
  expenseNewBody: string
  expenseUpdated: string
  expenseUpdatedBody: string
  payment: string
  paymentBody: string
  comment: string
  commentBody: string
  member: string
  memberBody: string
  availability: string
  availabilityBody: string
  planNew: string
  planNewBody: string
  planOn: string
  planOnBody: string
  planCancelled: string
  planCancelledBody: string
  reminder: string
  reminderBody: string
  rsvp: string
  rsvpBody: string
  expenseDeleted: string
  expenseDeletedBody: string
  expenseRestored: string
  expenseRestoredBody: string
  memberAdded: string
  memberAddedBody: string
  mfaRemoved: string
  mfaRemovedBody: string
  other: string
}

const en: PushCopy = {
  expenseNew: 'New expense',
  expenseNewBody: 'Someone added an expense',
  expenseUpdated: 'Expense updated',
  expenseUpdatedBody: 'An expense changed',
  payment: 'Payment recorded',
  paymentBody: 'Someone settled up with you.',
  comment: 'New comment',
  commentBody: 'Someone replied',
  member: 'New member',
  memberBody: 'Someone joined your group.',
  availability: 'When are you free?',
  availabilityBody: 'Paint your availability',
  planNew: 'New plan',
  planNewBody: 'A new plan is brewing',
  planOn: 'It is on',
  planOnBody: 'A plan was locked in',
  planCancelled: 'Plan cancelled',
  planCancelledBody: 'A plan was called off',
  reminder: 'Coming up soon',
  reminderBody: 'A plan is coming up',
  rsvp: 'Are you in?',
  rsvpBody: 'Let the group know if you are coming',
  expenseDeleted: 'Expense deleted',
  expenseDeletedBody: 'An expense was deleted',
  expenseRestored: 'Expense restored',
  expenseRestoredBody: 'An expense is back',
  memberAdded: 'You were added to a group',
  memberAddedBody: 'Pull up a chair.',
  mfaRemoved: 'Two-step sign in is off',
  mfaRemovedBody: 'A recovery code was used to sign in. Not you? Change your password.',
  other: 'Something new is waiting for you.',
}

const es: PushCopy = {
  expenseNew: 'Nuevo gasto',
  expenseNewBody: 'Alguien añadió un gasto',
  expenseUpdated: 'Gasto actualizado',
  expenseUpdatedBody: 'Un gasto cambió',
  payment: 'Pago registrado',
  paymentBody: 'Alguien saldó cuentas contigo.',
  comment: 'Nuevo comentario',
  commentBody: 'Alguien respondió',
  member: 'Nuevo miembro',
  memberBody: 'Alguien se unió a tu grupo.',
  availability: '¿Cuándo estás libre?',
  availabilityBody: 'Marca tu disponibilidad',
  planNew: 'Nuevo plan',
  planNewBody: 'Se está cocinando un plan',
  planOn: 'Hay plan',
  planOnBody: 'Se fijó un plan',
  planCancelled: 'Plan cancelado',
  planCancelledBody: 'Se canceló un plan',
  reminder: 'Muy pronto',
  reminderBody: 'Se acerca un plan',
  rsvp: '¿Te apuntas?',
  rsvpBody: 'Dile al grupo si vienes',
  expenseDeleted: 'Gasto eliminado',
  expenseDeletedBody: 'Se eliminó un gasto',
  expenseRestored: 'Gasto recuperado',
  expenseRestoredBody: 'Un gasto ha vuelto',
  memberAdded: 'Te añadieron a un grupo',
  memberAddedBody: 'Acerca una silla.',
  mfaRemoved: 'El inicio de sesión en dos pasos está desactivado',
  mfaRemovedBody:
    'Alguien entró con un código de recuperación. ¿No fuiste tú? Cambia tu contraseña.',
  other: 'Tienes algo nuevo esperándote.',
}

const fr: PushCopy = {
  expenseNew: 'Nouvelle dépense',
  expenseNewBody: "Quelqu'un a ajouté une dépense",
  expenseUpdated: 'Dépense modifiée',
  expenseUpdatedBody: 'Une dépense a changé',
  payment: 'Paiement enregistré',
  paymentBody: "Quelqu'un a réglé avec toi.",
  comment: 'Nouveau commentaire',
  commentBody: "Quelqu'un a répondu",
  member: 'Nouveau membre',
  memberBody: "Quelqu'un a rejoint ton groupe.",
  availability: 'Tu es libre quand ?',
  availabilityBody: 'Indique tes disponibilités',
  planNew: 'Nouveau plan',
  planNewBody: 'Un plan se prépare',
  planOn: "C'est calé",
  planOnBody: 'Un plan est fixé',
  planCancelled: 'Plan annulé',
  planCancelledBody: 'Un plan a été annulé',
  reminder: 'Bientôt',
  reminderBody: 'Un plan approche',
  rsvp: 'Tu viens ?',
  rsvpBody: 'Dis au groupe si tu viens',
  expenseDeleted: 'Dépense supprimée',
  expenseDeletedBody: 'Une dépense a été supprimée',
  expenseRestored: 'Dépense rétablie',
  expenseRestoredBody: 'Une dépense est de retour',
  memberAdded: "On t'a ajouté à un groupe",
  memberAddedBody: 'Installe-toi.',
  mfaRemoved: 'La connexion en deux étapes est désactivée',
  mfaRemovedBody:
    "Un code de secours a servi à se connecter. Ce n'était pas toi ? Change ton mot de passe.",
  other: "Quelque chose de nouveau t'attend.",
}

const de: PushCopy = {
  expenseNew: 'Neue Ausgabe',
  expenseNewBody: 'Jemand hat eine Ausgabe hinzugefügt',
  expenseUpdated: 'Ausgabe geändert',
  expenseUpdatedBody: 'Eine Ausgabe hat sich geändert',
  payment: 'Zahlung erfasst',
  paymentBody: 'Jemand hat mit dir abgerechnet.',
  comment: 'Neuer Kommentar',
  commentBody: 'Jemand hat geantwortet',
  member: 'Neues Mitglied',
  memberBody: 'Jemand ist deiner Gruppe beigetreten.',
  availability: 'Wann hast du Zeit?',
  availabilityBody: 'Trag ein, wann du kannst',
  planNew: 'Neuer Plan',
  planNewBody: 'Da braut sich ein Plan zusammen',
  planOn: 'Es steht',
  planOnBody: 'Ein Plan ist fix',
  planCancelled: 'Plan abgesagt',
  planCancelledBody: 'Ein Plan wurde abgesagt',
  reminder: 'Gleich geht es los',
  reminderBody: 'Ein Plan steht bald an',
  rsvp: 'Bist du dabei?',
  rsvpBody: 'Sag der Gruppe, ob du kommst',
  expenseDeleted: 'Ausgabe gelöscht',
  expenseDeletedBody: 'Eine Ausgabe wurde gelöscht',
  expenseRestored: 'Ausgabe wiederhergestellt',
  expenseRestoredBody: 'Eine Ausgabe ist zurück',
  memberAdded: 'Du wurdest zu einer Gruppe hinzugefügt',
  memberAddedBody: 'Setz dich dazu.',
  mfaRemoved: 'Die Anmeldung in zwei Schritten ist aus',
  mfaRemovedBody:
    'Jemand hat sich mit einem Wiederherstellungscode angemeldet. Warst du das nicht? Ändere dein Passwort.',
  other: 'Etwas Neues wartet auf dich.',
}

const pt: PushCopy = {
  expenseNew: 'Nova despesa',
  expenseNewBody: 'Alguém adicionou uma despesa',
  expenseUpdated: 'Despesa atualizada',
  expenseUpdatedBody: 'Uma despesa mudou',
  payment: 'Pagamento registrado',
  paymentBody: 'Alguém acertou as contas com você.',
  comment: 'Novo comentário',
  commentBody: 'Alguém respondeu',
  member: 'Novo membro',
  memberBody: 'Alguém entrou no seu grupo.',
  availability: 'Quando você está livre?',
  availabilityBody: 'Marque sua disponibilidade',
  planNew: 'Novo plano',
  planNewBody: 'Tem um plano no forno',
  planOn: 'Está marcado',
  planOnBody: 'Um plano foi confirmado',
  planCancelled: 'Plano cancelado',
  planCancelledBody: 'Um plano foi cancelado',
  reminder: 'Daqui a pouco',
  reminderBody: 'Um plano está chegando',
  rsvp: 'Você vem?',
  rsvpBody: 'Avise o grupo se você vem',
  expenseDeleted: 'Despesa excluída',
  expenseDeletedBody: 'Uma despesa foi excluída',
  expenseRestored: 'Despesa restaurada',
  expenseRestoredBody: 'Uma despesa voltou',
  memberAdded: 'Você foi adicionado a um grupo',
  memberAddedBody: 'Puxe uma cadeira.',
  mfaRemoved: 'O login em duas etapas está desligado',
  mfaRemovedBody: 'Alguém entrou com um código de recuperação. Não foi você? Troque sua senha.',
  other: 'Tem novidade esperando por você.',
}

const COPY: Record<string, PushCopy> = { en, es, fr, de, pt }

/** The copy for a profile locale ("es", "pt-BR"), English when we do not speak it. */
export function copyFor(locale: string | null | undefined): PushCopy {
  const base = (locale ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en'
  return COPY[base] ?? en
}
