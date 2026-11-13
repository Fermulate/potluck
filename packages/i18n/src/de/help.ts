import type { Translation } from '../locales'
import type * as en from '../en/help'

export const help = {
  newTab: 'öffnet in neuem Tab',
  goodToKnow: 'Gut zu wissen',
  readMore: 'Mehr lesen',
  guide: 'Anleitung',
  topics: {
    splitEqual: 'So funktioniert gleichmäßiges Teilen',
    splitExact: 'So funktionieren genaue Beträge',
    splitPercent: 'So funktioniert Teilen nach Prozent',
    splitShares: 'So funktionieren Anteile',
    splitItemized: 'So funktioniert Teilen nach Posten',
    rounding: 'So funktioniert das Runden',
    currencies: 'Über andere Währungen',
    exchangeRates: 'Woher der Kurs kommt',
    recurring: 'So funktioniert Wiederholen',
    receipts: 'Wer einen Beleg sehen kann',
    simplifiedDebts: 'Wer wem zahlt',
    settleUp: 'Über das Erfassen einer Zahlung',
    roles: 'Wer was darf',
    invites: 'So funktionieren Einladungslinks',
    houseRules: 'Über die Hausregeln',
    painter: 'Maus, Touch und Tastatur',
    heatmap: 'Die Heatmap lesen',
    bestTimes: 'So werden die besten Zeiten gewählt',
    lockIn: 'Was Festlegen bewirkt',
    calendarFeed: 'So funktioniert der Kalender-Feed',
    push: 'Push einrichten',
    deleteAccount: 'Was mit deinen Gruppen passiert',
    twoFactor: 'So funktioniert die Anmeldung in zwei Schritten',
    recurringEdit: 'Eine wiederkehrende Ausgabe ändern',
  },
  tips: {
    simplifiedDebts:
      'Potluck verrechnet, wer wem etwas schuldet, damit die Gruppe weniger Zahlungen braucht. Vielleicht zahlst du jemandem, mit dem du nie direkt geteilt hast, aber deine Summe bleibt gleich.',
    everyDebt:
      'Vereinfachen ist hier aus, also begleicht jedes Paar für sich. Schulden zwischen zwei Personen werden nur gegeneinander verrechnet.',
    settleUp:
      'Potluck bewegt kein Geld. Bezahl auf deinem üblichen Weg (bar, Überweisung, App) und trag es dann hier ein, damit der Saldo sinkt.',
    bestTimes:
      'Es zählen nur Zeiten, in denen Leute den ganzen Plan über Zeit haben. Frei zählt 1 und Vielleicht zählt halb; die höchste Punktzahl gewinnt, bei Gleichstand die frühere Zeit.',
  },
  rounding: {
    one: '{amount} extra für {names}, damit es aufgeht.',
    each: 'Je {amount} extra für {names}, damit es aufgeht.',
    you: 'dich',
  },
  recurringEdit:
    'Um Betrag oder Aufteilung zu ändern, stopp sie und füge sie mit den neuen Zahlen neu hinzu.',
  section: {
    title: 'Hilfe',
    intro: 'Die Anleitung geht jeden Bildschirm durch. Sie öffnet sich in einem neuen Tab.',
    gettingStarted: 'Erste Schritte',
    faq: 'Fragen und Antworten',
    troubleshooting: 'Problemlösung',
    guide: 'Die ganze Anleitung',
    report: 'Problem melden',
  },
} satisfies Translation<typeof en.help>
