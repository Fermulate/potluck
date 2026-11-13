import { describe, expect, it } from 'vitest'
import {
  MAX_RECEIPT_ITEMS,
  parseReceipt,
  parseReceiptAmount,
  receiptDateOrder,
  type ReceiptItem,
} from '../index'

// Text as an OCR engine hands it back: uneven spacing, stray marks, lines that are not items.

const US_DINER = `JOE'S DINER
123 Main Street
Springfield, IL 62701
Tel (217) 555-0142
Server: Maria   Table 12
11/08/2026 7:42 PM
2 Cheeseburger        25.00
Caesar Salad          11.50
1 Iced Tea             3.25
Fries                  4.75
SUBTOTAL              44.50
Sales Tax 8.25%        3.67
TIP                    8.00
TOTAL                 56.17
VISA ****4821         56.17
THANK YOU!`

const UK_PUB = `THE RED LION
High Street, Oxford OX1 4AA
VAT No. 123 4567 89
Date: 07/11/2026  Time: 21:15
Pint Lager        £5.20
Pint Lager        £5.20
Fish & Chips     £14.95
Sticky Toffee Pud £6.50
TOTAL            £31.85
Card             £31.85
VAT @ 20% included £5.31`

const DE_SUPERMARKET = `REWE Markt GmbH
Hauptstr. 5
10115 Berlin
UID Nr.: DE123456789
EUR
BIO VOLLMILCH 1,19 B
BROT ROGGEN 2,49 B
APFEL BRAEBURN
  2 x 1,29  2,58 B
PFAND 0,25 A
LEERGUT -0,25 A
--------------------------------
SUMME EUR 6,26
Geg. BAR EUR 10,00
Rückgeld BAR EUR 3,74
Steuer %   Netto  Steuer  Brutto
B= 7,0%    5,85   0,41    6,26
13.11.2026 18:04 Bon-Nr.:4211`

const FR_CAFE = `Café de Flore
172 Bd Saint-Germain
75006 Paris
Table 4 - Couverts 2
Le 12/11/2026 à 13:05
2 Café crème          9,80 €
1 Croque-monsieur    14,50 €
1 Eau minérale        6,00 €
Total TTC            30,30 €
dont TVA 10%          2,75 €
CB                   30,30 €
Merci de votre visite`

const ES_RESTAURANT = `RESTAURANTE CASA LUCIO
C/ Cava Baja 35, Madrid
NIF B-12345678
Fecha: 9 de noviembre de 2026
Mesa 7
Huevos rotos x2       28,00
Jamón ibérico         24,50
Vino tinto (botella)  22,00
Pan                    2,50
SUBTOTAL              77,00
Propina                5,00
TOTAL                 82,00
IVA incluido (10%)     7,00
Tarjeta               82,00`

const BR_BAKERY = `PADARIA REAL
CNPJ 12.345.678/0001-90
Data: 10/11/2026
Pão de queijo 3 x 4,50   13,50
Café expresso            6,00
Suco de laranja          9,90
Valor total          R$ 29,40
Dinheiro             R$ 50,00
Troco                R$ 20,60`

const JP_KONBINI = `FamilyMart Shibuya
2026/11/05 08:12
Onigiri Salmon     ¥150
Green Tea          ¥140
Coffee M           ¥180
Subtotal           ¥470
Tax (8%)            ¥37
Total              ¥507
Cash             ¥1,000
Change             ¥493`

const items = (list: ReceiptItem[]) => list.map((i) => [i.description, i.amountCents, i.quantity])

describe('parseReceipt', () => {
  it('reads a US diner bill with tax and tip on top', () => {
    const scan = parseReceipt(US_DINER, { currency: 'USD', dateOrder: 'mdy' })
    expect(scan).toEqual({
      merchant: "Joe's Diner",
      date: '2026-11-08',
      currency: null,
      totalCents: 5617,
      subtotalCents: 4450,
      taxCents: 367,
      tipCents: 800,
      discountCents: null,
      items: [
        { description: 'Cheeseburger', amountCents: 2500, quantity: 2 },
        { description: 'Caesar Salad', amountCents: 1150, quantity: 1 },
        { description: 'Iced Tea', amountCents: 325, quantity: 1 },
        { description: 'Fries', amountCents: 475, quantity: 1 },
      ],
    })
  })

  it('reads a UK pub tab where VAT is already in the prices', () => {
    const scan = parseReceipt(UK_PUB, { currency: 'EUR' })
    expect(scan.currency).toBe('GBP')
    expect(scan.merchant).toBe('The Red Lion')
    expect(scan.date).toBe('2026-11-07')
    expect(scan.totalCents).toBe(3185)
    expect(scan.taxCents).toBeNull()
    expect(items(scan.items)).toEqual([
      ['Pint Lager', 520, 1],
      ['Pint Lager', 520, 1],
      ['Fish & Chips', 1495, 1],
      ['Sticky Toffee Pud', 650, 1],
    ])
  })

  it('reads a German till roll: decimal commas, class letters, a quantity line and a deposit back', () => {
    const scan = parseReceipt(DE_SUPERMARKET, { currency: 'EUR' })
    expect(scan.currency).toBe('EUR')
    expect(scan.merchant).toBe('REWE Markt GmbH')
    expect(scan.date).toBe('2026-11-13')
    expect(scan.totalCents).toBe(626)
    expect(scan.discountCents).toBe(25)
    expect(scan.taxCents).toBeNull()
    expect(items(scan.items)).toEqual([
      ['Bio Vollmilch', 119, 1],
      ['Brot Roggen', 249, 1],
      ['Apfel Braeburn', 258, 2],
      ['Pfand', 25, 1],
    ])
  })

  it('reads a French café bill with the total TTC and the VAT it includes', () => {
    const scan = parseReceipt(FR_CAFE, { currency: 'EUR', dateOrder: 'mdy' })
    expect(scan.merchant).toBe('Café de Flore')
    // A euro receipt is day first even for a viewer whose own dates are month first.
    expect(scan.date).toBe('2026-11-12')
    expect(scan.totalCents).toBe(3030)
    expect(scan.taxCents).toBeNull()
    expect(items(scan.items)).toEqual([
      ['Café crème', 980, 2],
      ['Croque-monsieur', 1450, 1],
      ['Eau minérale', 600, 1],
    ])
  })

  it('reads a Spanish bill with a written date, a tip and IVA included', () => {
    const scan = parseReceipt(ES_RESTAURANT, { currency: 'EUR' })
    expect(scan.currency).toBeNull()
    expect(scan.merchant).toBe('Restaurante Casa Lucio')
    expect(scan.date).toBe('2026-11-09')
    expect(scan.subtotalCents).toBe(7700)
    expect(scan.tipCents).toBe(500)
    expect(scan.taxCents).toBeNull()
    expect(scan.totalCents).toBe(8200)
    expect(items(scan.items)).toEqual([
      ['Huevos rotos', 2800, 2],
      ['Jamón ibérico', 2450, 1],
      ['Vino tinto (botella)', 2200, 1],
      ['Pan', 250, 1],
    ])
  })

  it('reads a Brazilian bakery receipt in reais with a unit price on the line', () => {
    const scan = parseReceipt(BR_BAKERY, { currency: 'EUR' })
    expect(scan.currency).toBe('BRL')
    expect(scan.merchant).toBe('Padaria Real')
    expect(scan.date).toBe('2026-11-10')
    expect(scan.totalCents).toBe(2940)
    expect(items(scan.items)).toEqual([
      ['Pão de queijo', 1350, 3],
      ['Café expresso', 600, 1],
      ['Suco de laranja', 990, 1],
    ])
  })

  it('reads yen without decimals and consumption tax on top', () => {
    const scan = parseReceipt(JP_KONBINI, { currency: 'USD', dateOrder: 'mdy' })
    expect(scan.currency).toBe('JPY')
    expect(scan.merchant).toBe('FamilyMart Shibuya')
    expect(scan.date).toBe('2026-11-05')
    expect(scan.totalCents).toBe(507)
    expect(scan.subtotalCents).toBe(470)
    expect(scan.taxCents).toBe(37)
    expect(items(scan.items)).toEqual([
      ['Onigiri Salmon', 150, 1],
      ['Green Tea', 140, 1],
      ['Coffee M', 180, 1],
    ])
  })

  it('falls back to the largest amount when no line says total', () => {
    const scan = parseReceipt('Corner Shop\nMilk 1.20\nBread 2.10\n3.30', { currency: 'USD' })
    expect(scan.totalCents).toBe(330)
    expect(items(scan.items)).toEqual([
      ['Milk', 120, 1],
      ['Bread', 210, 1],
    ])
  })

  it('keeps a discount that makes the bill add up, and drops a tip that is not in the total', () => {
    const scan = parseReceipt(
      'Taco Stand\nTacos 3 @ 3.00 9.00\nHorchata 4.00\nCoupon -2.00\nTip\nGratuity 1.50\nTotal 11.00',
      { currency: 'USD' },
    )
    expect(scan.discountCents).toBe(200)
    expect(scan.tipCents).toBeNull()
    expect(scan.totalCents).toBe(1100)
    expect(items(scan.items)).toEqual([
      ['Tacos', 900, 3],
      ['Horchata', 400, 1],
    ])
  })

  it('drops tax, tip and discount together when only the items match the total', () => {
    const scan = parseReceipt(
      'Shop\nA thing 5.00\nAnother 5.00\nTax 0.80\nService 1.00\nDiscount 0.50\nTotal 10.00',
      { currency: 'USD' },
    )
    expect([scan.taxCents, scan.tipCents, scan.discountCents]).toEqual([null, null, null])
  })

  it('drops tax and tip but keeps a discount that explains the total', () => {
    const scan = parseReceipt(
      'Shop\nA thing 5.00\nAnother 5.00\nVAT 1.60\nTips 2.00\nSavings 1.00\nTotal 9.00',
      { currency: 'USD' },
    )
    expect([scan.taxCents, scan.tipCents, scan.discountCents]).toEqual([null, null, 100])
  })

  it('drops a discount that is not in the total', () => {
    const scan = parseReceipt('Shop\nA thing 5.00\nSales tax 0.40\nYou saved 1.00\nTotal 5.40', {
      currency: 'USD',
    })
    expect([scan.taxCents, scan.discountCents]).toEqual([40, null])
  })

  it('leaves everything as read when nothing explains the total', () => {
    const scan = parseReceipt('Shop\nA thing 5.00\nTax 1.00\nTotal 9.99', { currency: 'USD' })
    expect(scan.taxCents).toBe(100)
  })

  it('takes the biggest of several total lines', () => {
    const scan = parseReceipt('Bar\nBeer 6.00\nTotal 6.00\nGrand total incl. tip 7.00', {
      currency: 'USD',
    })
    expect(scan.totalCents).toBe(700)
  })

  it('returns nothing much for text that is not a receipt', () => {
    expect(parseReceipt('', { currency: 'USD' })).toEqual({
      merchant: null,
      date: null,
      currency: null,
      totalCents: null,
      subtotalCents: null,
      taxCents: null,
      tipCents: null,
      discountCents: null,
      items: [],
    })
    const scan = parseReceipt('12\n****\nhello there', { currency: 'USD' })
    expect(scan.totalCents).toBeNull()
    expect(scan.merchant).toBe('hello there')
  })

  it('caps a runaway item list', () => {
    const lines = Array.from({ length: MAX_RECEIPT_ITEMS + 10 }, (_, i) => `Thing ${i} 1.00`)
    const scan = parseReceipt(['Big Shop', ...lines].join('\n'), { currency: 'USD' })
    expect(scan.items).toHaveLength(MAX_RECEIPT_ITEMS)
  })

  it('skips header lines that are not a shop name', () => {
    const scan = parseReceipt(
      'RECEIPT\nwww.example.com\n42 Elm Road\n12/12/2026\nBlue Bottle\nLatte 5.50',
      {
        currency: 'USD',
      },
    )
    expect(scan.merchant).toBe('Blue Bottle')
  })

  it('uses a currency code over a lone symbol, and the group dollar for a bare $', () => {
    expect(parseReceipt('Total CHF 12.50', { currency: 'EUR' }).currency).toBe('CHF')
    expect(parseReceipt('Total $12.50', { currency: 'CAD' }).currency).toBe('CAD')
    expect(parseReceipt('Total $12.50', { currency: 'EUR' }).currency).toBe('USD')
    expect(parseReceipt('Total ₹120.00\nTip ₩100', { currency: 'EUR' }).currency).toBe('INR')
  })

  it('ignores yen-like numbers that carry no symbol', () => {
    const scan = parseReceipt('Shop\nTable 12\nRamen ¥980\nTotal ¥980', { currency: 'JPY' })
    expect(items(scan.items)).toEqual([['Ramen', 980, 1]])
  })
})

describe('dates', () => {
  const dateOf = (line: string, extra: Partial<Parameters<typeof parseReceipt>[1]> = {}) =>
    parseReceipt(line, { currency: 'EUR', ...extra }).date

  it('reads ISO, numeric and written dates', () => {
    expect(dateOf('2026-03-04')).toBe('2026-03-04')
    expect(dateOf('03/04/2026')).toBe('2026-04-03')
    expect(dateOf('03/04/2026', { dateOrder: 'mdy' })).toBe('2026-03-04')
    expect(dateOf('13/04/26', { dateOrder: 'mdy' })).toBe('2026-04-13')
    expect(dateOf('03.04.2026', { dateOrder: 'mdy' })).toBe('2026-04-03')
    expect(dateOf('Nov 12, 2026')).toBe('2026-11-12')
    expect(dateOf('12th November 2026')).toBe('2026-11-12')
    expect(dateOf('12. Dezember 2026')).toBe('2026-12-12')
    expect(dateOf('1 juin 2026')).toBe('2026-06-01')
    expect(dateOf('14 juillet 2026')).toBe('2026-07-14')
    expect(dateOf('3. Juli 2026')).toBe('2026-07-03')
    expect(dateOf('4 août 2026')).toBe('2026-08-04')
  })

  it('skips impossible, future and very old dates', () => {
    expect(dateOf('31/02/2026')).toBeNull()
    expect(dateOf('2026-13-01')).toBeNull()
    expect(dateOf('12 foo 2026')).toBeNull()
    expect(dateOf('20/11/2026', { today: '2026-11-13' })).toBeNull()
    expect(dateOf('20/11/2006', { today: '2026-11-13' })).toBeNull()
    expect(dateOf('20/11/2026\n01/11/2026', { today: '2026-11-13' })).toBe('2026-11-01')
  })
})

describe('parseReceiptAmount', () => {
  it.each([
    ['12.50', 'USD', 1250],
    ['12,50', 'EUR', 1250],
    ['1,234.56', 'USD', 123456],
    ['1.234,56', 'EUR', 123456],
    ["1'234.50", 'CHF', 123450],
    ['12,5', 'EUR', 1250],
    ['1,280', 'JPY', 1280],
    ['1.234.567', 'EUR', 123456700],
    ['12.345', 'KWD', 12345],
    ['7', 'USD', 700],
  ])('%s in %s is %i', (raw, currency, cents) => {
    expect(parseReceiptAmount(raw, currency)).toBe(cents)
  })

  it.each([['1.2345'], ['abc'], ['.50'], ['12.'], ['99999999999999999']])(
    '%s is not an amount',
    (raw) => {
      expect(parseReceiptAmount(raw, 'USD')).toBeNull()
    },
  )
})

describe('receiptDateOrder', () => {
  it('is month first for US English and dollars, day first elsewhere', () => {
    expect(receiptDateOrder('USD')).toBe('mdy')
    expect(receiptDateOrder('EUR')).toBe('dmy')
    expect(receiptDateOrder('USD', 'en-GB')).toBe('dmy')
    expect(receiptDateOrder('EUR', 'en-US')).toBe('mdy')
  })
})
