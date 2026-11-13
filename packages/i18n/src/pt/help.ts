import type { Translation } from '../locales'
import type * as en from '../en/help'

export const help = {
  newTab: 'abre numa nova aba',
  goodToKnow: 'Bom saber',
  readMore: 'Saiba mais',
  guide: 'Guia',
  topics: {
    splitEqual: 'Como funciona a divisão em partes iguais',
    splitExact: 'Como funcionam os valores exatos',
    splitPercent: 'Como funciona a divisão por porcentagem',
    splitShares: 'Como funcionam as cotas',
    splitItemized: 'Como funciona a divisão por item',
    rounding: 'Como funciona o arredondamento',
    currencies: 'Sobre outras moedas',
    exchangeRates: 'De onde vem a taxa',
    recurring: 'Como funciona a repetição',
    receipts: 'Quem pode ver um recibo',
    simplifiedDebts: 'Sobre quem paga a quem',
    settleUp: 'Sobre registrar um pagamento',
    roles: 'Quem pode fazer o quê',
    invites: 'Como funcionam os links de convite',
    houseRules: 'Sobre as regras da casa',
    painter: 'Mouse, toque e teclado',
    heatmap: 'Como ler o mapa de calor',
    bestTimes: 'Como os melhores horários são escolhidos',
    lockIn: 'O que confirmar faz',
    calendarFeed: 'Como funciona o feed da agenda',
    push: 'Configurar o push',
    deleteAccount: 'O que acontece com seus grupos',
    twoFactor: 'Como funciona a entrada em duas etapas',
    recurringEdit: 'Alterar uma despesa recorrente',
  },
  tips: {
    simplifiedDebts:
      'O Potluck compensa quem deve a quem para o grupo precisar de menos pagamentos. Talvez você pague alguém com quem nunca dividiu nada diretamente, mas o seu total continua o mesmo.',
    everyDebt:
      'A simplificação está desligada aqui, então cada par acerta as contas por conta própria. As dívidas entre duas pessoas só se compensam entre elas.',
    settleUp:
      'O Potluck não movimenta dinheiro. Pague do jeito de sempre (dinheiro, transferência, um app) e depois registre aqui para o saldo baixar.',
    bestTimes:
      'Só contam os horários em que as pessoas estão livres durante o plano inteiro. Livre vale 1 e Talvez vale meio; a maior pontuação ganha e o horário mais cedo desempata.',
  },
  rounding: {
    one: '{amount} a mais para {names} para a conta bater.',
    each: '{amount} a mais para cada um de {names} para a conta bater.',
    you: 'você',
  },
  recurringEdit:
    'Para alterar o valor ou a divisão, pare a repetição e adicione de novo com os novos números.',
  section: {
    title: 'Ajuda',
    intro: 'O guia passa por todas as telas. Ele abre numa nova aba.',
    gettingStarted: 'Primeiros passos',
    faq: 'Perguntas e respostas',
    troubleshooting: 'Solução de problemas',
    guide: 'O guia completo',
    report: 'Relatar um problema',
  },
} satisfies Translation<typeof en.help>
