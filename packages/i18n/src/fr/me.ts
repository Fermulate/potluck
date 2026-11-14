import type { Translation } from '../locales'
import type * as en from '../en/me'

export const notifications = {
  title: 'Notifications',
  markAllRead: 'Tout marquer comme lu',
  allCaughtUp: 'Tu es à jour.',
  unread_one: '{count} non lue',
  unread_other: '{count} non lues',
  enablePush: 'Activer les notifications push',
  pushBlocked: 'Les notifications sont bloquées dans les réglages de ton navigateur.',
  someone: "Quelqu'un",
  aGroup: 'ton groupe',
  directTab: 'ton compte avec {name}',
  anEvent: 'une sortie',
  anExpense: 'une dépense',
  generic: { title: "Il s'est passé quelque chose", body: 'Touche pour jeter un œil.' },
  unreadLabel: 'Non lues',
  earlier: 'Plus tôt',
  new: 'Nouveau',
  types: {
    account: {
      mfaRemoved: {
        title: 'La connexion en deux étapes est désactivée',
        body: "Un code de secours a servi à se connecter. Si ce n'était pas toi, change ton mot de passe tout de suite.",
      },
    },
    summary: {
      monthly: { title: 'Ton mois sur Potluck', settled: 'Tout est réglé. Bien joué.' },
      owed: '{group} : on te doit {amount}',
      owe: '{group} : tu dois {amount}',
      more_one: 'et {count} autre groupe',
      more_other: 'et {count} autres groupes',
    },
    expense: {
      created: {
        title: 'Nouvelle dépense dans {group}',
        body: '{actor} a ajouté {description} : {amount}',
      },
      updated: {
        title: 'Dépense modifiée',
        body: '{actor} a modifié {description} dans {group}',
      },
      deleted: {
        title: 'Dépense supprimée',
        body: '{actor} a supprimé {description} dans {group}',
      },
      restored: {
        title: 'Dépense restaurée',
        body: '{actor} a restauré {description} dans {group}',
      },
    },
    settlement: {
      created: { title: 'Tu as été payé', body: "{payer} t'a payé {amount}" },
      sent: {
        title: 'Paiement enregistré',
        body: '{payee} a marqué ton paiement de {amount} comme reçu',
      },
      recorded: {
        title: 'Paiement enregistré',
        body: '{actor} a enregistré ton paiement de {amount} à {payee}',
      },
      updated: {
        title: 'Paiement modifié',
        body: '{actor} a modifié un paiement de {amount} dans {group}',
      },
      deleted: {
        title: 'Paiement supprimé',
        body: '{actor} a supprimé un paiement de {amount} dans {group}',
      },
      restored: {
        title: 'Paiement restauré',
        body: '{actor} a restauré un paiement de {amount} dans {group}',
      },
    },
    group: {
      deleted: {
        title: '{group} a été supprimé',
        body: "{actor} l'a supprimé. Chacun peut le restaurer pendant 30 jours.",
      },
      restored: { title: '{group} est de retour', body: "{actor} l'a restauré." },
    },
    member: {
      joined: {
        title: 'Nouvelle tête dans {group}',
        body: "{actor} vient d'arriver. Dis bonjour.",
      },
      added: { title: 'Bienvenue dans {group}', body: "{actor} t'a ajouté. Installe-toi." },
      invite_changed: {
        title: 'Une invitation a changé dans {group}',
        body: "{actor} a envoyé l'invitation de {name} à une autre adresse",
      },
    },
    friend: {
      added: { title: 'Nouvel ami', body: "{actor} a accepté ton lien d'ami." },
    },
    event: {
      created: { title: 'Il se prépare quelque chose', body: '{actor} organise {event}' },
      scheduled: { title: "C'est calé", body: '{event} aura lieu le {date}' },
      cancelled: { title: 'Changement de programme', body: '{event} a été annulée' },
      reminder: { title: 'Bientôt', body: '{event} commence {when}' },
    },
    availability: {
      requested: {
        title: 'Tu es libre quand ?',
        body: '{actor} a besoin de tes dispos pour {event}',
      },
    },
    rsvp: {
      reminder: {
        title: 'Tu en es ?',
        body: 'Dis à {group} si tu viens à {event}',
      },
    },
    comment: {
      created: { title: 'Nouveau commentaire', body: '{actor} : {preview}' },
    },
    debt: {
      reminder: {
        title: 'Un petit rappel',
        body: '{actor} dit que tu dois {amount} dans {group}',
        bodyWithNote: '{actor} dit que tu dois {amount} dans {group} : "{note}"',
      },
    },
    recurring: {
      upcoming: {
        title: '{description} est ajoutée le {date}',
        share: 'Ta part sera de {share} sur {amount} dans {group}.',
        payer: 'Tu couvres les {amount} dans {group}.',
        plain: '{amount} dans {group}.',
        deadline: 'Saute-la ou modifie-la avant le {deadline}.',
      },
      paused: {
        title: '« {description} » est en pause',
        body: '{name} a quitté {group}. Retire cette personne du partage pour la relancer.',
      },
    },
  },
} satisfies Translation<typeof en.notifications>

export const settings = {
  title: 'Moi',
  subtitle: 'Ton profil, tes préférences, ta sortie.',
  profile: {
    title: 'Profil',
    nameRequired: 'Ton nom ne peut pas être vide.',
    name: 'Nom affiché',
    photo: 'Photo',
    changePhoto: 'Changer la photo',
    removePhoto: 'Retirer la photo',
    email: 'E-mail',
    saved: 'Profil enregistré.',
  },
  preferences: {
    title: 'Préférences',
    timezone: 'Fuseau horaire',
    timezoneHint: "Les horaires s'affichent dans ce fuseau.",
    detectTimezone: 'Utiliser mon fuseau actuel',
    currency: 'Devise par défaut',
    currencyHint: 'Utilisée pour les nouveaux groupes.',
    language: 'Langue',
    theme: 'Apparence',
    themeSystem: 'Système',
    themeLight: 'Clair',
    themeDark: 'Sombre',
    saved: 'Préférences enregistrées.',
  },
  notifications: {
    title: 'Notifications',
    inbox: 'Ouvrir la boîte de réception',
    push: 'Notifications push',
    pushHint: "Un petit signal sur cet appareil quand quelque chose t'attend.",
    pushOn: 'Le push est activé sur cet appareil.',
    pushUnsupported:
      "Ce navigateur ne gère pas les notifications push. Sur iPhone, ajoute d'abord Potluck à ton écran d'accueil.",
    pushNotConfigured: "Le push n'est pas encore configuré sur ce serveur.",
    pushFailed: "Impossible d'activer le push. On réessaie ?",
    inApp: 'Tu verras toujours les nouveautés dans ta boîte de réception.',
    email: 'Notifications par e-mail',
    expenses: 'Nouvelles dépenses',
    payments: 'Paiements',
    plans: 'Sorties et demandes de dispos',
    reminders: 'Rappels de sorties',
  },
  calendar: {
    title: 'Calendrier',
    feed: 'Flux de calendrier',
    feedHint: "Abonne-toi à tes sorties Potluck depuis n'importe quelle appli de calendrier.",
    copyFeed: 'Copier le lien du flux',
    subscribe: "S'abonner",
    resetFeed: 'Réinitialiser le lien',
    resetFeedHint: "L'ancien lien ne marchera plus.",
    connect: 'Connecter un calendrier',
    connectHint: 'On regarde seulement quand tu es occupé, jamais ce que tu fais.',
    connected: 'Connecté',
    disconnect: 'Déconnecter',
    comingSoon: 'Bientôt',
  },
  privacy: {
    title: 'Confidentialité',
    blocked: 'Personnes bloquées',
    noneBlocked: 'Personne de bloqué. Parfait.',
    unblock: 'Débloquer',
  },
  about: {
    title: 'À propos',
    version: 'Version {version}',
    source: 'Code source',
    license: 'Logiciel libre sous licence AGPL-3.0',
    feedback: 'Envoyer un avis',
  },
  notificationPrefs: {
    title: 'Ce que tu veux suivre',
    hint: 'Ta boîte de réception reçoit tout. Choisis ce qui arrive aussi sur tes appareils ou par e-mail.',
    push: 'Push',
    email: 'E-mail',
    channel: '{category} : {channel}',
    emailSoon:
      'Les notifications par e-mail arrivent bientôt. En attendant, tout est dans ta boîte de réception.',
    failed: "Ce réglage n'a pas été enregistré. On réessaie ?",
    offline: 'Tu es hors ligne. Ta modification sera enregistrée à ton retour.',
    summaryEmail: 'Par e-mail',
    pushOffHere:
      "Le push est désactivé sur cet appareil, donc ces notifications n'arrivent que sur tes autres appareils.",
    turnOnPush: 'Activer le push ici',
    categories: {
      expense_added: {
        label: 'Nouvelles dépenses',
        hint: "Quelqu'un ajoute une dépense qui te concerne.",
        about: 'les nouvelles dépenses',
      },
      expense_changed: {
        label: 'Modifications et suppressions',
        hint: 'Une dépense qui te concerne est modifiée, supprimée ou restaurée.',
        about: 'les modifications et suppressions de dépenses',
      },
      payments: {
        label: 'Paiements',
        hint: "Quelqu'un te paie ou enregistre un paiement avec toi.",
        about: 'les paiements',
      },
      comments: {
        label: 'Commentaires',
        hint: 'Nouveaux commentaires sur les dépenses et sorties dont tu fais partie.',
        about: 'les commentaires',
      },
      groups: {
        label: 'Groupes',
        hint: "Quelqu'un rejoint un groupe que tu gères.",
        about: 'les nouvelles des groupes',
      },
      plans: {
        label: 'Sorties',
        hint: 'Nouvelles sorties, horaires calés, annulations et demandes de dispos.',
        about: 'les sorties',
      },
      reminders: {
        label: 'Rappels',
        hint: 'Sorties à venir et réponses que tu dois encore donner.',
        about: 'les rappels',
      },
      monthly_summary: {
        label: 'Résumé mensuel',
        hint: 'Tes soldes le premier de chaque mois, sous forme de carte dans ta boîte de réception.',
        hintEmail:
          'Tes soldes le premier de chaque mois, dans ta boîte de réception et par e-mail.',
        about: 'le résumé mensuel',
      },
    },
  },
  paymentMethods: {
    title: 'Moyens de paiement',
    hint: "Les gens de tes groupes les voient quand ils règlent avec toi, pour te payer en un geste. Potluck ne déplace jamais d'argent.",
    empty: 'Rien pour le moment.',
    add: 'Ajouter un moyen de paiement',
    edit: 'Modifier {app}',
    remove: 'Retirer {app}',
    removed: '{app} retiré.',
    saved: '{app} enregistré.',
    pickApp: 'Quelle appli ?',
    save: 'Enregistrer',
    invalid: 'Ça ne ressemble pas à un identifiant {app}.',
    handle: {
      paypal: "Nom d'utilisateur PayPal.me",
      venmo: "Nom d'utilisateur Venmo",
      cashapp: 'Cashtag',
      revolut: "Nom d'utilisateur Revolut",
      monzo: "Nom d'utilisateur Monzo.me",
      upi: 'Identifiant UPI',
      interac: 'Courriel ou téléphone pour les virements Interac',
      bank: 'Coordonnées bancaires',
    },
    placeholder: {
      paypal: 'tonnom',
      venmo: 'ton-nom',
      cashapp: 'tonnom',
      revolut: 'tonnom',
      monzo: 'tonnom',
      upi: 'nom@banque',
      interac: 'toi@exemple.com',
      bank: 'IBAN, ou code guichet et numéro de compte',
    },
    pasteHint: 'Tu peux aussi coller le lien de ton profil.',
  },
} satisfies Translation<typeof en.settings>

export const account = {
  delete: {
    title: 'Supprimer le compte',
    warning:
      'Cela supprime ton profil, ta photo et ton e-mail. Les dépenses auxquelles tu as participé restent, pour que les totaux des groupes tombent juste, mais elles afficheront « Ancien membre » à la place de ton nom.',
    blocked: "Tu as encore des soldes ouverts dans {groups}. Règle d'abord.",
    ownerBlocked: "Tu es propriétaire de {groups}. Confie-les d'abord à quelqu'un d'autre.",
    confirmPhrase: 'Tape SUPPRIMER pour confirmer',
    confirmWord: 'SUPPRIMER',
    submit: 'Supprimer mon compte',
    deleting: 'On débarrasse ta place à table...',
    done: 'Ton compte a disparu. Merci pour tous ces dîners.',
    formerMember: 'Ancien membre',
  },
  export: {
    title: 'Télécharger mes données',
    hint: 'Une copie de tes dépenses, paiements et sorties.',
    ready: 'Ton export est prêt.',
  },
} satisfies Translation<typeof en.account>

export const unsubscribe = {
  title: 'Réglages e-mail',
  working: 'On vérifie ton lien...',
  askTitle: 'Arrêter ces e-mails ?',
  askOne:
    "Tu ne recevras plus d'e-mails concernant {what}. Ta boîte de réception Potluck n'est pas touchée.",
  askAll:
    "Tu ne recevras plus aucun e-mail de Potluck. Ta boîte de réception Potluck n'est pas touchée.",
  account: 'Pour {email}',
  confirm: 'Se désabonner',
  alreadyTitle: "Tu n'es déjà plus sur la liste",
  resubscribe: 'Les recevoir à nouveau',
  done: "Tu n'es plus sur la liste",
  doneOne: "Plus d'e-mails concernant {what}. Ta boîte de réception Potluck n'est pas touchée.",
  doneAll: "Plus aucun e-mail de Potluck. Ta boîte de réception Potluck n'est pas touchée.",
  nothingToUndo:
    'Rien à rétablir avec ce lien : tes réglages e-mail sont comme tu les as laissés. Change-les sur la page Moi.',
  offline: 'Tu es hors ligne. Ça passera dès ton retour.',
  undo: 'Continuer à les recevoir',
  undone: 'Te revoilà sur la liste',
  undoneBody:
    "Ces e-mails vont continuer d'arriver. Tu peux changer d'avis quand tu veux sur la page Moi.",
  manage: 'Tous les réglages de notifications',
  invalidTitle: 'Ce lien ne marche pas',
  invalidBody:
    'Il a peut-être été coupé au moment du copier-coller. Essaie le lien de ton dernier e-mail Potluck, ou change tes réglages sur la page Moi.',
  failed: "Tes réglages n'ont pas été mis à jour. Vérifie ta connexion et réessaie.",
  retry: 'Réessayer',
} satisfies Translation<typeof en.unsubscribe>

export const security = {
  title: 'Connexion et sécurité',
  email: {
    label: 'E-mail',
    change: "Changer d'e-mail",
    newEmail: 'Nouvel e-mail',
    hint: 'On envoie un lien à ton ancienne et à ta nouvelle adresse. Le changement se fait une fois les deux confirmés.',
    submit: 'Envoyer les liens de confirmation',
    same: "C'est déjà ton e-mail.",
    sent: 'Liens envoyés. Ouvre les deux boîtes pour terminer.',
    pending: 'En attente de ta confirmation de {email} depuis les deux boîtes.',
    changed: 'Ton e-mail est maintenant {email}.',
    halfConfirmed: "Et d'un. Ouvre maintenant le lien envoyé à ton autre adresse.",
    cancel: 'Annuler le changement',
    cancelled: 'Changement annulé. Ton e-mail reste {email}.',
  },
  password: {
    label: 'Mot de passe',
    change: 'Changer le mot de passe',
    set: 'Définir un mot de passe',
    setHint:
      "Pour l'instant, tu te connectes avec Google ou Apple. Ajoute un mot de passe pour te connecter aussi avec ton e-mail.",
    current: 'Mot de passe actuel',
    next: 'Nouveau mot de passe',
    confirm: 'Nouveau mot de passe, encore',
    mismatch: 'Les nouveaux mots de passe ne correspondent pas.',
    wrongCurrent: "Ce n'est pas ton mot de passe actuel.",
    submit: 'Enregistrer le mot de passe',
    saved: 'Mot de passe enregistré. Tes autres appareils sont déconnectés.',
    forgot: 'Oublié ?',
    reauthTitle: 'Regarde tes e-mails',
    reauthBody:
      'Ta connexion date un peu, alors on a envoyé un code à {email}. Saisis-le pour enregistrer le nouveau mot de passe.',
    reauthCode: 'Code reçu par e-mail',
  },
  sessions: {
    label: 'Appareils',
    hint: 'Téléphone perdu ou ordinateur partagé ? Ceci déconnecte tous les appareils, celui-ci compris.',
    signOutAll: 'Se déconnecter partout',
    confirmTitle: 'Se déconnecter sur tous les appareils ?',
    confirmBody:
      'Chaque téléphone, tablette et navigateur de ton compte devra se reconnecter, celui-ci compris.',
    done: 'Déconnecté sur tous les appareils.',
  },
  twoFactor: {
    title: 'Connexion en deux étapes',
    hint: "Après ton mot de passe ou ton lien de connexion, Potluck demande un code d'une appli d'authentification.",
    on: 'Activée',
    off: 'Désactivée',
    enable: 'Configurer',
    disable: 'Désactiver',
    since: 'Activée depuis le {date}',
    enabled: 'La connexion en deux étapes est activée.',
    disabled: 'La connexion en deux étapes est désactivée.',
    wrongCode: "Ce code n'a pas marché. Vérifie l'appli et réessaie.",
    code: 'Code à 6 chiffres',
    setup: {
      title: 'Configurer la connexion en deux étapes',
      scan: "Scanne ceci avec une appli d'authentification comme 1Password, Google Authenticator ou Authy.",
      qr: "QR code pour ton appli d'authentification",
      manual: "Impossible de scanner ? Tape plutôt cette clé dans l'appli.",
      copyKey: 'Copier la clé',
      enter: "Saisis ensuite le code affiché par l'appli.",
      submit: 'Activer',
    },
    recovery: {
      title: 'Garde tes codes de récupération',
      body: 'Téléphone perdu ? Chaque code te fait entrer une fois et désactive la connexion en deux étapes, pour que tu puisses la reconfigurer. Range-les en lieu sûr, comme un gestionnaire de mots de passe.',
      copy: 'Copier les codes',
      download: 'Télécharger',
      fileName: 'potluck-codes-de-recuperation.txt',
      done: 'Je les ai gardés',
      left_zero: 'Plus aucun code de récupération',
      left_one: '{count} code de récupération restant',
      left_other: '{count} codes de récupération restants',
      regenerate: 'Nouveaux codes de récupération',
      regenerateBody: 'Tes anciens codes cessent de fonctionner tout de suite.',
    },
    disableTitle: 'Désactiver la connexion en deux étapes ?',
    disableBody:
      "Saisis un code de ton appli d'authentification pour confirmer que c'est bien toi.",
  },
  challenge: {
    title: 'Encore une étape',
    body: "Ouvre ton appli d'authentification et saisis le code à 6 chiffres pour Potluck.",
    submit: 'Vérifier',
    useRecovery: 'Utiliser un code de récupération',
    useApp: "Utiliser mon appli d'authentification",
    recoveryCode: 'Code de récupération',
    recoveryPlaceholder: 'XXXXX-XXXXX',
    recoveryBody:
      'Saisis un des codes que tu as gardés. La connexion en deux étapes se désactive pour que tu la configures sur ton nouveau téléphone.',
    recovered:
      "C'est bon, tu es connecté. La connexion en deux étapes est désactivée pour l'instant, reconfigure-la depuis Moi.",
    wrongRecovery: "Ce code de récupération n'a pas marché.",
    signOut: 'Utiliser un autre compte',
  },
  language: {
    label: 'Langue',
    hint: "Tout ce qui n'est pas encore traduit s'affiche en anglais.",
    saved: 'Langue enregistrée.',
  },
  about: {
    title: 'À propos de Potluck',
    version: 'Version {version}',
    feedback: 'Envoyer un avis',
  },
  errors: {
    same_password: "C'est ton mot de passe actuel. Choisis-en un nouveau.",
    email_address_invalid: 'Cet e-mail ne semble pas correct.',
    mfa_verification_failed: "Ce code n'a pas marché. Vérifie l'appli et réessaie.",
    insufficient_aal: "Termine d'abord la connexion en deux étapes.",
    reauthentication_needed:
      'Par sécurité, déconnecte-toi et reconnecte-toi avant de modifier ceci.',
    invalid_recovery_code: "Ce code de récupération n'a pas marché.",
    too_many_attempts: 'Trop de tentatives. Attends 15 minutes, puis réessaie.',
    reauthentication_not_valid: "Ce code n'a pas marché. Vérifie l'e-mail et réessaie.",
  },
} satisfies Translation<typeof en.security>
