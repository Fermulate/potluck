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
      totalDerived: false,
      itemsMatch: 'exact',
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

  it('adds up the items when no line says total', () => {
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
      totalDerived: false,
      itemsMatch: null,
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

// A REWE till roll as the scanner reads it: unit price under an item, a card line, the VAT table.
const DE_REWE = `REWE Markt GmbH
Hauptstr. 12, 10115 Berlin
EUR
BIO VOLLMILCH 1,19 A
BROETCHEN 1,80 A
  2 Stk x 0,90
KAESE GOUDA 3,49 A
BANANEN 1,65 A
WEIN ROT 6,99 B
SUMME EUR 15,12
Geg. Karte EUR 15,12
Steuer % Netto Steuer Brutto
A= 7,0% 7,61 0,52 8,13
B= 19,0% 5,87 1,12 6,99
10.11.2026 18:03 Bon-Nr 4711`

describe('lines that are not items', () => {
  it('reads a unit price line as the count of the item above it', () => {
    const scan = parseReceipt(DE_REWE, { currency: 'EUR' })
    expect(items(scan.items)).toEqual([
      ['Bio Vollmilch', 119, 1],
      ['Broetchen', 180, 2],
      ['Kaese Gouda', 349, 1],
      ['Bananen', 165, 1],
      ['Wein Rot', 699, 1],
    ])
    expect(scan.totalCents).toBe(1512)
    expect(scan.taxCents).toBeNull()
    expect(scan.itemsMatch).toBe('exact')
  })

  it.each([
    [
      'English',
      'Bagels 4.50\n3 @ 1.50\nCoffee 2.00\nTotal 6.50',
      'USD',
      [
        ['Bagels', 450, 3],
        ['Coffee', 200, 1],
      ],
    ],
    [
      'French',
      'Croissant 3,60\n3 x 1,20\nThé 2,50\nTotal 6,10',
      'EUR',
      [
        ['Croissant', 360, 3],
        ['Thé', 250, 1],
      ],
    ],
    [
      'Spanish',
      'Cañas 6,00\n3 uds x 2,00\nPan 1,00\nTotal 7,00',
      'EUR',
      [
        ['Cañas', 600, 3],
        ['Pan', 100, 1],
      ],
    ],
    [
      'Portuguese',
      'Pão 2,40\n4 un x 0,60\nLeite 1,10\nTotal 3,50',
      'EUR',
      [
        ['Pão', 240, 4],
        ['Leite', 110, 1],
      ],
    ],
    [
      'a count lost to the scan',
      'Broetchen 1,80\n> stk x 0,90\nTotal 1,80',
      'EUR',
      [['Broetchen', 180, 2]],
    ],
    [
      'a unit price above its item',
      'Shop\n2 x 0,90\nBroetchen 1,80\nTotal 1,80',
      'EUR',
      [['Broetchen', 180, 2]],
    ],
  ])('skips unit price lines (%s)', (_, text, currency, expected) => {
    const scan = parseReceipt(text, { currency })
    expect(items(scan.items)).toEqual(expected)
    expect(scan.itemsMatch).toBe('exact')
  })

  it.each([
    ['Card 7.00'],
    ['VISA **** 4421 7.00'],
    ['Cash 10.00'],
    ['Change 3.00'],
    ['Geg. Karte EUR 7,00'],
    ['Geg. BAR EUR 10,00'],
    ['Bar 10,00'],
    ['Espèces 10,00'],
    ['Carte bancaire 7,00'],
    ['Efectivo 10,00'],
    ['Tarjeta 7,00'],
    ['Dinheiro 10,00'],
    ['Troco 3,00'],
    ['Kartenzahlung 7,00'],
  ])('never takes a payment line for an item: %s', (line) => {
    const scan = parseReceipt(`Shop\nTea 3.00\nCake 4.00\n${line}`, { currency: 'USD' })
    expect(scan.items.map((i) => i.description)).toEqual(['Tea', 'Cake'])
  })

  it.each([
    ['German', 'A= 7,0% 7,61 0,52 8,13'],
    ['German, no equals sign', 'B 19,0% 5,87 1,12 6,99'],
    ['French', 'TVA 10% 24,55 2,45 27,00'],
    ['Spanish', 'IVA 21% 10,00 2,10 12,10'],
    ['Portuguese', 'IVA 23% 8,13 1,87 10,00'],
  ])('skips a VAT table row (%s)', (_, row) => {
    const scan = parseReceipt(`Shop\nTea 3,00\nCake 4,00\n${row}\nTotal 7,00`, { currency: 'EUR' })
    expect(scan.items.map((i) => i.description)).toEqual(['Tea', 'Cake'])
    expect(scan.taxCents).toBeNull()
    expect(scan.itemsMatch).toBe('exact')
  })

  it('keeps a tax line whose rate has decimals', () => {
    const scan = parseReceipt('Shop\nTea 3.00\nSales Tax 8.25% 0.25\nTotal 3.25', {
      currency: 'USD',
    })
    expect(scan.taxCents).toBe(25)
  })
})

describe('scan noise', () => {
  it('keeps rule lines and smudges off item names', () => {
    const scan = parseReceipt(
      'Pub\n| Pint Lager £5.40\n> Crisps £1.60\n_ Scampi_ £13.00\nTOTAL £20.00',
      { currency: 'GBP' },
    )
    expect(scan.items.map((i) => i.description)).toEqual(['Pint Lager', 'Crisps', 'Scampi'])
  })

  it('reads a blurred 0 in a day as the 0 it was', () => {
    // The UK pub photo: "07/11/2026" came back from the reader as "97/11/2026".
    expect(parseReceipt('97/11/2026 21:14', { currency: 'GBP' }).date).toBe('2026-11-07')
    expect(parseReceipt('86/11/2026', { currency: 'GBP' }).date).toBe('2026-11-06')
    expect(parseReceipt('45/11/2026', { currency: 'GBP' }).date).toBeNull()
  })
})

describe('do the items match the total', () => {
  const match = (text: string) => parseReceipt(text, { currency: 'USD' }).itemsMatch

  it('says exact, close (within 5%), off, or cannot tell', () => {
    expect(match('Shop\nTea 5.00\nCake 5.00\nTotal 10.00')).toBe('exact')
    expect(match('Shop\nTea 5.00\nCake 4.60\nTotal 10.00')).toBe('close')
    expect(match('Shop\nTea 5.00\nCake 1.00\nTotal 10.00')).toBe('off')
    expect(match('Shop\nTotal 10.00')).toBeNull()
  })

  it('trusts the card line when it matches the items and the total line was misread', () => {
    const scan = parseReceipt('Shop\nRice 2.99\nGarlic 0.99\nTOTAL $4.08\nVISA $3.98', {
      currency: 'USD',
    })
    expect(scan.totalCents).toBe(398)
    expect(scan.itemsMatch).toBe('exact')
    // A cash line that matches nothing changes nothing.
    const cash = parseReceipt('Shop\nRice 2.99\nTOTAL 4.08\nCash 10.00', { currency: 'USD' })
    expect(cash.totalCents).toBe(408)
  })

  it('takes neither the cash handed over nor the dearest item for the bill when no line says total', () => {
    // 14.00 + 5.00 is 19.00; 20.00 was handed over and 1.00 came back, so 19.00 was paid.
    const tendered = parseReceipt(
      ['Diner', 'Burger 14.00', 'Fries 5.00', 'CASH 20.00', 'CHANGE 1.00'].join('\n'),
      {
        currency: 'USD',
      },
    )
    expect(tendered.totalCents).toBe(1900)
    expect([tendered.totalDerived, tendered.itemsMatch]).toEqual([false, 'exact'])
    expect(items(tendered.items)).toEqual([
      ['Burger', 1400, 1],
      ['Fries', 500, 1],
    ])
    // A card line for the same amount confirms it too.
    const card = parseReceipt(['Diner', 'Burger 14.00', 'Fries 5.00', 'VISA 19.00'].join('\n'), {
      currency: 'USD',
    })
    expect([card.totalCents, card.totalDerived]).toEqual([1900, false])
    // Cash handed over with no change line confirms nothing.
    const cashOnly = parseReceipt(
      ['Diner', 'Burger 14.00', 'Fries 5.00', 'CASH 20.00'].join('\n'),
      {
        currency: 'USD',
      },
    )
    expect([cashOnly.totalCents, cashOnly.totalDerived]).toEqual([1900, true])
  })

  it('never calls a total it worked out a match, so the reader looks again', () => {
    // A first reading that caught only the burger: 14.00 is not the bill, and nothing says so.
    const partial = parseReceipt(['Diner', 'Burger 14.00'].join('\n'), { currency: 'USD' })
    expect(partial.totalCents).toBe(1400)
    expect(partial.totalDerived).toBe(true)
    expect(partial.itemsMatch).toBe('unconfirmed')
    const read = parseReceipt(['Diner', 'Burger 14.00', 'Fries 5.00', 'TOTAL 19.00'].join('\n'), {
      currency: 'USD',
    })
    expect([read.totalDerived, read.itemsMatch]).toEqual([false, 'exact'])
  })

  it.each([
    // The receipts' own TOTAL lines: 31.85 and 30.30 are what the card paid, 82.00 includes a tip.
    ['a UK pub, VAT included', UK_PUB, 3185, false],
    ['a French café, dont TVA', FR_CAFE, 3030, false],
    ['a Spanish bill, IVA incluido and a tip', ES_RESTAURANT, 7700, true],
  ])(
    'takes the subtotal or the items when the total line is lost, never a payment line: %s',
    (_, receipt, total, derived) => {
      const lines = receipt.split('\n')
      const lost = lines.filter((line) => !/^total/i.test(line))
      expect(lost).toHaveLength(lines.length - 1)
      const scan = parseReceipt(lost.join('\n'), { currency: 'EUR' })
      expect(scan.totalCents).toBe(total)
      expect([scan.taxCents, scan.tipCents]).toEqual([null, null])
      expect(scan.totalDerived).toBe(derived)
    },
  )

  it.each([
    ['Paiement CB 30,30', ['Cafe creme 3,30', 'Croissant 27,00'], 3030],
    ['Pago con tarjeta 30,30', ['Cafe 3,30', 'Bocadillo 27,00'], 3030],
    ['Amount Tendered 20.00\nChange 1.00', ['Burger 14.00', 'Fries 5.00'], 1900],
  ])('reads "%s" as a payment that confirms the items', (payment, lines, total) => {
    const scan = parseReceipt(['Shop', ...lines, payment].join('\n'), { currency: 'EUR' })
    expect(items(scan.items).map(([name]) => name)).toEqual(
      lines.map((l) => l.replace(/ [\d,.]+$/, '')),
    )
    expect([scan.totalCents, scan.totalDerived, scan.itemsMatch]).toEqual([total, false, 'exact'])
  })

  it('takes a card line a few cents under a printed total for the bill', () => {
    // Cafe creme 3,30 and Croissant 27,00 make 30,30, what the card paid; TOTAL 30,50 was misread.
    const scan = parseReceipt(
      ['Cafe', 'Cafe creme 3,30', 'Croissant 27,00', 'Total 30,50', 'Paiement CB 30,30'].join('\n'),
      {
        currency: 'EUR',
      },
    )
    expect([scan.totalCents, scan.itemsMatch]).toEqual([3030, 'exact'])
  })

  it('never adds tax to a subtotal it takes for the total, and says when the items are off it', () => {
    // Burger 14.00 and Fries 5.00 make the 19.00 subtotal; the fries were not read.
    const scan = parseReceipt(['Diner', 'Burger 14.00', 'Subtotal 19.00', 'Tax 1.52'].join('\n'), {
      currency: 'USD',
    })
    expect(scan.totalCents).toBe(1900)
    expect(scan.taxCents).toBeNull()
    expect([scan.totalDerived, scan.itemsMatch]).toEqual([true, 'off'])
  })

  it('leaves the total empty with only payment lines to go on', () => {
    expect(
      parseReceipt(['Shop', 'Cash 10.00', 'Change 1.00'].join('\n'), { currency: 'USD' })
        .totalCents,
    ).toBeNull()
    expect(
      parseReceipt(['Shop', 'Cash 10.00'].join('\n'), { currency: 'USD' }).totalCents,
    ).toBeNull()
  })

  it('never takes a card line that does not match the items for the bill', () => {
    // "Birthday Card" reads as a payment line, so only the shampoo is an item before it.
    const cvs = parseReceipt(
      ['CVS', 'Shampoo 6.49', 'Birthday Card 4.99', 'Toothpaste 3.29', 'VISA 14.77'].join('\n'),
      {
        currency: 'USD',
      },
    )
    expect(items(cvs.items)).toEqual([['Shampoo', 649, 1]])
    expect([cvs.totalCents, cvs.totalDerived, cvs.itemsMatch]).toEqual([649, true, 'unconfirmed'])
  })

  it('never adds up a bill paid in parts or a card balance', () => {
    // 12.00 + 7.00 is 19.00: 5.00 on a gift card that has 20.00 left, and 14.00 on VISA.
    const scan = parseReceipt(
      [
        'Shop',
        'Shirt 12.00',
        'Socks 7.00',
        'GIFT CARD 5.00',
        'VISA 14.00',
        'GIFT CARD BALANCE 20.00',
      ].join('\n'),
      { currency: 'USD' },
    )
    expect(scan.totalCents).toBe(1900)
    expect(scan.totalDerived).toBe(true)
    expect(items(scan.items)).toEqual([
      ['Shirt', 1200, 1],
      ['Socks', 700, 1],
    ])
  })

  it('never drops an item as dearer than a total it worked out', () => {
    // A subtotal misread as 25.00 and no total line: the 30.00 steak is still an item.
    const scan = parseReceipt(['Grill', 'Steak 30.00', 'Salad 8.00', 'Subtotal 25.00'].join('\n'), {
      currency: 'USD',
    })
    expect(scan.items.map((i) => i.description)).toEqual(['Steak', 'Salad'])
    expect([scan.totalDerived, scan.itemsMatch]).toEqual([true, 'off'])
  })

  it('drops a line dearer than the whole bill', () => {
    const scan = parseReceipt('Shop\nGarlic 81.89\nRice 2.99\nTotal 76.50', { currency: 'USD' })
    expect(scan.items.map((i) => i.description)).toEqual(['Rice'])
    expect(scan.itemsMatch).toBe('off')
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
