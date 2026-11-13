import type { Translation } from '../locales'
import type * as en from '../en/help'

export const help = {
  newTab: 'se abre en una pestaña nueva',
  goodToKnow: 'Conviene saber',
  readMore: 'Leer más',
  guide: 'Guía',
  topics: {
    splitEqual: 'Cómo funciona dividir a partes iguales',
    splitExact: 'Cómo funcionan los importes exactos',
    splitPercent: 'Cómo funciona dividir por porcentaje',
    splitShares: 'Cómo funcionan las partes',
    splitItemized: 'Cómo funciona por artículo',
    rounding: 'Cómo funciona el redondeo',
    currencies: 'Sobre otras monedas',
    exchangeRates: 'De dónde sale el tipo de cambio',
    recurring: 'Cómo funcionan los gastos que se repiten',
    receipts: 'Quién puede ver un recibo',
    simplifiedDebts: 'Sobre quién paga a quién',
    settleUp: 'Sobre registrar un pago',
    roles: 'Quién puede hacer qué',
    invites: 'Cómo funcionan los enlaces de invitación',
    houseRules: 'Sobre las normas de la casa',
    painter: 'Ratón, pantalla táctil y teclado',
    heatmap: 'Cómo leer el mapa de calor',
    bestTimes: 'Cómo se eligen los mejores horarios',
    lockIn: 'Qué pasa al fijar un plan',
    calendarFeed: 'Cómo funciona el feed de calendario',
    push: 'Configurar las notificaciones push',
    deleteAccount: 'Qué pasa con tus grupos',
    twoFactor: 'Cómo funciona el inicio de sesión en dos pasos',
    recurringEdit: 'Cambiar un gasto que se repite',
  },
  tips: {
    simplifiedDebts:
      'Potluck compensa quién debe a quién para que el grupo necesite menos pagos. Quizá le pagues a alguien con quien nunca dividiste nada directamente, pero tu total sigue igual.',
    everyDebt:
      'Aquí la simplificación está desactivada, así que cada pareja salda por su cuenta. Las deudas entre dos personas solo se compensan entre ellas.',
    settleUp:
      'Potluck no mueve dinero. Págale como siempre (efectivo, transferencia, una app) y luego regístralo aquí para que baje el saldo.',
    bestTimes:
      'Solo cuentan los horarios en los que la gente está libre durante todo el plan. Libre vale 1 y Quizá vale medio; gana la puntuación más alta y, si hay empate, el horario más temprano.',
  },
  rounding: {
    one: '{amount} de más para {names} para que cuadre.',
    each: '{amount} de más cada uno para {names} para que cuadre.',
    you: 'ti',
  },
  recurringEdit:
    'Para cambiar el importe o el reparto, detenlo y vuelve a añadirlo con los números nuevos.',
  section: {
    title: 'Ayuda',
    intro: 'La guía recorre cada pantalla. Se abre en una pestaña nueva.',
    gettingStarted: 'Primeros pasos',
    faq: 'Preguntas y respuestas',
    troubleshooting: 'Solución de problemas',
    guide: 'La guía completa',
    report: 'Informar de un problema',
  },
} satisfies Translation<typeof en.help>
