import type { Translation } from '../locales'
import type * as en from '../en/me'

export const notifications = {
  title: 'Benachrichtigungen',
  markAllRead: 'Alle als gelesen markieren',
  allCaughtUp: 'Alles erledigt.',
  unread_one: '{count} ungelesen',
  unread_other: '{count} ungelesen',
  enablePush: 'Push-Benachrichtigungen einschalten',
  pushBlocked: 'Benachrichtigungen sind in deinen Browsereinstellungen blockiert.',
  someone: 'Jemand',
  aGroup: 'deiner Gruppe',
  anEvent: 'einen Plan',
  anExpense: 'eine Ausgabe',
  generic: { title: 'Es ist was passiert', body: 'Tipp drauf, um es dir anzusehen.' },
  unreadLabel: 'Ungelesen',
  earlier: 'Früher',
  new: 'Neu',
  types: {
    account: {
      mfaRemoved: {
        title: 'Die Anmeldung in zwei Schritten ist aus',
        body: 'Jemand hat sich mit einem Wiederherstellungscode angemeldet. Warst du das nicht, ändere sofort dein Passwort.',
      },
    },
    summary: {
      monthly: { title: 'Dein Monat bei Potluck', settled: 'Alles beglichen. Gut gemacht.' },
      owed: '{group}: du bekommst {amount}',
      owe: '{group}: du schuldest {amount}',
      more_one: 'und {count} weitere Gruppe',
      more_other: 'und {count} weitere Gruppen',
    },
    expense: {
      created: {
        title: 'Neue Ausgabe in {group}',
        body: '{actor} hat {description} hinzugefügt: {amount}',
      },
      updated: {
        title: 'Ausgabe geändert',
        body: '{actor} hat {description} in {group} geändert',
      },
      deleted: {
        title: 'Ausgabe gelöscht',
        body: '{actor} hat {description} in {group} gelöscht',
      },
      restored: {
        title: 'Ausgabe wiederhergestellt',
        body: '{actor} hat {description} in {group} zurückgeholt',
      },
    },
    settlement: {
      created: { title: 'Du hast Geld bekommen', body: '{payer} hat dir {amount} gezahlt' },
      sent: {
        title: 'Zahlung erfasst',
        body: '{payee} hat deine Zahlung über {amount} als erhalten markiert',
      },
      recorded: {
        title: 'Zahlung erfasst',
        body: '{actor} hat deine Zahlung über {amount} an {payee} erfasst',
      },
      updated: {
        title: 'Zahlung geändert',
        body: '{actor} hat eine Zahlung über {amount} in {group} geändert',
      },
      deleted: {
        title: 'Zahlung gelöscht',
        body: '{actor} hat eine Zahlung über {amount} in {group} gelöscht',
      },
      restored: {
        title: 'Zahlung wiederhergestellt',
        body: '{actor} hat eine Zahlung über {amount} in {group} wiederhergestellt',
      },
    },
    member: {
      joined: {
        title: 'Neues Gesicht in {group}',
        body: '{actor} ist gerade beigetreten. Sag Hallo.',
      },
      added: {
        title: 'Willkommen in {group}',
        body: '{actor} hat dich hinzugefügt. Setz dich zu uns.',
      },
    },
    event: {
      created: { title: 'Da braut sich was zusammen', body: '{actor} plant {event}' },
      scheduled: { title: 'Abgemacht', body: '{event} steht fest: {date}' },
      cancelled: { title: 'Planänderung', body: '{event} wurde abgesagt' },
      reminder: { title: 'Demnächst', body: '{event} beginnt {when}' },
    },
    availability: {
      requested: {
        title: 'Wann hast du Zeit?',
        body: '{actor} braucht deine Zeiten für {event}',
      },
    },
    rsvp: {
      reminder: { title: 'Bist du dabei?', body: 'Sag {group}, ob du zu {event} kommst' },
    },
    comment: {
      created: { title: 'Neuer Kommentar', body: '{actor}: {preview}' },
    },
    debt: {
      reminder: {
        title: 'Eine freundliche Erinnerung',
        body: '{actor} sagt, du schuldest {amount} in {group}',
        bodyWithNote: '{actor} sagt, du schuldest {amount} in {group}: "{note}"',
      },
    },
  },
} satisfies Translation<typeof en.notifications>

export const settings = {
  title: 'Ich',
  subtitle: 'Dein Profil, deine Einstellungen, dein Ausgang.',
  profile: {
    title: 'Profil',
    nameRequired: 'Dein Name darf nicht leer sein.',
    name: 'Anzeigename',
    photo: 'Foto',
    changePhoto: 'Foto ändern',
    removePhoto: 'Foto entfernen',
    email: 'E-Mail',
    saved: 'Profil gespeichert.',
  },
  preferences: {
    title: 'Einstellungen',
    timezone: 'Zeitzone',
    timezoneHint: 'Zeiten werden in dieser Zone angezeigt.',
    detectTimezone: 'Meine aktuelle Zeitzone verwenden',
    currency: 'Standardwährung',
    currencyHint: 'Für neue Gruppen.',
    language: 'Sprache',
    theme: 'Darstellung',
    themeSystem: 'System',
    themeLight: 'Hell',
    themeDark: 'Dunkel',
    saved: 'Einstellungen gespeichert.',
  },
  notifications: {
    title: 'Benachrichtigungen',
    inbox: 'Posteingang öffnen',
    push: 'Push-Benachrichtigungen',
    pushHint: 'Ein Ping auf diesem Gerät, wenn dich etwas braucht.',
    pushOn: 'Push ist auf diesem Gerät an.',
    pushUnsupported:
      'Dieser Browser kann keine Push-Benachrichtigungen. Auf dem iPhone füge Potluck zuerst zum Home-Bildschirm hinzu.',
    pushNotConfigured: 'Push ist auf diesem Server noch nicht eingerichtet.',
    pushFailed: 'Push ließ sich nicht einschalten. Nochmal versuchen?',
    inApp: 'Neuigkeiten siehst du immer in deinem Posteingang.',
    email: 'E-Mail-Benachrichtigungen',
    expenses: 'Neue Ausgaben',
    payments: 'Zahlungen',
    plans: 'Pläne und Zeitanfragen',
    reminders: 'Erinnerungen an Events',
  },
  calendar: {
    title: 'Kalender',
    feed: 'Kalender-Feed',
    feedHint: 'Abonniere deine Potluck-Pläne in jeder Kalender-App.',
    copyFeed: 'Feed-Link kopieren',
    subscribe: 'Abonnieren',
    resetFeed: 'Link zurücksetzen',
    resetFeedHint: 'Der alte Link funktioniert dann nicht mehr.',
    connect: 'Kalender verbinden',
    connectHint: 'Wir lesen nur, wann du belegt bist, nie, was du machst.',
    connected: 'Verbunden',
    disconnect: 'Trennen',
    comingSoon: 'Kommt bald',
  },
  privacy: {
    title: 'Privatsphäre',
    blocked: 'Blockierte Personen',
    noneBlocked: 'Niemand blockiert. Herrlich.',
    unblock: 'Freigeben',
  },
  about: {
    title: 'Über',
    version: 'Version {version}',
    source: 'Quellcode',
    license: 'Freie Software unter der AGPL-3.0',
    feedback: 'Feedback senden',
  },
  notificationPrefs: {
    title: 'Worüber du Bescheid bekommst',
    hint: 'Dein Posteingang bekommt alles. Wähle, was zusätzlich auf deinen Geräten oder per E-Mail ankommt.',
    push: 'Push',
    email: 'E-Mail',
    channel: '{category}: {channel}',
    emailSoon:
      'E-Mail-Benachrichtigungen sind unterwegs. Bis dahin steht alles in deinem Posteingang.',
    failed: 'Die Einstellung wurde nicht gespeichert. Nochmal versuchen?',
    offline: 'Du bist offline. Deine Änderung wird gespeichert, sobald du wieder online bist.',
    summaryEmail: 'Per E-Mail',
    pushOffHere:
      'Push ist auf diesem Gerät aus, also kommen diese nur auf deinen anderen Geräten an.',
    turnOnPush: 'Push hier einschalten',
    categories: {
      expense_added: {
        label: 'Neue Ausgaben',
        hint: 'Jemand fügt eine Ausgabe hinzu, an der du beteiligt bist.',
        about: 'neuen Ausgaben',
      },
      expense_changed: {
        label: 'Änderungen und Löschungen',
        hint: 'Eine Ausgabe, an der du beteiligt bist, wird geändert, gelöscht oder wiederhergestellt.',
        about: 'Änderungen und Löschungen von Ausgaben',
      },
      payments: {
        label: 'Zahlungen',
        hint: 'Jemand zahlt dir etwas oder erfasst eine Zahlung mit dir.',
        about: 'Zahlungen',
      },
      comments: {
        label: 'Kommentare',
        hint: 'Neue Kommentare zu Ausgaben und Plänen, bei denen du dabei bist.',
        about: 'Kommentaren',
      },
      groups: {
        label: 'Gruppen',
        hint: 'Jemand tritt einer Gruppe bei, die du leitest.',
        about: 'Neuigkeiten aus Gruppen',
      },
      plans: {
        label: 'Pläne',
        hint: 'Neue Pläne, feste Termine, Absagen und Zeitanfragen.',
        about: 'Plänen',
      },
      reminders: {
        label: 'Erinnerungen',
        hint: 'Anstehende Pläne und Zusagen, die du noch schuldest.',
        about: 'Erinnerungen',
      },
      monthly_summary: {
        label: 'Monatsübersicht',
        hint: 'Deine Salden am Ersten jedes Monats, als Karte in deinem Posteingang.',
        hintEmail: 'Deine Salden am Ersten jedes Monats, im Posteingang und per E-Mail.',
        about: 'der Monatsübersicht',
      },
    },
  },
  paymentMethods: {
    title: 'Zahlungswege',
    hint: 'Leute in deinen Gruppen sehen sie, wenn sie mit dir ausgleichen, und können dich mit einem Tipp bezahlen. Potluck bewegt nie Geld.',
    empty: 'Noch nichts gespeichert.',
    add: 'Zahlungsweg hinzufügen',
    edit: '{app} ändern',
    remove: '{app} entfernen',
    removed: '{app} entfernt.',
    saved: '{app} gespeichert.',
    pickApp: 'Welche App?',
    save: 'Speichern',
    invalid: 'Das sieht nicht nach einem {app}-Namen aus.',
    handle: {
      paypal: 'PayPal.me-Name',
      venmo: 'Venmo-Name',
      cashapp: 'Cashtag',
      revolut: 'Revolut-Name',
      monzo: 'Monzo.me-Name',
      upi: 'UPI-ID',
      interac: 'E-Mail oder Telefon für e-Transfers',
      bank: 'Bankverbindung',
    },
    placeholder: {
      paypal: 'deinname',
      venmo: 'dein-name',
      cashapp: 'deinname',
      revolut: 'deinname',
      monzo: 'deinname',
      upi: 'name@bank',
      interac: 'du@beispiel.de',
      bank: 'IBAN oder Bankleitzahl und Kontonummer',
    },
    pasteHint: 'Du kannst auch den Link zu deinem Profil einfügen.',
  },
} satisfies Translation<typeof en.settings>

export const account = {
  delete: {
    title: 'Konto löschen',
    warning:
      'Das entfernt dein Profil, dein Foto und deine E-Mail. Ausgaben, an denen du beteiligt warst, bleiben, damit die Gruppensummen stimmen, aber sie zeigen dann "Ehemaliges Mitglied" statt deines Namens.',
    blocked: 'Du hast noch offene Salden in {groups}. Erst begleichen.',
    ownerBlocked: 'Dir gehört {groups}. Übergib das zuerst an jemand anderen.',
    confirmPhrase: 'Tippe LÖSCHEN zur Bestätigung',
    confirmWord: 'LÖSCHEN',
    submit: 'Mein Konto löschen',
    deleting: 'Wir räumen deinen Platz am Tisch...',
    done: 'Dein Konto ist weg. Danke für jedes Abendessen.',
    formerMember: 'Ehemaliges Mitglied',
  },
  export: {
    title: 'Meine Daten herunterladen',
    hint: 'Eine Kopie deiner Ausgaben, Zahlungen und Pläne.',
    ready: 'Dein Export ist bereit.',
  },
} satisfies Translation<typeof en.account>

export const unsubscribe = {
  title: 'E-Mail-Einstellungen',
  working: 'Dein Link wird geprüft...',
  askTitle: 'Diese E-Mails abbestellen?',
  askOne: 'Du bekommst keine E-Mails mehr zu {what}. Dein Potluck-Posteingang bleibt, wie er ist.',
  askAll:
    'Du bekommst gar keine E-Mails mehr von Potluck. Dein Potluck-Posteingang bleibt, wie er ist.',
  account: 'Für {email}',
  confirm: 'Abbestellen',
  alreadyTitle: 'Du stehst schon nicht mehr auf der Liste',
  resubscribe: 'Wieder schicken',
  done: 'Du stehst nicht mehr auf der Liste',
  doneOne: 'Keine E-Mails mehr zu {what}. Dein Potluck-Posteingang bleibt, wie er ist.',
  doneAll: 'Keine E-Mails mehr von Potluck. Dein Potluck-Posteingang bleibt, wie er ist.',
  nothingToUndo:
    'Mit diesem Link gibt es nichts zurückzunehmen: Deine E-Mail-Einstellungen sind, wie du sie gelassen hast. Ändere sie auf der Ich-Seite.',
  offline: 'Du bist offline. Das geht durch, sobald du wieder online bist.',
  undo: 'Weiter schicken',
  undone: 'Du stehst wieder auf der Liste',
  undoneBody:
    'Diese E-Mails kommen weiter. Du kannst es dir jederzeit auf der Ich-Seite anders überlegen.',
  manage: 'Alle Benachrichtigungseinstellungen',
  invalidTitle: 'Dieser Link funktioniert nicht',
  invalidBody:
    'Vielleicht wurde er beim Kopieren abgeschnitten. Probier den Link aus deiner neuesten Potluck-E-Mail oder ändere deine Einstellungen auf der Ich-Seite.',
  failed:
    'Deine Einstellungen wurden nicht aktualisiert. Prüf deine Verbindung und versuch es nochmal.',
  retry: 'Nochmal versuchen',
} satisfies Translation<typeof en.unsubscribe>

export const security = {
  title: 'Anmeldung und Sicherheit',
  email: {
    label: 'E-Mail',
    change: 'E-Mail ändern',
    newEmail: 'Neue E-Mail',
    hint: 'Wir schicken einen Link an deine alte und deine neue Adresse. Gewechselt wird, sobald beide bestätigt sind.',
    submit: 'Bestätigungslinks senden',
    same: 'Das ist schon deine E-Mail.',
    sent: 'Links gesendet. Öffne beide Postfächer, um abzuschließen.',
    pending: 'Wir warten darauf, dass du {email} in beiden Postfächern bestätigst.',
    changed: 'Deine E-Mail ist jetzt {email}.',
    halfConfirmed:
      'Eins geschafft. Öffne jetzt den Link, den wir an deine andere Adresse geschickt haben.',
    cancel: 'Änderung abbrechen',
    cancelled: 'Änderung abgebrochen. Deine E-Mail bleibt {email}.',
  },
  password: {
    label: 'Passwort',
    change: 'Passwort ändern',
    set: 'Passwort festlegen',
    setHint:
      'Du meldest dich gerade mit Google oder Apple an. Leg ein Passwort fest, um dich auch mit deiner E-Mail anzumelden.',
    current: 'Aktuelles Passwort',
    next: 'Neues Passwort',
    confirm: 'Neues Passwort wiederholen',
    mismatch: 'Die neuen Passwörter stimmen nicht überein.',
    wrongCurrent: 'Das ist nicht dein aktuelles Passwort.',
    submit: 'Passwort speichern',
    saved: 'Passwort gespeichert. Deine anderen Geräte sind abgemeldet.',
    forgot: 'Vergessen?',
    reauthTitle: 'Schau in deine E-Mails',
    reauthBody:
      'Deine Anmeldung ist eine Weile her, deshalb haben wir einen Code an {email} geschickt. Gib ihn ein, um das neue Passwort zu speichern.',
    reauthCode: 'Code aus der E-Mail',
  },
  sessions: {
    label: 'Geräte',
    hint: 'Handy verloren oder einen fremden Computer benutzt? Das meldet jedes Gerät ab, auch dieses.',
    signOutAll: 'Überall abmelden',
    confirmTitle: 'Auf allen Geräten abmelden?',
    confirmBody:
      'Jedes Handy, Tablet und jeder Browser mit deinem Konto muss sich neu anmelden, auch dieser hier.',
    done: 'Auf allen Geräten abgemeldet.',
  },
  twoFactor: {
    title: 'Anmeldung in zwei Schritten',
    hint: 'Nach deinem Passwort oder Anmeldelink fragt Potluck nach einem Code aus einer Authenticator-App.',
    on: 'An',
    off: 'Aus',
    enable: 'Einrichten',
    disable: 'Ausschalten',
    since: 'An seit {date}',
    enabled: 'Anmeldung in zwei Schritten ist an.',
    disabled: 'Anmeldung in zwei Schritten ist aus.',
    wrongCode: 'Der Code hat nicht geklappt. Schau in die App und versuch es nochmal.',
    code: '6‑stelliger Code',
    setup: {
      title: 'Anmeldung in zwei Schritten einrichten',
      scan: 'Scanne das mit einer Authenticator-App wie 1Password, Google Authenticator oder Authy.',
      qr: 'QR-Code für deine Authenticator-App',
      manual: 'Scannen klappt nicht? Gib stattdessen diesen Schlüssel in der App ein.',
      copyKey: 'Schlüssel kopieren',
      enter: 'Gib dann den Code ein, den die App anzeigt.',
      submit: 'Einschalten',
    },
    recovery: {
      title: 'Speichere deine Wiederherstellungscodes',
      body: 'Handy verloren? Jeder Code lässt dich einmal rein und schaltet die Anmeldung in zwei Schritten aus, damit du sie neu einrichten kannst. Bewahr sie sicher auf, etwa in einem Passwortmanager.',
      copy: 'Codes kopieren',
      download: 'Herunterladen',
      fileName: 'potluck-wiederherstellungscodes.txt',
      done: 'Hab ich gespeichert',
      left_zero: 'Keine Wiederherstellungscodes mehr',
      left_one: 'Noch {count} Wiederherstellungscode',
      left_other: 'Noch {count} Wiederherstellungscodes',
      regenerate: 'Neue Wiederherstellungscodes',
      regenerateBody: 'Deine alten Codes funktionieren sofort nicht mehr.',
    },
    disableTitle: 'Anmeldung in zwei Schritten ausschalten?',
    disableBody:
      'Gib einen Code aus deiner Authenticator-App ein, um zu bestätigen, dass du es bist.',
  },
  challenge: {
    title: 'Noch ein Schritt',
    body: 'Öffne deine Authenticator-App und gib den 6‑stelligen Code für Potluck ein.',
    submit: 'Bestätigen',
    useRecovery: 'Wiederherstellungscode verwenden',
    useApp: 'Meine Authenticator-App verwenden',
    recoveryCode: 'Wiederherstellungscode',
    recoveryPlaceholder: 'XXXXX-XXXXX',
    recoveryBody:
      'Gib einen der gespeicherten Codes ein. Die Anmeldung in zwei Schritten wird ausgeschaltet, damit du sie auf deinem neuen Handy einrichten kannst.',
    recovered:
      'Du bist drin. Die Anmeldung in zwei Schritten ist vorerst aus, richte sie unter "Ich" neu ein.',
    wrongRecovery: 'Dieser Wiederherstellungscode hat nicht geklappt.',
    signOut: 'Anderes Konto verwenden',
  },
  language: {
    label: 'Sprache',
    hint: 'Was noch nicht übersetzt ist, erscheint auf Englisch.',
    saved: 'Sprache gespeichert.',
  },
  about: {
    title: 'Über Potluck',
    version: 'Version {version}',
    feedback: 'Feedback senden',
  },
  errors: {
    same_password: 'Das ist dein aktuelles Passwort. Wähle ein neues.',
    email_address_invalid: 'Diese E-Mail sieht nicht richtig aus.',
    mfa_verification_failed:
      'Der Code hat nicht geklappt. Schau in die App und versuch es nochmal.',
    insufficient_aal: 'Schließ zuerst die Anmeldung in zwei Schritten ab.',
    reauthentication_needed: 'Melde dich zur Sicherheit ab und wieder an, bevor du das änderst.',
    invalid_recovery_code: 'Dieser Wiederherstellungscode hat nicht geklappt.',
    too_many_attempts: 'Zu viele Versuche. Warte 15 Minuten und versuch es dann nochmal.',
    reauthentication_not_valid:
      'Der Code hat nicht geklappt. Schau in die E-Mail und versuch es nochmal.',
  },
} satisfies Translation<typeof en.security>
