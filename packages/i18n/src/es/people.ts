import type { people as en } from '../en/people'

/** Same nesting as English, every string optional (as `Translation` in the languages setup). */
type Translation<T> = {
  readonly [K in keyof T]?: T[K] extends string ? string : Translation<T[K]>
}

/**
 * Spanish for people not on Potluck yet, friend links, the friend page, blocking and reporting.
 * Joins `es.ts` (one import and one entry, like the other feature files) where the language
 * switcher lives. The lines this feature adds to other namespaces are below, for
 * `es/shell.ts` (`errors.codes`), `es/money.ts` (`activity.member`), `es/me.ts`
 * (`notifications.types.friend`) and `es/help.ts` (`help.topics`).
 */
export const people = {
  placeholder: {
    badge: 'Aún no está en Potluck',
    add: 'Añadir a alguien',
    addTitle: 'Añadir a alguien por su nombre',
    addBody:
      'Divide gastos con esa persona desde ya. Cuando se una con este correo o con su enlace, todo lo de aquí pasa a ser suyo.',
    nameLabel: 'Nombre',
    namePlaceholder: 'Sam',
    emailLabel: 'Correo (opcional)',
    emailPlaceholder: 'sam@ejemplo.com',
    emailHint: 'Enviamos una invitación, y un recordatorio si lo pides. Nada más.',
    submit: 'Añadir a {group}',
    added: '{name} ya está. A dividir.',
    addedInvited: '{name} ya está. Su invitación va en camino.',
    waitingFor: 'La invitación va a {email}',
    noEmail: 'Aún sin correo. Comparte su enlace.',
    invitedOn: 'Invitación enviada el {date}',
    remindedOn: 'Recordatorio enviado el {date}',
    menuHint: 'Lugar guardado. Lo ocupa cuando se una.',
    remind: 'Enviar un recordatorio',
    remindHint: 'Cada invitación tiene un solo recordatorio.',
    reminded: 'Recordatorio enviado.',
    shareLink: 'Compartir su enlace',
    shareTitle: 'Tu lugar en {group}',
    shareText: '{name}, tu lugar en {group} en Potluck está guardado. Ocúpalo aquí: {url}',
    linkCopied: 'Enlace copiado. Envíaselo a {name}.',
    edit: 'Editar nombre o correo',
    editTitle: 'Editar a {name}',
    editBody: 'Un correo nuevo recibe una invitación nueva y el enlace anterior deja de funcionar.',
    save: 'Guardar',
    saved: 'Guardado.',
    savedInvited: 'Guardado. Va en camino una invitación nueva.',
    remove: 'Quitar a {name}',
    removeConfirm: '{name} aún no se ha unido. ¿Quitarle de {group}?',
    removed: '{name} ya no está en el grupo.',
  },
  claim: {
    title: 'Tienes un lugar guardado',
    seatFor: '{host} guardó un lugar para {name}.',
    emailNote: 'Usa {email} para ocuparlo.',
    accept: 'Ocupar mi lugar',
    signUp: 'Crea una cuenta para ocuparlo',
    signIn: 'Inicia sesión para ocuparlo',
    welcome: 'Bienvenido. Todo lo que se dividió para {name} ahora es tuyo.',
  },
  friendLink: {
    title: 'Tu enlace de amistad',
    body: 'Quien lo abra puede añadirte como amigo. Sin grupo de por medio.',
    copy: 'Copiar enlace',
    copied: 'Enlace copiado. Envíaselo a alguien.',
    share: 'Compartir',
    shareTitle: 'Añádeme en Potluck',
    shareText: 'Añádeme en Potluck para dividir gastos: {url}',
    rotate: 'Crear un enlace nuevo',
    rotated: 'El enlace anterior se cerró. Aquí tienes uno nuevo.',
    loading: 'Preparando tu enlace',
  },
  friendEmail: {
    label: 'Invitar por correo',
    placeholder: 'amigo@ejemplo.com',
    send: 'Invitar',
    hint: 'Solo ese correo puede usar el enlace, una vez.',
    subject: '{name} quiere dividir gastos contigo en Potluck',
    body: '¡Hola! Añádeme en Potluck para dividir gastos. Este enlace es solo para ti: {url}',
    ready: 'Invitación lista. Está en tu app de correo.',
  },
  addFriend: {
    orGroup: 'O invítale a uno de tus grupos',
    suggestions: 'Gente de tus grupos',
    add: 'Añadir',
    addName: 'Añadir a {name} como amigo',
    added: '{name} vuelve a ser tu amigo.',
  },
  friendJoin: {
    title: '{name} quiere dividir gastos contigo',
    body: 'Haceos amigos en Potluck para dividir gastos entre dos, sin grupo.',
    accept: 'Añadir a {name} como amigo',
    signUp: 'Crea una cuenta para aceptar',
    signIn: 'Inicia sesión para aceptar',
    already: '{name} y tú ya sois amigos.',
    self: 'Es tu propio enlace. Envíaselo a alguien.',
    open: 'Ver amigos',
    welcome: '{name} y tú ya sois amigos.',
    invalidTitle: 'Este enlace de amistad se enfrió',
  },
  friendPage: {
    back: 'Amigos',
    notFound: 'No encontramos a este amigo.',
    allSettled: 'Todo saldado',
    owesYou: '{name} te debe {amount}',
    youOwe: 'Le debes {amount} a {name}',
    oneOnOne: 'Entre los dos',
    inGroup: 'En {group}',
    sharedGroups: 'Cómo estáis',
    history: 'Todo lo que compartís',
    historyEmpty: 'Aún no compartís nada. Añade un gasto para empezar.',
    addExpense: 'Añadir gasto',
    settleUp: 'Saldar',
    payment: '{from} le pagó {amount} a {to}',
    you: 'Tú',
    menu: 'Más opciones para {name}',
    remove: 'Quitar de amigos',
    removeHint: 'Los grupos compartidos siguen igual.',
    removeConfirm: '¿Quitar a {name} de tus amigos? Los grupos compartidos siguen igual.',
    removed: '{name} ya no está en tu lista de amigos.',
    block: 'Bloquear a {name}',
    blockHint: 'No se le avisa.',
    blockConfirm:
      'A {name} no se le avisa. Dejáis de ser amigos y no podrá unirse a tus grupos. Los grupos que ya compartís siguen igual.',
    blocked: '{name} está bloqueado.',
    report: 'Denunciar a {name}',
    reportHint: 'Cuéntanos si algo va mal.',
  },
  report: {
    title: 'Denunciar a {name}',
    body: 'Cuéntanos qué pasó. El equipo de Potluck lee cada denuncia; a {name} no se le avisa.',
    label: 'Qué pasó',
    placeholder: 'Con unas palabras basta',
    send: 'Enviar denuncia',
    sent: 'Gracias. Lo revisaremos.',
  },
  blocked: {
    hint: 'No se les avisa cuando bloqueas o desbloqueas.',
    unblockName: 'Desbloquear a {name}',
    unblocked: '{name} ya no está bloqueado.',
  },
} as const satisfies Translation<typeof en>

/** For `es/shell.ts`, `errors.codes`. */
export const errorCodes = {
  profile_without_account: 'Ese perfil necesita una cuenta.',
  placeholder_member: 'Quien aún no está en Potluck solo puede ser miembro normal de su grupo.',
  placeholder_not_found: 'Este lugar ya no está guardado. Pide una invitación nueva.',
  placeholder_claim_conflict: 'Ya estás en este grupo con tu propio nombre.',
  placeholder_exists: 'Alguien con ese correo ya está esperando para unirse.',
  placeholder_no_email: 'Primero añade su correo.',
  placeholder_already_reminded: 'Ya recibió su recordatorio.',
  invalid_name: 'Ponle un nombre.',
  invalid_email: 'Ese correo no parece correcto.',
  too_many_invites: 'Son muchas invitaciones para un día. Inténtalo mañana.',
  email_not_verified: 'Primero confirma tu correo. Revisa tu bandeja de entrada.',
  friend_has_balance: 'Primero salda vuestro saldo entre los dos.',
  person_not_found: 'No encontramos a esa persona.',
} as const

/** For `es/money.ts`, `activity.member`. */
export const activityMember = {
  added: '{actor} añadió a {name}',
  claimed: '{actor} se unió y ocupó su lugar guardado',
} as const

/** For `es/me.ts`, `notifications.types.friend`. */
export const friendNotification = {
  added: { title: 'Nuevo amigo', body: '{actor} aceptó tu enlace de amistad.' },
} as const

/** For `es/help.ts`, `help.topics`. */
export const helpTopics = {
  placeholders: 'Sobre quien aún no está en Potluck',
  friends: 'Cómo funcionan los amigos',
} as const
