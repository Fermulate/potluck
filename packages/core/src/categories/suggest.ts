import { isCategory, type CategoryId } from './categories'

/**
 * Words and short phrases that give an expense's category away, in the languages Potluck speaks.
 * Written naturally; they go through the same `normalizeDescription` as what people type.
 */
const KEYWORDS: Partial<Record<CategoryId, readonly string[]>> = {
  food: ['food', 'meal', 'comida', 'repas', 'essen', 'refeicao'],
  dining_out: [
    'restaurant',
    'restaurants',
    'restaurante',
    'dinner',
    'lunch',
    'brunch',
    'breakfast',
    'bistro',
    'diner',
    'sushi',
    'pizza',
    'burger',
    'burgers',
    'tapas',
    'ramen',
    'tacos',
    'cena',
    'almuerzo',
    'desayuno',
    'dejeuner',
    'abendessen',
    'mittagessen',
    'fruhstuck',
    'jantar',
    'almoco',
  ],
  takeout: [
    'takeout',
    'takeaway',
    'take away',
    'delivery',
    'doordash',
    'uber eats',
    'ubereats',
    'deliveroo',
    'grubhub',
    'glovo',
    'just eat',
    'lieferando',
    'ifood',
    'rappi',
  ],
  coffee: ['coffee', 'cafe', 'starbucks', 'espresso', 'latte', 'cappuccino', 'kaffee', 'cafezinho'],
  snacks: [
    'snack',
    'snacks',
    'ice cream',
    'gelato',
    'bakery',
    'panaderia',
    'boulangerie',
    'backerei',
    'padaria',
  ],
  groceries: [
    'groceries',
    'grocery',
    'supermarket',
    'supermercado',
    'supermarche',
    'supermarkt',
    'costco',
    'aldi',
    'lidl',
    'safeway',
    'kroger',
    'tesco',
    'sainsburys',
    "sainsbury's",
    'mercadona',
    'carrefour',
    'rewe',
    'edeka',
    'trader joes',
    "trader joe's",
    'whole foods',
    'faire les courses',
    'einkauf',
    'mercado',
  ],
  drinks: ['drinks', 'beer', 'beers', 'cocktails', 'pub', 'cerveza', 'biere', 'bier', 'cerveja'],
  bar: ['bar', 'bars'],
  wine_spirits: [
    'wine',
    'vino',
    'vin',
    'wein',
    'vinho',
    'liquor',
    'booze',
    'spirits',
    'whisky',
    'vodka',
  ],
  transport: ['transport', 'transportation', 'transporte'],
  taxi: [
    'uber',
    'lyft',
    'taxi',
    'taxis',
    'cab',
    'bolt',
    'grabcar',
    'grab ride',
    'didi',
    'cabify',
    'free now',
  ],
  public_transit: [
    'train',
    'bus',
    'metro',
    'subway',
    'tube',
    'tram',
    'transit',
    'amtrak',
    'eurostar',
    'renfe',
    'sncf',
    'bahn',
    'tren',
    'trem',
    'onibus',
    'autobus',
  ],
  flights: [
    'flight',
    'flights',
    'airline',
    'airfare',
    'plane',
    'ryanair',
    'easyjet',
    'vueling',
    'lufthansa',
    'vuelo',
    'vol',
    'flug',
    'voo',
    'avion',
    'aviao',
  ],
  car_rental: ['car rental', 'rental car', 'rent a car', 'hertz', 'avis', 'sixt', 'europcar'],
  parking: [
    'parking',
    'parkhaus',
    'estacionamiento',
    'aparcamiento',
    'stationnement',
    'estacionamento',
  ],
  tolls: ['toll', 'tolls', 'peaje', 'peage', 'maut', 'pedagio'],
  bike: ['bike', 'bicycle', 'citi bike', 'velib', 'bicicleta'],
  ferry: ['ferry', 'boat', 'ferri'],
  gas: [
    'gas',
    'fuel',
    'petrol',
    'gasoline',
    'diesel',
    'gasolina',
    'essence',
    'benzin',
    'tanken',
    'combustivel',
  ],
  ev_charging: ['ev charging', 'charging', 'supercharger', 'chargepoint'],
  lodging: ['lodging', 'accommodation', 'alojamiento', 'logement', 'unterkunft', 'hospedagem'],
  hotel: ['hotel', 'hotels', 'motel', 'hostel', 'hostal', 'inn', 'booking'],
  vacation_rental: [
    'airbnb',
    'vrbo',
    'cabin',
    'villa',
    'chalet',
    'holiday rental',
    'vacation rental',
  ],
  camping: ['camping', 'campsite', 'tent', 'acampada'],
  tickets: ['ticket', 'tickets', 'entradas', 'billets', 'karten', 'ingressos'],
  entertainment: ['entertainment', 'netflix', 'spotify', 'streaming', 'museum', 'museo', 'musee'],
  movies: ['movie', 'movies', 'cinema', 'film', 'cine', 'kino'],
  concerts: ['concert', 'concerts', 'gig', 'festival', 'concierto', 'konzert', 'show'],
  games: ['game', 'games', 'bowling', 'arcade', 'escape room', 'minigolf', 'karaoke'],
  sports: [
    'football',
    'soccer',
    'tennis',
    'golf',
    'ski',
    'skiing',
    'ski pass',
    'lift pass',
    'padel',
    'climbing',
  ],
  rent: ['rent', 'alquiler', 'loyer', 'miete', 'aluguel'],
  mortgage: ['mortgage', 'hipoteca', 'hypotheque', 'hypothek'],
  utilities: ['utilities', 'utility', 'bills'],
  electricity: [
    'electricity',
    'electric',
    'electric bill',
    'power bill',
    'luz',
    'electricite',
    'strom',
    'eletricidade',
  ],
  heating: ['heating', 'gas bill', 'calefaccion', 'chauffage', 'heizung', 'aquecimento'],
  water: ['water', 'water bill', 'agua', 'eau', 'wasser'],
  internet: ['internet', 'wifi', 'broadband', 'fibre', 'fiber', 'comcast', 'xfinity'],
  phone: ['phone', 'phone bill', 'cell phone', 'mobile', 'telefono', 'telephone', 'handy'],
  trash: ['trash', 'garbage', 'rubbish', 'recycling', 'basura'],
  cleaning: ['cleaning', 'cleaner', 'cleaners', 'limpieza', 'menage', 'putzen', 'faxina'],
  home: ['home', 'house', 'casa', 'maison', 'haushalt'],
  furniture: ['furniture', 'ikea', 'sofa', 'couch', 'mattress', 'muebles', 'meubles', 'moveis'],
  household_supplies: [
    'household',
    'household supplies',
    'toilet paper',
    'paper towels',
    'detergent',
    'soap',
    'supplies',
  ],
  maintenance: [
    'repair',
    'repairs',
    'plumber',
    'electrician',
    'maintenance',
    'handyman',
    'reparacion',
    'reparation',
    'reparatur',
  ],
  electronics: ['electronics', 'tv', 'laptop', 'headphones', 'charger'],
  pets: ['pet', 'pets', 'vet', 'dog food', 'cat food', 'mascota', 'veterinario'],
  services: ['laundry', 'dry cleaning', 'locksmith'],
  shopping: ['shopping', 'amazon', 'mall', 'store', 'shop', 'tienda'],
  clothing: ['clothes', 'clothing', 'shoes', 'zara', 'h&m', 'uniqlo', 'ropa', 'vetements', 'roupa'],
  gifts: ['gift', 'gifts', 'present', 'birthday', 'regalo', 'cadeau', 'geschenk', 'presente'],
  health: ['health', 'salud', 'sante', 'saude'],
  medical: ['doctor', 'hospital', 'dentist', 'clinic', 'medico', 'medecin', 'arzt'],
  pharmacy: [
    'pharmacy',
    'drugstore',
    'medicine',
    'cvs',
    'walgreens',
    'farmacia',
    'pharmacie',
    'apotheke',
  ],
  fitness: ['gym', 'fitness', 'yoga', 'pilates', 'crossfit', 'gimnasio'],
  childcare: ['childcare', 'babysitter', 'daycare', 'nanny', 'guarderia', 'creche', 'kita'],
  education: [
    'tuition',
    'school',
    'course',
    'courses',
    'textbook',
    'textbooks',
    'escuela',
    'ecole',
    'schule',
  ],
  insurance: ['insurance', 'seguro', 'assurance', 'versicherung'],
  taxes: ['tax', 'taxes', 'impuestos', 'impots', 'steuer', 'impostos'],
}

/**
 * Lowercase, accents and punctuation dropped, single spaces: "Café Nero!" and "cafe  nero"
 * read the same. Used for both what people type and the keyword list.
 */
export function normalizeDescription(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const LOOKUP = new Map<string, CategoryId>()
let LONGEST = 1
for (const [category, words] of Object.entries(KEYWORDS)) {
  for (const word of words ?? []) {
    const key = normalizeDescription(word)
    if (!LOOKUP.has(key)) LOOKUP.set(key, category as CategoryId)
    LONGEST = Math.max(LONGEST, key.split(' ').length)
  }
}

/** Short words that say nothing about what was bought ("the", "for", "de"). */
const FILLER = new Set(['the', 'and', 'for', 'with', 'from', 'para', 'pour', 'avec', 'mit', 'und'])

/** Category from the keyword list: the longest phrase wins, then the earliest. */
function fromKeywords(words: readonly string[]): CategoryId | null {
  for (let size = Math.min(LONGEST, words.length); size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const hit = LOOKUP.get(words.slice(i, i + size).join(' '))
      if (hit) return hit
    }
  }
  return null
}

export interface CategoryHistoryEntry {
  description: string
  category: string | null
}

export interface CategorySuggestion {
  category: CategoryId
  /** `history`: an earlier expense in this group; `keyword`: Potluck's own word list. */
  from: 'history' | 'keyword'
}

/**
 * Suggests a category for an expense description.
 *
 * 1. The same description used before in the group (`history`, newest first) suggests that
 *    expense's category, so a group's own habits win over the word list.
 * 2. Otherwise a word or phrase from the keyword list ("Uber" is a taxi, under Transport).
 * 3. Otherwise a distinctive word (4 letters or more) shared with an earlier description.
 *
 * Returns null when nothing fits. Categories outside the core list are ignored.
 */
export function suggestCategory(
  description: string,
  history: readonly CategoryHistoryEntry[] = [],
): CategorySuggestion | null {
  const text = normalizeDescription(description)
  if (!text) return null
  const known = history.filter((h): h is { description: string; category: CategoryId } =>
    isCategory(h.category),
  )

  const same = known.find((h) => normalizeDescription(h.description) === text)
  if (same) return { category: same.category, from: 'history' }

  const words = text.split(' ')
  const keyword = fromKeywords(words)
  if (keyword) return { category: keyword, from: 'keyword' }

  const distinctive = words.filter((w) => w.length >= 4 && !FILLER.has(w))
  if (distinctive.length === 0) return null
  const shared = known.find((h) =>
    normalizeDescription(h.description)
      .split(' ')
      .some((w) => distinctive.includes(w)),
  )
  return shared ? { category: shared.category, from: 'history' } : null
}
