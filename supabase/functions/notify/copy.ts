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
  groupDeleted: string
  groupDeletedBody: string
  groupRestored: string
  groupRestoredBody: string
  memberAddedBody: string
  friendAdded: string
  friendAddedBody: string
  inviteChanged: string
  inviteChangedBody: string
  mfaRemoved: string
  mfaRemovedBody: string
  paymentUpdated: string
  paymentUpdatedBody: string
  paymentDeleted: string
  paymentDeletedBody: string
  paymentRestored: string
  paymentRestoredBody: string
  nudge: string
  nudgeBody: string
  /** Repeating expenses. {what} is the description, {date} the posting day, {deadline} when it posts. */
  recurring: string
  recurringOn: string
  recurringSoon: string
  recurringBy: string
  recurringByBare: string
  recurringPaused: string
  recurringPausedBody: string
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
  friendAdded: 'New friend',
  friendAddedBody: 'Someone accepted your friend link.',
  inviteChanged: 'An invite changed',
  inviteChangedBody: 'Someone you added will get their invite at a new address.',
  mfaRemoved: 'Two-step sign in is off',
  mfaRemovedBody: 'A recovery code was used to sign in. Not you? Change your password.',
  paymentUpdated: 'Payment changed',
  paymentUpdatedBody: 'A payment with you was edited.',
  paymentDeleted: 'Payment deleted',
  paymentDeletedBody: 'A payment with you was deleted.',
  paymentRestored: 'Payment restored',
  paymentRestoredBody: 'A payment with you is back.',
  nudge: 'A friendly nudge',
  nudgeBody: 'Someone is waiting on a payment from you.',
  recurring: 'A repeating expense',
  recurringOn: '{what} goes in on {date}',
  recurringSoon: '{what} goes in soon',
  recurringBy: 'Skip or change it before {deadline}.',
  recurringByBare: 'Skip or change it before it goes in.',
  recurringPaused: '"{what}" is paused',
  recurringPausedBody:
    'Someone in it left the group. Take them out of the split to start it again.',
  other: 'Something new is waiting for you.',
  groupDeleted: 'Group deleted',
  groupDeletedBody: 'Anyone in it can bring it back for 30 days.',
  groupRestored: 'Group restored',
  groupRestoredBody: 'It is back on the table.',
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
  friendAdded: 'Nuevo amigo',
  friendAddedBody: 'Alguien aceptó tu enlace de amistad.',
  inviteChanged: 'Cambió una invitación',
  inviteChangedBody: 'Alguien que añadiste recibirá su invitación en otra dirección.',
  mfaRemoved: 'El inicio de sesión en dos pasos está desactivado',
  mfaRemovedBody:
    'Alguien entró con un código de recuperación. ¿No fuiste tú? Cambia tu contraseña.',
  paymentUpdated: 'Pago modificado',
  paymentUpdatedBody: 'Se editó un pago contigo.',
  paymentDeleted: 'Pago eliminado',
  paymentDeletedBody: 'Se eliminó un pago contigo.',
  paymentRestored: 'Pago restaurado',
  paymentRestoredBody: 'Un pago contigo ha vuelto.',
  nudge: 'Un recordatorio amistoso',
  nudgeBody: 'Alguien está esperando un pago tuyo.',
  recurring: 'Un gasto recurrente',
  recurringOn: '{what} se añade el {date}',
  recurringSoon: '{what} se añade pronto',
  recurringBy: 'Sáltalo o cámbialo antes del {deadline}.',
  recurringByBare: 'Sáltalo o cámbialo antes de que se añada.',
  recurringPaused: '"{what}" está en pausa',
  recurringPausedBody:
    'Alguien que participa dejó el grupo. Quítalo del reparto para que vuelva a funcionar.',
  other: 'Tienes algo nuevo esperándote.',
  groupDeleted: 'Grupo eliminado',
  groupDeletedBody: 'Cualquiera del grupo puede recuperarlo durante 30 días.',
  groupRestored: 'Grupo recuperado',
  groupRestoredBody: 'Vuelve a la mesa.',
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
  friendAdded: 'Nouvel ami',
  friendAddedBody: "Quelqu'un a accepté ton lien d'ami.",
  inviteChanged: 'Une invitation a changé',
  inviteChangedBody: "Quelqu'un que tu as ajouté recevra son invitation à une autre adresse.",
  mfaRemoved: 'La connexion en deux étapes est désactivée',
  mfaRemovedBody:
    "Un code de secours a servi à se connecter. Ce n'était pas toi ? Change ton mot de passe.",
  paymentUpdated: 'Paiement modifié',
  paymentUpdatedBody: 'Un paiement avec toi a été modifié.',
  paymentDeleted: 'Paiement supprimé',
  paymentDeletedBody: 'Un paiement avec toi a été supprimé.',
  paymentRestored: 'Paiement restauré',
  paymentRestoredBody: 'Un paiement avec toi est de retour.',
  nudge: 'Un petit rappel',
  nudgeBody: "Quelqu'un attend un paiement de ta part.",
  recurring: 'Une dépense récurrente',
  recurringOn: '{what} est ajoutée le {date}',
  recurringSoon: '{what} est ajoutée bientôt',
  recurringBy: 'Saute-la ou modifie-la avant le {deadline}.',
  recurringByBare: "Saute-la ou modifie-la avant qu'elle soit ajoutée.",
  recurringPaused: '« {what} » est en pause',
  recurringPausedBody:
    'Quelqu’un a quitté le groupe. Retire cette personne du partage pour la relancer.',
  other: "Quelque chose de nouveau t'attend.",
  groupDeleted: 'Groupe supprimé',
  groupDeletedBody: 'Chacun peut le restaurer pendant 30 jours.',
  groupRestored: 'Groupe restauré',
  groupRestoredBody: 'Il est de retour à table.',
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
  friendAdded: 'Neue Freundschaft',
  friendAddedBody: 'Jemand hat deinen Freundschaftslink angenommen.',
  inviteChanged: 'Eine Einladung wurde geändert',
  inviteChangedBody: 'Jemand, den du hinzugefügt hast, bekommt die Einladung an eine neue Adresse.',
  mfaRemoved: 'Die Anmeldung in zwei Schritten ist aus',
  mfaRemovedBody:
    'Jemand hat sich mit einem Wiederherstellungscode angemeldet. Warst du das nicht? Ändere dein Passwort.',
  paymentUpdated: 'Zahlung geändert',
  paymentUpdatedBody: 'Eine Zahlung mit dir wurde bearbeitet.',
  paymentDeleted: 'Zahlung gelöscht',
  paymentDeletedBody: 'Eine Zahlung mit dir wurde gelöscht.',
  paymentRestored: 'Zahlung wiederhergestellt',
  paymentRestoredBody: 'Eine Zahlung mit dir ist wieder da.',
  nudge: 'Eine freundliche Erinnerung',
  nudgeBody: 'Jemand wartet auf eine Zahlung von dir.',
  recurring: 'Eine wiederkehrende Ausgabe',
  recurringOn: '{what} kommt am {date} dazu',
  recurringSoon: '{what} kommt bald dazu',
  recurringBy: 'Überspring oder ändere sie vor {deadline}.',
  recurringByBare: 'Überspring oder ändere sie, bevor sie dazukommt.',
  recurringPaused: '„{what}“ ist pausiert',
  recurringPausedBody:
    'Jemand ist aus der Gruppe ausgetreten. Nimm die Person aus der Aufteilung, um sie wieder zu starten.',
  other: 'Etwas Neues wartet auf dich.',
  groupDeleted: 'Gruppe gelöscht',
  groupDeletedBody: 'Alle darin können sie 30 Tage lang zurückholen.',
  groupRestored: 'Gruppe zurück',
  groupRestoredBody: 'Sie ist wieder am Tisch.',
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
  friendAdded: 'Novo amigo',
  friendAddedBody: 'Alguém aceitou seu link de amizade.',
  inviteChanged: 'Um convite mudou',
  inviteChangedBody: 'Alguém que você adicionou vai receber o convite em outro endereço.',
  mfaRemoved: 'O login em duas etapas está desligado',
  mfaRemovedBody: 'Alguém entrou com um código de recuperação. Não foi você? Troque sua senha.',
  paymentUpdated: 'Pagamento alterado',
  paymentUpdatedBody: 'Um pagamento com você foi editado.',
  paymentDeleted: 'Pagamento excluído',
  paymentDeletedBody: 'Um pagamento com você foi excluído.',
  paymentRestored: 'Pagamento restaurado',
  paymentRestoredBody: 'Um pagamento com você voltou.',
  nudge: 'Um lembrete amigável',
  nudgeBody: 'Alguém está esperando um pagamento seu.',
  recurring: 'Uma despesa recorrente',
  recurringOn: '{what} entra em {date}',
  recurringSoon: '{what} entra em breve',
  recurringBy: 'Pule ou altere antes de {deadline}.',
  recurringByBare: 'Pule ou altere antes de entrar.',
  recurringPaused: '"{what}" está pausada',
  recurringPausedBody: 'Alguém saiu do grupo. Tire da divisão para voltar a funcionar.',
  other: 'Tem novidade esperando por você.',
  groupDeleted: 'Grupo excluído',
  groupDeletedBody: 'Qualquer pessoa do grupo pode trazê-lo de volta por 30 dias.',
  groupRestored: 'Grupo restaurado',
  groupRestoredBody: 'Voltou para a mesa.',
}

const COPY: Record<string, PushCopy> = { en, es, fr, de, pt }

/** The copy for a profile locale ("es", "pt-BR"), English when we do not speak it. */
export function copyFor(locale: string | null | undefined): PushCopy {
  const base = (locale ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en'
  return COPY[base] ?? en
}
