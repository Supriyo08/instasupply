/**
 * Catalogue and store contracts (§1.3) with their reference tables (§1.5): the 25 category tiles, the
 * store specialties and the search vocabulary.
 *
 * A product is one store's listing (D2): suppliers own their prices and stock, the server owns
 * `reserved` and the denormalized fields. Money is whole cents; weight and size are per sell unit
 * (§1.1).
 */
import type { CityId, MarketId } from './market';
import type { LatLng, TimestampLike } from './types';

// ---------- categories ----------

/** The 25 app tiles, in display order (D15). The security rules repeat this list (§6.3). */
export type CategoryId =
  | 'adhesives'
  | 'fasteners'
  | 'tools'
  | 'safety'
  | 'wood'
  | 'drywall'
  | 'insulation'
  | 'masonry'
  | 'roofing'
  | 'electrical'
  | 'plumbing'
  | 'hvac'
  | 'doors'
  | 'windows'
  | 'glass'
  | 'hardware'
  | 'paint'
  | 'flooring'
  | 'wall-decor'
  | 'cleaning'
  | 'storage'
  | 'bath'
  | 'kitchen'
  | 'appliances'
  | 'outdoors';

/** Size of one sell unit in cm, at most 1 decimal each; `l` is the longest side (§1.1). */
export interface DimsCm {
  l: number;
  w: number;
  h: number;
}

export interface Category {
  id: CategoryId;
  name: string;
  /** Illustration key in @instasupply/art: `cat-<id>`. */
  iconKey: string;
  /** Pastel background of the tile. */
  tint: string;
  /** Stronger colour that goes with the tint. */
  accent: string;
  sortOrder: number;
  /** Shipping weight used when a supplier row has none (the product gets `shipEstimated: true`). */
  defaultWeightKg: number;
  /** Shipping size used when a supplier row has none. */
  defaultDimsCm: DimsCm;
  /** Trade words customers search by; indexed with every product of the category (§5.6). */
  synonyms: string[];
  active: boolean;
}

/**
 * The nine Big Cart pastels the tiles cycle through (§1.5). The spec names the tints only; each accent
 * is the colour the apps already pair with that pastel.
 */
const TILE_COLOURS = [
  { tint: '#E6F2EA', accent: '#28B446' },
  { tint: '#FFE9E5', accent: '#F55A4E' },
  { tint: '#FFF6E3', accent: '#F7B500' },
  { tint: '#F3EFFA', accent: '#A259FF' },
  { tint: '#DCF4F5', accent: '#0CC0DF' },
  { tint: '#FFE8F2', accent: '#FF5A9E' },
  { tint: '#D2EFFF', accent: '#2F9BEA' },
  { tint: '#FDEFD5', accent: '#E8AD41' },
  { tint: '#E8F5DA', accent: '#6CC51D' },
] as const;

type CategoryRow = [
  name: string,
  defaultWeightKg: number,
  lwhCm: [number, number, number],
  synonyms: string[],
];

/**
 * The category table of §1.5: name, default kg, default cm (l × w × h), search synonyms. The row order
 * is the tile order, so it also fixes `CATEGORY_IDS` and every `sortOrder`.
 */
const CATEGORY_ROWS: Record<CategoryId, CategoryRow> = {
  adhesives: ['Adhesives', 0.5, [25, 6, 6], ['glue', 'caulk', 'sealant', 'cement']],
  fasteners: ['Fasteners', 1, [15, 10, 8], ['screws', 'nails', 'anchors', 'hangers']],
  tools: ['Tools', 1, [40, 15, 8], ['tool', 'drill', 'saw']],
  safety: ['Safety', 0.3, [30, 25, 10], ['ppe', 'gloves', 'hard hat']],
  wood: ['Wood', 10, [244, 9, 4], ['lumber', 'studs', 'sheathing', 'plywood', 'osb']],
  drywall: ['Drywall', 25, [244, 122, 1.3], ['gypsum', 'sheetrock', 'gyprock', 'mud']],
  insulation: ['Insulation', 9, [120, 40, 40], ['batts', 'foam', 'soundproofing', 'vapour']],
  masonry: ['Masonry', 30, [60, 40, 12], ['concrete', 'cement', 'mortar', 'block', 'rebar', 'steel']],
  roofing: ['Roofing', 25, [100, 33, 13], ['shingles', 'underlayment', 'waterproofing']],
  electrical: ['Electrical', 1, [30, 20, 10], ['wire', 'cable', 'romex', 'lighting']],
  plumbing: ['Plumbing', 2, [120, 10, 10], ['pipe', 'pex', 'copper', 'abs']],
  hvac: ['HVAC', 2, [60, 20, 20], ['duct', 'furnace', 'ventilation']],
  doors: ['Doors', 30, [210, 90, 10], ['door', 'prehung']],
  windows: ['Windows', 15, [100, 70, 10], ['window']],
  glass: ['Glass', 10, [90, 60, 3], ['mirror', 'glass']],
  hardware: ['Hardware', 0.5, [20, 10, 5], ['hinges', 'bolts', 'pulls']],
  paint: ['Paint', 5, [20, 20, 25], ['primer', 'roller', 'tape']],
  flooring: ['Flooring', 15, [122, 20, 10], ['vinyl', 'laminate', 'tile']],
  'wall-decor': ['Wall Decor', 3, [244, 10, 2], ['trim', 'baseboard', 'casing', 'millwork', 'panel']],
  cleaning: ['Cleaning', 1, [40, 30, 10], ['bags', 'vacuum']],
  storage: ['Storage', 15, [100, 50, 15], ['shelving', 'toolbox']],
  bath: ['Bath', 15, [80, 50, 40], ['toilet', 'shower', 'vanity']],
  kitchen: ['Kitchen', 10, [80, 60, 40], ['cabinets', 'faucet', 'sink']],
  appliances: ['Appliances', 50, [150, 60, 60], ['range', 'water heater']],
  outdoors: ['Outdoors', 20, [122, 61, 5], ['decking', 'fencing', 'landscaping', 'pavers', 'siding']],
};

/** Every category id in tile order; the position (from 1) is the category's `sortOrder` (§1.5). */
export const CATEGORY_IDS: readonly CategoryId[] = Object.keys(CATEGORY_ROWS) as CategoryId[];

/**
 * The 25 categories of §1.5, the starting content of `categories/{id}`. They carry the shipping defaults
 * and the synonyms that go into a product's search terms.
 */
export const CATEGORIES: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORY_IDS.map((id, index): [CategoryId, Category] => {
    const [name, defaultWeightKg, [l, w, h], synonyms] = CATEGORY_ROWS[id];
    const colours = TILE_COLOURS[index % TILE_COLOURS.length] ?? TILE_COLOURS[0];
    return [
      id,
      {
        id,
        name,
        iconKey: `cat-${id}`,
        tint: colours.tint,
        accent: colours.accent,
        sortOrder: index + 1,
        defaultWeightKg,
        defaultDimsCm: { l, w, h },
        synonyms,
        active: true,
      },
    ];
  }),
) as Record<CategoryId, Category>;

// ---------- products ----------

export type SellUnit =
  | 'each'
  | 'pair'
  | 'sheet'
  | 'length'
  | 'bundle'
  | 'box'
  | 'bag'
  | 'pail'
  | 'can'
  | 'tube'
  | 'roll'
  | 'pack'
  | 'kit';

/** Every sell unit, in the order the product form lists them. The security rules repeat this list (§6.3). */
export const SELL_UNITS: readonly SellUnit[] = [
  'each',
  'pair',
  'sheet',
  'length',
  'bundle',
  'box',
  'bag',
  'pail',
  'can',
  'tube',
  'roll',
  'pack',
  'kit',
];

export type ProductBadge = 'new' | 'bestseller' | 'deal';

/** One store's listing, `products/{storeId}--{skuSlug}` (D2). */
export interface Product {
  id: string;
  storeId: string;
  sku: string;
  name: string;
  brand: string | null;
  categoryId: CategoryId;
  /** Groups the same item across stores ("2 stores · from $4.79"). Staff only. */
  familyKey: string | null;
  unit: SellUnit;
  /** Trade size as text, e.g. "2 in × 4 in × 8 ft". */
  size: string | null;
  description: string;
  priceCents: number;
  /** Strike-through price; above `priceCents` when set. */
  compareAtCents: number | null;
  /** What the supplier counts on the shelf (D3). */
  stockOnHand: number;
  /** Held by open orders. Server only (D3). */
  reserved: number;
  maxPerOrder: number | null;
  /** Per sell unit, at most 3 decimals. */
  weightKg: number;
  /** Per sell unit. */
  dimsCm: DimsCm;
  /** True when weight or size was filled from the category defaults. */
  shipEstimated: boolean;
  active: boolean;
  /** Staff only. */
  featured: boolean;
  /** Staff only. */
  badge: ProductBadge | null;
  /** Illustration key in @instasupply/art; the category icon is the fallback. */
  imageKey: string | null;
  /** Uploaded photo, `productPhotos/{storeId}/…`. */
  imagePath: string | null;
  /** Server only: download URL of `imagePath` (§5.6). Clients never type a URL. */
  imageUrl: string | null;
  /** Server only: `active` and the store is live, so a store that is not live drops out of every query. */
  listed: boolean;
  /** Server only: copy of the store name (§1.4). */
  storeName: string;
  /** Server only: copy of the store status (§1.4). */
  storeStatus: StoreStatus;
  /** Server only: prefix keys for search, built by `buildSearchTerms`. */
  searchTerms: string[];
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  updatedBy: string;
}

/** What can still be sold: stock on hand minus what open orders hold. Computed, never stored (D3). */
export const availableQty = (p: Pick<Product, 'stockOnHand' | 'reserved'>) =>
  Math.max(0, p.stockOnHand - p.reserved);

/** Below this many available units the apps show "Only 4 left". */
export const LOW_STOCK_THRESHOLD = 10;

/**
 * The "14 % off" badge next to a strike-through price, as a whole percent rounded half-up; null when
 * there is no higher compare-at price. It never throws: a supplier's odd numbers must not break a
 * product card.
 */
export function discountPercent(product: Pick<Product, 'priceCents' | 'compareAtCents'>): number | null {
  const { priceCents, compareAtCents } = product;
  if (compareAtCents == null || !Number.isFinite(compareAtCents) || !Number.isFinite(priceCents)) return null;
  if (priceCents < 0 || compareAtCents <= priceCents) return null;
  return Math.floor((200 * (compareAtCents - priceCents) + compareAtCents) / (2 * compareAtCents));
}

// ---------- stores ----------

/** Only a `live` store can be ordered from; the others show a badge such as "Coming soon" (§2.8). */
export type StoreStatus = 'onboarding' | 'coming_soon' | 'live' | 'closed';

export type StoreSpecialty =
  | 'lumber_building'
  | 'drywall_paint'
  | 'electrical'
  | 'plumbing'
  | 'hvac_refrigeration'
  | 'fasteners_hardware'
  | 'glass_mirrors'
  | 'doors_trims'
  | 'kitchen_cabinets'
  | 'bath_fixtures'
  | 'designer_lighting'
  | 'insulation_soundproofing'
  | 'masonry_roofing';

/**
 * Specialty names in the wording of instasupply.ca (§1.5). `masonry_roofing` is ours: no card on the
 * site uses it, but roofing and masonry need a store.
 */
export const STORE_SPECIALTY_LABELS: Record<StoreSpecialty, string> = {
  lumber_building: 'Lumber & Building Materials',
  drywall_paint: 'Drywall & Paint',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac_refrigeration: 'HVAC & Refrigeration',
  fasteners_hardware: 'Fasteners & Hardware',
  glass_mirrors: 'Glass & Mirrors',
  doors_trims: 'Doors, Trims & Baseboards',
  kitchen_cabinets: 'Kitchen Cabinets',
  bath_fixtures: 'Bath & Plumbing Fixtures',
  designer_lighting: 'Designer Lighting',
  insulation_soundproofing: 'Soundproofing & Insulation',
  masonry_roofing: 'Masonry & Roofing',
};

/**
 * Storefront illustration for each specialty (§12.7): there are ten `store-*` drawings for thirteen
 * specialties, so a few share one.
 */
export const STORE_SPECIALTY_ART: Record<StoreSpecialty, string> = {
  lumber_building: 'store-lumber',
  drywall_paint: 'store-drywall-paint',
  electrical: 'store-electrical',
  plumbing: 'store-plumbing',
  hvac_refrigeration: 'store-hvac',
  fasteners_hardware: 'store-hardware',
  glass_mirrors: 'store-doors-windows',
  doors_trims: 'store-doors-windows',
  kitchen_cabinets: 'store-kitchen-bath',
  bath_fixtures: 'store-kitchen-bath',
  designer_lighting: 'store-electrical',
  insulation_soundproofing: 'store-roofing-insulation',
  masonry_roofing: 'store-masonry',
};

/**
 * The name a store goes by in a sentence: its first word, "Kestrel" for "Kestrel Lumber Yard", as the
 * spec writes it in reasons, promises and notifications ("Kestrel and Bluestone are closed Sunday" §4.4,
 * "Bluestone · by 1:40 pm" §4.3). `Store` has only the full name, so every sentence uses this one rule.
 * A name that starts with an article keeps all its words; an empty one reads "The store".
 */
export function shortStoreName(name: string): string {
  const full = typeof name === 'string' ? name.trim() : '';
  const first = full.split(/\s+/)[0] ?? '';
  if (first === '' || /^(the|a|an)$/i.test(first)) return full || 'The store';
  return first;
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** The week as store hours list it, Monday first. */
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** One opening interval in Toronto time, `HH:MM`; `close` is after `open`, never overnight (§4.2). */
export interface DayHours {
  open: string;
  close: string;
}

export interface PostalAddress {
  line1: string;
  line2: string | null;
  city: string;
  province: 'ON';
  /** `A1A 1A1`; null for a new build that only has a pin. */
  postalCode: string | null;
}

/** Public storefront, `stores/{storeId}`. Written only by functions (§1.2). */
export interface Store {
  /** Slug such as `kestrel-lumber`; never contains `--`, which separates the product id (§1.1). */
  id: string;
  name: string;
  specialty: StoreSpecialty;
  categoryIds: CategoryId[];
  description: string;
  marketId: MarketId;
  cityId: CityId;
  /** Neighbourhood shown on cards, e.g. "Etobicoke". */
  areaLabel: string;
  address: PostalAddress;
  location: LatLng;
  phone: string;
  email: string | null;
  /** Set by the server from a `storePhotos/{storeId}/` upload. */
  photoUrl: string | null;
  /** `store-*` illustration (§12.7). */
  imageKey: string | null;
  /** One interval per weekday in Toronto time; null means closed that day. */
  hours: Record<Weekday, DayHours | null>;
  /** Extra closed dates, `YYYY-MM-DD`, at most 60. */
  closures: string[];
  fulfilment: {
    delivery: boolean;
    pickup: boolean;
    /** 1–60 road km. Staff only. */
    deliveryRadiusKm: number;
  };
  /** Minutes the store needs to get an order ready, 5–240. */
  prepMinutes: number;
  /** `HH:MM`: orders after this are not delivered the same day. */
  sameDayCutoff: string;
  /** Admin only. */
  status: StoreStatus;
  /** False while the store has paused new orders; it stays listed. */
  acceptingOrders: boolean;
  /** Average of the store reviews, 1 decimal; kept by a trigger. */
  rating: number;
  ratingCount: number;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/** `stores/{storeId}/private/settings`: read by staff and the store owner only. */
export interface StorePrivateSettings {
  /** InstaSupply's share of the store's sales, in basis points. Default 1000 (10 %). */
  commissionBps: number;
  payoutAccount: { provider: 'test' | 'stripe'; accountRef: string; label: string } | null;
  ordersEmail: string | null;
  /** NANP mobile that gets the new-order and reminder SMS: suppliers have no app. */
  alertPhone: string | null;
  /** Gate codes and dock directions; copied into deliveries for the driver, never public. */
  loadingNotes: string | null;
  onboarding: { catalogReady: boolean; payoutsReady: boolean; trained: boolean };
  notes: string | null;
}

/** `stores/{storeId}/reviews/{storeOrderId}`: one rating per completed store order (D12). */
export interface StoreReview {
  storeId: string;
  storeOrderId: string;
  customerId: string;
  /** First name and last initial, e.g. "Dana W.". */
  authorName: string;
  /** Whole number, 1–5. */
  rating: number;
  /** At most 1000 characters. */
  text: string;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

// ---------- search ----------

/**
 * The chips of the "Suggest a store" form: the 24 names instasupply.ca shows under "What do you buy
 * most?", verbatim (§1.5, D15).
 */
export const SUGGEST_STORE_INTERESTS: readonly string[] = [
  'Lumber',
  'Drywall',
  'Electrical',
  'Plumbing',
  'Hardware',
  'Paint',
  'Concrete & Masonry',
  'Insulation',
  'Tools & Safety',
  'HVAC',
  'Roofing',
  'Flooring & Tile',
  'Doors & Windows',
  'Kitchen & Bath',
  'Cabinets & Millwork',
  'Lighting',
  'Fasteners',
  'Glass & Mirrors',
  'Decking & Fencing',
  'Siding & Exteriors',
  'Landscaping',
  'Steel & Rebar',
  'Waterproofing',
  'Appliances',
];

/**
 * Words of the site's 24 names that the synonym column of §1.5 does not already carry. Every other
 * word of those names is a category name or one of its synonyms.
 */
const SITE_NAME_WORDS: Record<string, readonly CategoryId[]> = {
  mirrors: ['glass'],
  exteriors: ['outdoors'],
};

/**
 * What a customer may type instead of a category name, lower-case, mapped to the ids of the categories
 * it stands for: every synonym of §1.5 plus the remaining words of the site's names (D15). "cement"
 * is both an adhesive and masonry, so the values are lists.
 *
 * The object has no prototype, so looking up whatever a customer typed ("constructor") is safe.
 */
export const SEARCH_SYNONYMS: Record<string, string[]> = (() => {
  const byWord = Object.create(null) as Record<string, string[]>;
  const add = (word: string, id: CategoryId) => {
    const ids = byWord[word] ?? [];
    if (!ids.includes(id)) ids.push(id);
    byWord[word] = ids;
  };
  for (const id of CATEGORY_IDS) {
    for (const word of CATEGORIES[id].synonyms) add(word, id);
  }
  for (const [word, ids] of Object.entries(SITE_NAME_WORDS)) {
    for (const id of ids) add(word, id);
  }
  return byWord;
})();

// ---------- product ids (§1.1) ----------

/**
 * The SKU part of a product id (§1.1): the SKU in lower case with every run of characters other than
 * a–z and 0–9 turned into one dash. `KLY-SPF248` → `kly-spf248`. Spaces around the SKU are not part
 * of it, so an untrimmed import cell gives the same slug as the saved SKU.
 */
export function skuSlug(sku: string): string {
  return sku
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

/**
 * The document id of a store's listing, `{storeId}--{skuSlug}` (D2). The portal, the catalogue import
 * and the seed all create products, and the security rules read the store back from the id, so they
 * must build it the same way. `('kestrel-lumber', 'KLY-SPF248')` → `kestrel-lumber--kly-spf248`.
 */
export function productIdFor(storeId: string, sku: string): string {
  return `${storeId}--${skuSlug(sku)}`;
}

// ---------- search keys (§5.6) ----------
// A product stores prefix keys of its words in `searchTerms`; a search asks for the products that
// hold the key of what was typed. Both sides read text through the same steps below, so "2×4×8",
// "2 x 4 x 8" and "2x4x8" are one key, and so are "studs" and "stud", "décor" and "decor".

const MIN_KEY_LENGTH = 2;
/** Keys stop here, so one long word cannot fill a product's term list. */
const MAX_KEY_LENGTH = 15;

/** Fraction characters that price lists paste in, as people type them. */
const FRACTION_GLYPHS: Record<string, string> = {
  '¼': '1/4',
  '½': '1/2',
  '¾': '3/4',
  '⅓': '1/3',
  '⅔': '2/3',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
};
const FRACTION_GLYPH = new RegExp(`(\\d)?([${Object.keys(FRACTION_GLYPHS).join('')}])`, 'g');

/** Inch and foot marks after a number, straight or typographic: `2"`, `8'`. */
const INCH_OR_FOOT_MARK = String.raw`["'\u201d\u2019\u2033\u2032]`;

/**
 * A size written with spaces, units or inch and foot marks between its numbers: `2 x 4`, `2" x 4"`,
 * `2 in x 4 in x 8 ft`, `48 mm x 55 m`, `8ftx4ft`. The match ends right before the next number.
 */
const SPACED_SIZE = new RegExp(
  String.raw`(\d)\s*(?:(?:inches|inch|in|feet|foot|ft|mm|cm|m)\.?|${INCH_OR_FOOT_MARK})?\s*x\s*(?=\d)`,
  'g',
);

/** What follows the first digits of a fraction, a mixed number or a decimal: `/2`, `-1/2`, `.5`. */
const NUMBER_TAIL = String.raw`(?:-\d+/\d+|(?:[./]\d+)+)`;
/** A number as the trade writes it: `8`, `1/2`, `14/2`, `94.5`, `2-1/2`. */
const NUMBER = String.raw`\d+${NUMBER_TAIL}?`;
const SIZE = new RegExp(`^${NUMBER}(?:x${NUMBER})+$`);
/**
 * One word of a text. Tried in this order: a size (`2x4x8`, `3/8x4`), a number with a tail (`1/2`,
 * `94.5`), a plain word (`10m`, `drywall`). So `1/2in` is `1/2` and `in`, while `10m` stays whole.
 */
const SEARCH_TOKEN = new RegExp(String.raw`${NUMBER}(?:x${NUMBER})+|\d+${NUMBER_TAIL}|[a-z0-9]+`, 'g');
const WHOLE_AND_FRACTION = /^\d+-(\d+\/\d+)$/;

/**
 * "décor" → "decor". Phone keyboards correct "decor" to "décor", and the Wall Decor tile is spelled
 * without the accent: both must be the same word.
 */
const withoutAccents = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** The words, numbers and sizes of a text, in lower case, without accents and in one spelling. */
function searchTokens(text: string): string[] {
  // A listing without a brand or a size hands over null when its caller is not type-checked: no words.
  if (typeof text !== 'string') return [];
  const plain = withoutAccents(text.toLowerCase())
    // "½" → "1/2", and "2½" → "2-1/2" so that it stays one number.
    .replace(FRACTION_GLYPH, (_match, digit: string | undefined, glyph: string) => {
      const fraction = FRACTION_GLYPHS[glyph] ?? '';
      return digit === undefined ? ` ${fraction}` : `${digit}-${fraction}`;
    })
    .replace(/\u00d7/g, 'x') // the multiplication sign of "2×4×8"
    .replace(/[\u2044\u2215]/g, '/') // the fraction slash and the division slash
    .replace(SPACED_SIZE, '$1x');
  return plain.match(SEARCH_TOKEN) ?? [];
}

/**
 * "2-1/2" → "1/2". The whole number in front of a fraction is dropped, because people also write it
 * "2 1/2", where the 2 is too short to be a key of its own: both spellings must find the same products.
 */
const withoutWholeNumber = (token: string): string => WHOLE_AND_FRACTION.exec(token)?.[1] ?? token;

/**
 * "studs" → "stud", "boxes" → "box", "batteries" → "battery". Words under four letters and words in
 * -ss, -us and -is ("abs", "glass", "plus") stay as they are. The result does not have to be good
 * English: the same rule runs on the product and on what was typed, so the two always meet.
 */
function singular(word: string): string {
  if (word.length < 4 || !/^[a-z]+$/.test(word)) return word;
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(?:ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (/(?:ss|us|is)$/.test(word)) return word;
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

/** The key a typed token is searched by. */
const typedKey = (token: string): string =>
  (SIZE.test(token) ? token : singular(withoutWholeNumber(token))).slice(0, MAX_KEY_LENGTH);

/**
 * Prefix keys stored in `product.searchTerms`, so one `array-contains` query can search every store.
 * `onProductWritten` passes the brand, SKU, size, category name with its synonyms and the family key
 * as `extra` (§5.6); the synonyms are what lets "sheetrock" find drywall and "romex" find NMD90 cable.
 *
 * Every word gives its prefixes from 2 to 15 characters, so a search works while it is being typed:
 * "2x4x8" → `2x`, `2x4`, `2x4x`, `2x4x8`. Fractions and metric sizes are words too (`1/2`, `10m`). A
 * plural is also stored in its singular, and a size also under each of its parts (`3/8x4` → `3/8`).
 * The order is that of first appearance, so the same product always gives the same list.
 */
export function buildSearchTerms(name: string, extra: readonly string[]): string[] {
  const terms = new Set<string>();
  const addPrefixes = (key: string) => {
    for (let length = MIN_KEY_LENGTH; length <= Math.min(key.length, MAX_KEY_LENGTH); length += 1) {
      terms.add(key.slice(0, length));
    }
  };
  // Each text on its own: joined, the end of one could run into the start of the next ("… 2" + "x 4 …").
  for (const text of [name, ...extra]) {
    for (const token of searchTokens(text)) {
      if (SIZE.test(token)) {
        addPrefixes(token);
        for (const part of token.split('x')) addPrefixes(withoutWholeNumber(part));
      } else {
        const word = withoutWholeNumber(token);
        addPrefixes(word);
        addPrefixes(singular(word));
      }
    }
  }
  return [...terms];
}

/**
 * Every key of what the customer typed, the longest first; equal lengths keep the typed order. A
 * product matches the whole search when its `searchTerms` hold all of them. "2×4×8 SPF studs" →
 * `['2x4x8', 'stud', 'spf']`.
 */
export function searchKeysFor(text: string): string[] {
  const keys: string[] = [];
  for (const token of searchTokens(text)) {
    const key = typedKey(token);
    if (key.length >= MIN_KEY_LENGTH && !keys.includes(key)) keys.push(key);
  }
  // The typed position breaks ties, so the order does not depend on the engine's sort.
  return keys
    .map((key, position) => ({ key, position }))
    .sort((a, b) => b.key.length - a.key.length || a.position - b.position)
    .map((entry) => entry.key);
}

/**
 * The key to query `searchTerms` with for what the customer typed, or null when it is too short. It
 * is the longest word, the one that narrows the most; the other words (`searchKeysFor`) filter the
 * answer.
 */
export function searchKeyFor(text: string): string | null {
  return searchKeysFor(text)[0] ?? null;
}
