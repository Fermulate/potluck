import type { Translation } from '../locales'
import type * as en from '../en/auth'

export const auth = {
  signIn: {
    title: 'Schön, dass du wieder da bist',
    subtitle: 'Nimm dir einen Stuhl.',
    submit: 'Anmelden',
    magicLink: 'Anmeldelink per E-Mail schicken',
    noAccount: 'Neu hier?',
    createAccount: 'Konto erstellen',
    usePassword: 'Lieber mit Passwort',
  },
  signUp: {
    title: 'Setz dich dazu',
    subtitle: 'Gemeinsame Rechnungen und Pläne, ohne peinliche Rechnerei.',
    submit: 'Konto erstellen',
    haveAccount: 'Du hast schon ein Konto?',
    signInLink: 'Anmelden',
    terms:
      'Wenn du fortfährst, stimmst du den Nutzungsbedingungen und der Datenschutzerklärung zu.',
  },
  fields: {
    email: 'E-Mail',
    emailPlaceholder: 'du@example.com',
    password: 'Passwort',
    passwordHint: 'Mindestens 8 Zeichen.',
    name: 'Dein Name',
    namePlaceholder: 'Wie nennen dich deine Freunde?',
    newPassword: 'Neues Passwort',
    showPassword: 'Passwort anzeigen',
    hidePassword: 'Passwort verbergen',
  },
  checkEmail: {
    title: 'Schau in dein Postfach',
    body: 'Wir haben einen Link an {email} geschickt. Tipp drauf und du bist drin.',
    resend: 'Nochmal senden',
    resent: 'Gesendet. Gib ihm eine Minute.',
    back: 'Andere E-Mail verwenden',
  },
  forgotPassword: {
    link: 'Passwort vergessen?',
    title: 'Passwort zurücksetzen',
    body: 'Verrat uns deine E-Mail und wir schicken dir einen Link zum Zurücksetzen.',
    submit: 'Link senden',
    sent: 'Falls es zu dieser E-Mail ein Konto gibt, ist ein Link unterwegs.',
    back: 'Zurück zur Anmeldung',
  },
  resetPassword: {
    title: 'Neues Passwort wählen',
    submit: 'Passwort ändern',
    done: 'Passwort geändert. Weiter geht es.',
    expired: 'Dieser Link ist abgelaufen. Fordere einen neuen an.',
  },
  callback: {
    working: 'Wir decken deinen Platz...',
    failed: 'Dieser Link ist abgelaufen oder wurde schon benutzt.',
    tryAgain: 'Zurück zur Anmeldung',
  },
  side: {
    quote: 'Alle bringen etwas mit. Wir merken uns, wer.',
    caption: 'Teilen, planen und abrechnen für Freundeskreise.',
  },
  joinNotice: 'Melde dich an oder erstelle ein Konto, um {group} beizutreten.',
  signOut: 'Abmelden',
  signedOut: 'Abgemeldet. Bis bald.',
  continueWithGoogle: 'Weiter mit Google',
  continueWithApple: 'Weiter mit Apple',
  or: 'oder',
} satisfies Translation<typeof en.auth>

export const onboarding = {
  step: 'Schritt {step} von {total}',
  profile: {
    title: 'Erst mal das Wichtigste',
    body: 'So sehen dich deine Freunde bei gemeinsamen Rechnungen und Plänen.',
    uploading: 'Lädt hoch...',
    photoTooBig: 'Das Foto ist größer als 5 MB. Versuch ein kleineres.',
    photoType: 'Nimm ein PNG, JPG, WebP oder GIF.',
    photoFailed: 'Das Foto wurde nicht hochgeladen. Nochmal versuchen?',
    timezoneHint: 'Das haben wir an deinem Gerät abgelesen.',
    currencyHint: 'Neue Gruppen starten in dieser Währung.',
    save: 'Sieht gut aus',
    nameLabel: 'Anzeigename',
    avatarLabel: 'Foto hinzufügen',
    timezoneLabel: 'Zeitzone',
    currencyLabel: 'Standardwährung',
  },
  firstGroup: {
    title: 'Gruppe starten',
    body: 'WG, Reise, die Donnerstagsrunde zum Essen. Alle, mit denen du Kosten teilst.',
    create: 'Gruppe erstellen',
    join: 'Ich habe einen Einladungslink',
    skip: 'Vielleicht später',
  },
} satisfies Translation<typeof en.onboarding>
