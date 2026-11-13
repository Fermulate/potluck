import type { Translation } from '../locales'
import type * as en from '../en/help'

export const help = {
  newTab: "s'ouvre dans un nouvel onglet",
  goodToKnow: 'Bon à savoir',
  readMore: 'En savoir plus',
  guide: 'Guide',
  topics: {
    splitEqual: 'Comment marche le partage à parts égales',
    splitExact: 'Comment marchent les montants exacts',
    splitPercent: 'Comment marche le partage en pourcentage',
    splitShares: 'Comment marchent les parts',
    splitItemized: 'Comment marche le partage par article',
    rounding: 'Comment marchent les arrondis',
    currencies: 'À propos des autres devises',
    exchangeRates: "D'où vient le taux",
    recurring: 'Comment marche la répétition',
    receipts: 'Qui peut voir un reçu',
    simplifiedDebts: 'À propos de qui paie qui',
    settleUp: "À propos de l'enregistrement d'un paiement",
    roles: 'Qui peut faire quoi',
    invites: "Comment marchent les liens d'invitation",
    houseRules: 'À propos des règles de la maison',
    painter: 'Souris, tactile et clavier',
    heatmap: 'Lire la carte de chaleur',
    guestLinks: 'Comment marchent les liens invité',
    bestTimes: 'Comment les meilleurs horaires sont choisis',
    lockIn: 'Ce que fait le calage',
    calendarFeed: 'Comment marche le flux de calendrier',
    push: 'Configurer le push',
    deleteAccount: 'Ce qui arrive à tes groupes',
    twoFactor: 'Comment marche la connexion en deux étapes',
    recurringEdit: 'Modifier une dépense récurrente',
    splitAdjustment: 'Comment marchent les ajustements',
    payers: 'Quand plusieurs personnes ont payé',
    refunds: 'Comment marchent les remboursements',
    defaultSplit: 'À propos du partage par défaut',
    paymentLinks: 'Comment payer avec une appli',
    remind: 'À propos des rappels',
    settleEverything: 'À propos de tout régler',
    settleFriend: 'À propos du règlement entre groupes',
    paymentMethods: 'Qui voit tes moyens de paiement',
    search: 'Ce que la recherche parcourt',
    totals: 'Comment les totaux sont calculés',
    restore: 'À propos de la restauration',
  },
  tips: {
    simplifiedDebts:
      "Potluck compense qui doit quoi à qui pour que le groupe ait besoin de moins de paiements. Tu paieras peut-être quelqu'un avec qui tu n'as jamais partagé directement, mais ton total reste le même.",
    everyDebt:
      "La simplification est désactivée ici, chaque paire règle donc de son côté. Les dettes entre deux personnes ne se compensent qu'entre elles.",
    settleUp:
      "Potluck ne déplace pas d'argent. Paie comme d'habitude (espèces, virement, une appli), puis enregistre-le ici pour que le solde baisse.",
    bestTimes:
      "Seuls comptent les horaires où les gens sont libres pendant toute la sortie. Libre compte 1 et Peut-être compte une demi ; le meilleur score gagne et l'horaire le plus tôt départage les ex aequo.",
    paymentLinks:
      "Le bouton ouvre son appli avec le montant déjà saisi. Potluck ne voit jamais le paiement, il te demande donc de confirmer avant de l'enregistrer.",
  },
  rounding: {
    one: '{amount} de plus pour {names} pour que le compte tombe juste.',
    each: '{amount} de plus chacun pour {names} pour que le compte tombe juste.',
    you: 'toi',
  },
  recurringEdit:
    'Touche-en une pour changer son montant, son partage ou son rythme. Les dépenses déjà ajoutées ne bougent pas.',
  section: {
    title: 'Aide',
    intro: "Le guide passe en revue chaque écran. Il s'ouvre dans un nouvel onglet.",
    gettingStarted: 'Bien démarrer',
    faq: 'Questions et réponses',
    troubleshooting: 'Dépannage',
    guide: 'Le guide complet',
    report: 'Signaler un problème',
  },
} satisfies Translation<typeof en.help>
