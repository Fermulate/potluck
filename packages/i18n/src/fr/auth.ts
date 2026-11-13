import type { Translation } from '../locales'
import type * as en from '../en/auth'

export const auth = {
  signIn: {
    title: 'Content de te revoir',
    subtitle: 'Prends une chaise.',
    submit: 'Se connecter',
    magicLink: 'Recevoir un lien de connexion par e-mail',
    noAccount: 'Nouveau ici ?',
    createAccount: 'Créer un compte',
    usePassword: 'Utiliser plutôt un mot de passe',
  },
  signUp: {
    title: 'Viens à table',
    subtitle: 'Des comptes et des sorties partagés, sans les calculs gênants.',
    submit: 'Créer un compte',
    haveAccount: 'Déjà un compte ?',
    signInLink: 'Se connecter',
    terms:
      "En continuant, tu acceptes les conditions d'utilisation et la politique de confidentialité.",
  },
  fields: {
    email: 'E-mail',
    emailPlaceholder: 'toi@exemple.com',
    password: 'Mot de passe',
    passwordHint: 'Au moins 8 caractères.',
    name: 'Ton nom',
    namePlaceholder: "Comment t'appellent tes amis ?",
    newPassword: 'Nouveau mot de passe',
    showPassword: 'Afficher le mot de passe',
    hidePassword: 'Masquer le mot de passe',
  },
  checkEmail: {
    title: 'Regarde ta boîte de réception',
    body: "On a envoyé un lien à {email}. Touche-le et c'est bon.",
    resend: 'Renvoyer',
    resent: 'Envoyé. Laisse-lui une minute.',
    back: 'Utiliser une autre adresse',
  },
  forgotPassword: {
    link: 'Mot de passe oublié ?',
    title: 'Réinitialise ton mot de passe',
    body: "Donne-nous ton e-mail et on t'envoie un lien de réinitialisation.",
    submit: 'Envoyer le lien',
    sent: 'Si cet e-mail a un compte, un lien est en route.',
    back: 'Retour à la connexion',
  },
  resetPassword: {
    title: 'Choisis un nouveau mot de passe',
    submit: 'Mettre à jour le mot de passe',
    done: 'Mot de passe mis à jour. Tu peux continuer.',
    expired: 'Ce lien de réinitialisation a expiré. Demandes-en un nouveau.',
  },
  callback: {
    working: 'On met ton couvert...',
    failed: 'Ce lien a expiré ou a déjà servi.',
    tryAgain: 'Retour à la connexion',
  },
  side: {
    quote: 'Chacun apporte quelque chose. On note qui apporte quoi.',
    caption: 'Partager, organiser et régler les comptes entre amis.',
  },
  joinNotice: 'Connecte-toi ou crée un compte pour rejoindre {group}.',
  signOut: 'Se déconnecter',
  signedOut: 'Déconnecté. À bientôt.',
  continueWithGoogle: 'Continuer avec Google',
  continueWithApple: 'Continuer avec Apple',
  or: 'ou',
} satisfies Translation<typeof en.auth>

export const onboarding = {
  step: 'Étape {step} sur {total}',
  profile: {
    title: "D'abord, les bases",
    body: 'Voilà comment tes amis te verront sur les comptes et les sorties partagés.',
    uploading: 'Envoi...',
    photoTooBig: 'Cette photo dépasse 5 Mo. Essaie une plus petite.',
    photoType: 'Utilise un PNG, JPG, WebP ou GIF.',
    photoFailed: "La photo n'est pas passée. On réessaie ?",
    timezoneHint: "On l'a deviné grâce à ton appareil.",
    currencyHint: 'Les nouveaux groupes démarrent dans cette devise.',
    save: "C'est parfait",
    nameLabel: 'Nom affiché',
    avatarLabel: 'Ajouter une photo',
    timezoneLabel: 'Fuseau horaire',
    currencyLabel: 'Devise par défaut',
  },
  firstGroup: {
    title: 'Crée un groupe',
    body: 'Colocs, un voyage, la bande du dîner du jeudi. Tous ceux avec qui tu partages des frais.',
    create: 'Créer un groupe',
    join: "J'ai un lien d'invitation",
    skip: 'Plus tard',
  },
} satisfies Translation<typeof en.onboarding>
