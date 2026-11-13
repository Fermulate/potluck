import type { transfer as en } from '../en/transfer'

/** Same nesting as English, every string optional (as `Translation` in the languages setup). */
type Translation<T> = {
  readonly [K in keyof T]?: T[K] extends string ? string : Translation<T[K]>
}

/**
 * Spanish for export, backup and import. Joins `es.ts` (one import and one entry, like the other
 * feature files) where the language switcher lives; the activity lines for an import are in
 * `activity` below, for `es/money.ts`.
 */
export const transfer = {
  csv: {
    date: 'Fecha',
    group: 'Grupo',
    type: 'Tipo',
    description: 'Descripción',
    category: 'Categoría',
    amount: 'Importe',
    currency: 'Moneda',
    rate: 'Tipo de cambio',
    groupCurrency: 'Moneda del grupo',
    groupAmount: 'Importe en la moneda del grupo',
    paidBy: 'Pagado por',
    notes: 'Notas',
    items: 'Artículos',
    paid: '{name} pagó',
    share: 'Parte de {name}',
    balance: 'Saldo de {name}',
    between: 'Entre tú y {name}',
    kinds: {
      expense: 'Gasto',
      refund: 'Reembolso',
      payment: 'Pago',
      balance: 'Saldo',
    },
    tax: 'Impuestos',
    tip: 'Propina',
    discount: 'Descuento',
  },
  saved: 'Guardado {file}.',
  failed: 'No se pudo descargar. Inténtalo de nuevo en un momento.',
  yourData: {
    title: 'Tus datos',
    intro: 'Todo lo que pones en Potluck es tuyo. Llévatelo cuando quieras.',
    backup: 'Descargar una copia',
    backupHint: 'Todos los grupos, gastos, pagos, comentarios y planes, en un archivo JSON.',
    everything: 'Exportar todo',
    everythingHint:
      'Todos tus grupos en una hoja de cálculo, con quién pagó, cada parte y los saldos.',
    friend: 'Exportar lo que compartes con alguien',
    friendHint: 'Cada gasto y pago entre ustedes dos, de todos los grupos.',
    friendLabel: 'Amigo',
    friendPick: 'Elige a alguien',
    friendExport: 'Exportar',
    noFriends: 'Cuando compartas un grupo con alguien, podrás exportar lo que hay entre ustedes.',
    importHint:
      '¿Vienes de Splitwise? Abre el grupo de Potluck donde va, luego Ajustes, Importar gastos.',
    preparing: 'Empaquetando',
  },
  group: {
    title: 'Hojas de cálculo',
    export: 'Exportar',
    exportHint: 'Cada gasto y pago, con quién pagó, cada parte y los saldos.',
    import: 'Importar',
    importHint: 'Trae una exportación de Splitwise o una hoja de cálculo de Potluck.',
    importArchived: 'Desarchiva el grupo para importar en él.',
  },
  import: {
    title: 'Importar gastos',
    untitled: 'Gasto importado',
    intro:
      'Trae un grupo desde Splitwise o vuelve a cargar una hoja de cálculo de Potluck. No se guarda nada hasta que lo digas.',
    pick: 'Elige un archivo CSV',
    pickHint: 'o suéltalo aquí',
    fromSplitwise:
      'Desde Splitwise: abre el grupo en splitwise.com y elige Exportar como hoja de cálculo.',
    fromPotluck: 'Desde Potluck: el botón Exportar de cualquier grupo.',
    reading: 'Leyendo {file}',
    another: 'Elegir otro archivo',
    format: {
      splitwise: 'Exportación de Splitwise',
      potluck: 'Hoja de cálculo de Potluck',
    },
    fileSummary_one: '{count} fila, {people}',
    fileSummary_other: '{count} filas, {people}',
    who: 'Quién es quién',
    whoHint:
      'Empareja cada nombre del archivo con alguien de {group}. Dos nombres pueden ser la misma persona.',
    notMatched: 'Elige a alguien',
    sourceGroup: 'Qué grupo del archivo',
    preview: 'Lo que se importa',
    expenses_one: '{count} gasto',
    expenses_other: '{count} gastos',
    refunds_one: '{count} reembolso',
    refunds_other: '{count} reembolsos',
    payments_one: '{count} pago',
    payments_other: '{count} pagos',
    skipped_one: '{count} fila no mueve dinero, así que se queda fuera.',
    skipped_other: '{count} filas no mueven dinero, así que se quedan fuera.',
    balances: 'Saldos después de importar',
    balancesIn: 'En {currency}',
    now: 'ahora {amount}',
    converted:
      'Las filas en {currency} se convierten a {group} al cambio de cada día al guardarse, así que pueden variar unos céntimos.',
    totalsMatch: 'Cuadra con el saldo total del archivo.',
    totalsMismatch:
      'No cuadra con la línea de saldo total del archivo. Comprueba que nadie la haya editado.',
    rateMissing:
      'Potluck no tiene cambio de {from} a {to} antes del {date}, así que las filas en {from} aún no se pueden convertir.',
    rows: 'Filas',
    more_one: 'y {count} fila más',
    more_other: 'y {count} filas más',
    rowPaid: 'Pagó {names}',
    rowPayment: '{from} pagó a {to}',
    rowRefund: 'Reembolso a {names}',
    submit_one: 'Importar {count} fila',
    submit_other: 'Importar {count} filas',
    importing: 'Importando',
    done_one: 'Se importó {count} fila en {group}.',
    done_other: 'Se importaron {count} filas en {group}.',
    rowFailed: 'Fila {line}: {message}',
    fixFirst: 'Arregla esto primero',
    archived: 'Este grupo está archivado. Desarchívalo para importar en él.',
    issues: {
      not_csv:
        'Eso no es un archivo CSV. Guárdalo como CSV (separado por comas) e inténtalo otra vez.',
      unknown_format:
        'No sabemos qué es este archivo. Usa una exportación de Splitwise o una hoja de cálculo de Potluck.',
      no_rows: 'No hay gastos en este archivo.',
      too_many_rows:
        'Una importación admite como mucho {detail} filas. Divide el archivo e impórtalo por partes.',
      bad_date: 'No podemos leer la fecha "{detail}" (usa AAAA-MM-DD).',
      bad_amount: '"{detail}" no es un importe.',
      bad_currency: '"{detail}" no es un código de moneda.',
      unbalanced: 'Los importes de esta fila no cuadran.',
      friend_export:
        'Esta exportación es de lo que compartes con una persona, así que deja fuera a otras. Exporta el grupo entero.',
      unmapped: 'Elige quién es {detail}.',
    },
  },
  summary: {
    expenses_one: '{count} gasto',
    expenses_other: '{count} gastos',
    payments_one: '{count} pago',
    payments_other: '{count} pagos',
    both: '{expenses} y {payments}',
  },
} as const satisfies Translation<typeof en>

/** For `es/money.ts` `activity`: `expenses.imported` and `self.expenses.imported`. */
export const activity = {
  expenses: { imported: '{actor} importó {summary}' },
  self: { expenses: { imported: 'Importaste {summary}' } },
} as const
