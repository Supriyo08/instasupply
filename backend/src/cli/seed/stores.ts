/**
 * The 14 stores of MARKETPLACE §11.3, with their private settings and the seed reviews that give the
 * ratings shown there. Everything is fictional: business names are invented, addresses are intersections,
 * phones are in the reserved 555-0100…0199 range.
 *
 * Hours are Mon–Fri / Sat / Sun in Toronto time. Live stores accept orders; Glassmoor is also closed on
 * 2026-11-27 (stock-take). Every store's `imageKey` is its specialty's `store-*` art (§12.7) and its
 * `alertPhone` is its own 555 number, so the new-order SMS shows up in the dev outbox.
 */
import {
  MARKET_ID,
  STORE_SPECIALTY_ART,
  type CategoryId,
  type CityId,
  type DayHours,
  type LatLng,
  type Store,
  type StorePrivateSettings,
  type StoreSpecialty,
  type StoreStatus,
  type Weekday,
} from '@instasupply/shared';

/** The public store document as `createStore` takes it: no id, rating, timestamps or photo. */
export type SeedStoreDoc = Omit<
  Store,
  'id' | 'rating' | 'ratingCount' | 'createdAt' | 'updatedAt' | 'photoUrl'
>;

export interface SeedReview {
  /** `seed-{storeId}-{n}` (docs/PLATFORM.md §3.2 `store_reviews`). */
  id: string;
  authorName: string;
  rating: number;
  text: string;
  /** How long before the seed run the review was written. */
  daysAgo: number;
}

export interface SeedStore {
  id: string;
  doc: SeedStoreDoc;
  settings: StorePrivateSettings;
  reviews: readonly SeedReview[];
}

type Interval = [open: string, close: string] | null;

function week(weekdays: Interval, sat: Interval, sun: Interval): Record<Weekday, DayHours | null> {
  const day = (value: Interval): DayHours | null => (value ? { open: value[0], close: value[1] } : null);
  return {
    mon: day(weekdays),
    tue: day(weekdays),
    wed: day(weekdays),
    thu: day(weekdays),
    fri: day(weekdays),
    sat: day(sat),
    sun: day(sun),
  };
}

interface StoreRow {
  id: string;
  name: string;
  specialty: StoreSpecialty;
  categoryIds: CategoryId[];
  description: string;
  line1: string;
  city: string;
  postalCode: string;
  cityId: CityId;
  areaLabel: string;
  location: LatLng;
  phone: string;
  status: StoreStatus;
  hours: Record<Weekday, DayHours | null>;
  closures?: string[];
  prepMinutes: number;
  sameDayCutoff: string;
  deliveryRadiusKm: number;
  commissionBps: number;
  ordersEmail: string | null;
  loadingNotes: string | null;
  /** Ratings of the seed reviews; their average is the rating of §11.3. */
  ratings: { authorName: string; rating: number; text: string }[];
}

/** Defaults for the stores that are not live yet ("—" in §11.3): they pass validateStore unchanged. */
const NOT_LIVE = {
  hours: week(null, null, null),
  prepMinutes: 20,
  sameDayCutoff: '15:00',
  deliveryRadiusKm: 40,
  commissionBps: 1000,
  ordersEmail: null,
  loadingNotes: null,
} satisfies Partial<StoreRow>;

const ROWS: readonly StoreRow[] = [
  {
    id: 'kestrel-lumber',
    name: 'Kestrel Lumber Yard',
    specialty: 'lumber_building',
    categoryIds: ['wood', 'outdoors', 'masonry', 'adhesives', 'fasteners'],
    description:
      'Full-service lumber yard in Etobicoke: framing lumber, sheet goods, engineered joists and concrete, loaded by forklift.',
    line1: 'Dixon Rd & Martin Grove Rd',
    city: 'Toronto',
    postalCode: 'M9W 5L4',
    cityId: 'toronto',
    areaLabel: 'Etobicoke',
    location: { lat: 43.6966, lng: -79.5752 },
    phone: '+14165550120',
    status: 'live',
    hours: week(['06:30', '18:00'], ['07:00', '16:00'], null),
    prepMinutes: 25,
    sameDayCutoff: '15:00',
    deliveryRadiusKm: 45,
    commissionBps: 900,
    ordersEmail: 'kestrel@instasupply.test',
    loadingNotes:
      'Enter the yard from Martin Grove; pull up to bay 2 by the forklift shed and show your PIN.',
    ratings: [
      {
        authorName: 'Priya S.',
        rating: 5,
        text: 'Studs were straight and the order was ready before I got there.',
      },
      { authorName: 'Mike D.', rating: 5, text: 'Forklift loaded my F-150 in five minutes. Great yard.' },
      { authorName: 'Tara L.', rating: 5, text: 'Good OSB, no swollen edges. Will order again.' },
      { authorName: 'Ravi K.', rating: 5, text: 'Fair prices on pressure-treated lumber.' },
      { authorName: 'Jon B.', rating: 4, text: 'Solid yard; one bundle needed restrapping.' },
    ],
  },
  {
    id: 'grainline-building',
    name: 'Grainline Building Centre',
    specialty: 'lumber_building',
    categoryIds: ['wood', 'drywall', 'insulation', 'flooring', 'tools', 'safety', 'cleaning', 'appliances'],
    description:
      'Scarborough building centre with insulation, flooring, jobsite safety gear and the everyday framing basics.',
    line1: 'Kennedy Rd & Ellesmere Rd',
    city: 'Toronto',
    postalCode: 'M1P 2L7',
    cityId: 'toronto',
    areaLabel: 'Scarborough',
    location: { lat: 43.7655, lng: -79.2829 },
    phone: '+14165550121',
    status: 'live',
    hours: week(['07:00', '19:00'], ['08:00', '17:00'], ['10:00', '16:00']),
    prepMinutes: 20,
    sameDayCutoff: '15:00',
    deliveryRadiusKm: 40,
    commissionBps: 900,
    ordersEmail: 'grainline@instasupply.test',
    loadingNotes: 'Contractor pickup door on the Ellesmere side; ring the bell at door 4.',
    ratings: [
      { authorName: 'Leah M.', rating: 5, text: 'Open on Sunday, which saved my weekend job.' },
      { authorName: 'Omar F.', rating: 5, text: 'Batts were dry and well wrapped.' },
      { authorName: 'Chris T.', rating: 4, text: 'Good selection; checkout counter was busy.' },
      { authorName: 'Ana P.', rating: 4, text: 'Vinyl plank arrived as described.' },
    ],
  },
  {
    id: 'bluestone-drywall',
    name: 'Bluestone Drywall & Paint',
    specialty: 'drywall_paint',
    categoryIds: ['drywall', 'paint', 'wall-decor'],
    description:
      'North York drywall and paint specialist: board, compound, corner bead and contractor paint, boom-truck ready.',
    line1: 'Keele St & Finch Ave W',
    city: 'Toronto',
    postalCode: 'M3J 2N6',
    cityId: 'toronto',
    areaLabel: 'North York',
    location: { lat: 43.7709, lng: -79.4912 },
    phone: '+14165550122',
    status: 'live',
    hours: week(['06:30', '17:00'], ['07:00', '13:00'], null),
    prepMinutes: 20,
    sameDayCutoff: '15:00',
    deliveryRadiusKm: 40,
    commissionBps: 1000,
    ordersEmail: 'bluestone@instasupply.test',
    loadingNotes: 'Loading dock at the back off Finch; drywall is staged on carts by the roll-up door.',
    ratings: [
      { authorName: 'Dan R.', rating: 5, text: 'Board was flat and clean, no crushed corners.' },
      { authorName: 'Sofia G.', rating: 5, text: 'They mixed my paint while the sheets were loaded.' },
      { authorName: 'Ken W.', rating: 5, text: 'Best price on 5/8 Type X in the area.' },
      { authorName: 'Ella N.', rating: 5, text: 'Friendly counter staff, quick turnaround.' },
      { authorName: 'Hugo V.', rating: 4, text: 'Good store; parking is tight in the morning.' },
    ],
  },
  {
    id: 'voltway-electrical',
    name: 'Voltway Electrical Supply',
    specialty: 'electrical',
    categoryIds: ['electrical'],
    description: 'Mississauga electrical wholesaler: cable, conduit, devices, breakers and LED lighting.',
    line1: 'Dixie Rd & Eglinton Ave E',
    city: 'Mississauga',
    postalCode: 'L4W 1N6',
    cityId: 'mississauga',
    areaLabel: 'Mississauga',
    location: { lat: 43.6262, lng: -79.6143 },
    phone: '+19055550123',
    status: 'live',
    hours: week(['07:00', '17:30'], ['08:00', '13:00'], null),
    prepMinutes: 15,
    sameDayCutoff: '15:30',
    deliveryRadiusKm: 40,
    commissionBps: 1000,
    ordersEmail: 'voltway@instasupply.test',
    loadingNotes: 'Will-call counter at the front; cable reels come out through the side door.',
    ratings: [
      { authorName: 'Sam C.', rating: 5, text: 'Had every breaker I needed in stock.' },
      { authorName: 'Ivy H.', rating: 5, text: 'Knowledgeable counter staff.' },
      { authorName: 'Ben O.', rating: 4, text: 'Good prices on pot lights.' },
    ],
  },
  {
    id: 'copperline-plumbing',
    name: 'Copperline Plumbing Depot',
    specialty: 'plumbing',
    categoryIds: ['plumbing', 'adhesives', 'bath', 'kitchen', 'appliances'],
    description: 'Concord plumbing depot for copper, PEX, ABS drainage, valves, fixtures and water heaters.',
    line1: 'Keele St & Hwy 7',
    city: 'Vaughan',
    postalCode: 'L4K 4N4',
    cityId: 'vaughan',
    areaLabel: 'Concord',
    location: { lat: 43.801, lng: -79.499 },
    phone: '+19055550124',
    status: 'live',
    hours: week(['07:00', '17:00'], ['08:00', '14:00'], null),
    prepMinutes: 15,
    sameDayCutoff: '15:00',
    deliveryRadiusKm: 40,
    commissionBps: 1000,
    ordersEmail: 'copperline@instasupply.test',
    loadingNotes: 'Pipe racks are outside the north door; park in the marked pickup stalls.',
    ratings: [
      { authorName: 'Nina A.', rating: 5, text: 'Copper Type L in stock when others were out.' },
      { authorName: 'Paul E.', rating: 5, text: 'Pickup was ready on time with the PIN.' },
      { authorName: 'Gus Y.', rating: 5, text: 'Great fittings selection.' },
      { authorName: 'Rita Z.', rating: 4, text: 'Helpful, a little pricey on fixtures.' },
    ],
  },
  {
    id: 'aircrest-hvac',
    name: 'Aircrest HVAC & Refrigeration',
    specialty: 'hvac_refrigeration',
    categoryIds: ['hvac'],
    description: 'Markham HVAC supply for duct, flex, filters and ventilation fans. Weekdays only.',
    line1: 'Denison St & Woodbine Ave',
    city: 'Markham',
    postalCode: 'L3R 9W8',
    cityId: 'markham',
    areaLabel: 'Markham',
    location: { lat: 43.8306, lng: -79.3598 },
    phone: '+19055550125',
    status: 'live',
    hours: week(['07:30', '16:30'], null, null),
    prepMinutes: 20,
    sameDayCutoff: '14:00',
    deliveryRadiusKm: 35,
    commissionBps: 1000,
    ordersEmail: 'aircrest@instasupply.test',
    loadingNotes: 'Unit 3, rear shipping door; ring for the warehouse.',
    ratings: [
      { authorName: 'Leo J.', rating: 5, text: 'Duct pipe was cut to length on request.' },
      { authorName: 'Mia Q.', rating: 4, text: 'Good stock of filters.' },
      { authorName: 'Ray U.', rating: 4, text: 'Closed Saturdays, plan ahead.' },
    ],
  },
  {
    id: 'boltbin-hardware',
    name: 'Boltbin Fasteners & Hardware',
    specialty: 'fasteners_hardware',
    categoryIds: ['fasteners', 'hardware', 'adhesives', 'safety', 'tools', 'storage'],
    description:
      'Brampton fastener house: structural connectors, screws by the pail, anchors, hinges, adhesives and tools.',
    line1: 'Torbram Rd & Steeles Ave E',
    city: 'Brampton',
    postalCode: 'L6T 4X7',
    cityId: 'brampton',
    areaLabel: 'Brampton',
    location: { lat: 43.7262, lng: -79.6885 },
    phone: '+19055550126',
    status: 'live',
    hours: week(['07:00', '18:00'], ['08:00', '15:00'], null),
    prepMinutes: 10,
    sameDayCutoff: '16:00',
    deliveryRadiusKm: 45,
    commissionBps: 1100,
    ordersEmail: 'boltbin@instasupply.test',
    loadingNotes: 'Counter pickup inside the main entrance; boxed orders wait on the left shelf.',
    ratings: [
      { authorName: 'Jay P.', rating: 5, text: 'Joist hangers by the case at a good price.' },
      { authorName: 'Kim L.', rating: 5, text: 'Ready in ten minutes, as promised.' },
      { authorName: 'Tom S.', rating: 5, text: 'Every screw size you can think of.' },
      { authorName: 'Ali M.', rating: 5, text: 'Great service on a rush order.' },
      { authorName: 'Eve C.', rating: 4, text: 'Good selection; the lot gets full at noon.' },
    ],
  },
  {
    id: 'glassmoor-glass',
    name: 'Glassmoor Glass & Mirror',
    specialty: 'glass_mirrors',
    categoryIds: ['glass', 'bath', 'adhesives'],
    description:
      'Leaside glass shop: mirrors, tempered shelves and frameless shower doors, cut and packed to travel.',
    line1: 'Laird Dr & Eglinton Ave E',
    city: 'Toronto',
    postalCode: 'M4G 3V6',
    cityId: 'toronto',
    areaLabel: 'Leaside',
    location: { lat: 43.7102, lng: -79.3615 },
    phone: '+14165550127',
    status: 'live',
    hours: week(['08:00', '17:00'], ['09:00', '13:00'], null),
    closures: ['2026-11-27'],
    prepMinutes: 30,
    sameDayCutoff: '14:00',
    deliveryRadiusKm: 30,
    commissionBps: 1200,
    ordersEmail: 'glassmoor@instasupply.test',
    loadingNotes: 'Glass leaves on A-frames from the Laird Dr door; bring blankets for mirrors.',
    ratings: [
      { authorName: 'Zoe F.', rating: 5, text: 'Mirror was packed beautifully.' },
      { authorName: 'Ian G.', rating: 4, text: 'Nice work, a day later than hoped.' },
      { authorName: 'Una B.', rating: 4, text: 'Good quality tempered shelves.' },
    ],
  },
  {
    id: 'casingcraft-doors',
    name: 'Casingcraft Doors & Trim',
    specialty: 'doors_trims',
    categoryIds: ['wall-decor', 'doors', 'windows', 'kitchen'],
    description:
      'Richmond Hill millwork and door shop: prehung doors, MDF trim, windows and shaker base cabinets.',
    line1: 'West Beaver Creek Rd & Hwy 7',
    city: 'Richmond Hill',
    postalCode: 'L4B 1H1',
    cityId: 'richmond_hill',
    areaLabel: 'Richmond Hill',
    location: { lat: 43.847, lng: -79.399 },
    phone: '+19055550128',
    status: 'live',
    hours: week(['07:30', '17:00'], ['08:00', '14:00'], null),
    prepMinutes: 30,
    sameDayCutoff: '14:30',
    deliveryRadiusKm: 40,
    commissionBps: 1000,
    ordersEmail: 'casingcraft@instasupply.test',
    loadingNotes: 'Doors are staged in the shipping bay at the rear; trim is bundled and labelled.',
    ratings: [
      { authorName: 'Bo K.', rating: 5, text: 'Prehung doors were square and well packed.' },
      { authorName: 'Liv R.', rating: 5, text: 'Baseboard bundles were clean, no dings.' },
      { authorName: 'Max T.', rating: 4, text: 'Good selection of casing profiles.' },
      { authorName: 'Ada W.', rating: 4, text: 'Window took a while to load.' },
    ],
  },
  {
    id: 'slatebridge-masonry',
    name: 'Slatebridge Masonry & Roofing',
    specialty: 'masonry_roofing',
    categoryIds: ['roofing', 'masonry', 'outdoors'],
    description: 'Oakville masonry and roofing yard: shingles, underlayment, mortar, block and patio slabs.',
    line1: 'Speers Rd & Kerr St',
    city: 'Oakville',
    postalCode: 'L6K 2G2',
    cityId: 'oakville',
    areaLabel: 'Oakville',
    location: { lat: 43.4441, lng: -79.688 },
    phone: '+19055550129',
    status: 'live',
    hours: week(['06:30', '17:00'], ['07:00', '13:00'], null),
    prepMinutes: 25,
    sameDayCutoff: '14:00',
    deliveryRadiusKm: 45,
    commissionBps: 900,
    ordersEmail: 'slatebridge@instasupply.test',
    loadingNotes: 'Yard entrance on Speers; shingles load from the covered racks by the scale.',
    ratings: [
      { authorName: 'Ned H.', rating: 5, text: 'Shingles delivered to the roof edge.' },
      { authorName: 'Ola S.', rating: 5, text: 'Mortar was fresh, good bags.' },
      { authorName: 'Vic D.', rating: 4, text: 'Busy yard in the morning, worth it.' },
    ],
  },
  {
    id: 'quietcore-insulation',
    name: 'Quietcore Insulation Supply',
    specialty: 'insulation_soundproofing',
    categoryIds: ['insulation'],
    description: 'Pickering insulation and soundproofing supplier, onboarding with InstaSupply.',
    line1: 'Brock Rd & Bayly St',
    city: 'Pickering',
    postalCode: 'L1W 3H9',
    cityId: 'pickering',
    areaLabel: 'Pickering',
    location: { lat: 43.829, lng: -79.087 },
    phone: '+19055550130',
    status: 'onboarding',
    ...NOT_LIVE,
    ratings: [],
  },
  {
    id: 'tapstone-bath',
    name: 'Tapstone Bath & Fixtures',
    specialty: 'bath_fixtures',
    categoryIds: ['bath'],
    description: 'Cooksville bath and fixture showroom: vanities, toilets, tubs and faucets. Coming soon.',
    line1: 'Hurontario St & Dundas St',
    city: 'Mississauga',
    postalCode: 'L5A 2C1',
    cityId: 'mississauga',
    areaLabel: 'Cooksville',
    location: { lat: 43.589, lng: -79.623 },
    phone: '+19055550132',
    status: 'coming_soon',
    ...NOT_LIVE,
    ratings: [],
  },
  {
    id: 'brightrafter-lighting',
    name: 'Brightrafter Lighting',
    specialty: 'designer_lighting',
    categoryIds: ['electrical'],
    description: 'King West designer lighting studio: pendants, sconces and architectural LED. Coming soon.',
    line1: 'King St W & Bathurst St',
    city: 'Toronto',
    postalCode: 'M5V 1J5',
    cityId: 'toronto',
    areaLabel: 'King West',
    location: { lat: 43.644, lng: -79.403 },
    phone: '+14165550133',
    status: 'coming_soon',
    ...NOT_LIVE,
    ratings: [],
  },
  {
    id: 'cabinetwell-kitchens',
    name: 'Cabinetwell Kitchens',
    specialty: 'kitchen_cabinets',
    categoryIds: ['kitchen'],
    description: 'Concord kitchen cabinet maker: shaker and slab boxes, ready to assemble. Coming soon.',
    line1: 'Jane St & Langstaff Rd',
    city: 'Vaughan',
    postalCode: 'L4K 2M5',
    cityId: 'vaughan',
    areaLabel: 'Concord',
    location: { lat: 43.817, lng: -79.522 },
    phone: '+19055550134',
    status: 'coming_soon',
    ...NOT_LIVE,
    ratings: [],
  },
];

function toSeedStore(row: StoreRow): SeedStore {
  const live = row.status === 'live';
  const doc: SeedStoreDoc = {
    name: row.name,
    specialty: row.specialty,
    categoryIds: row.categoryIds,
    description: row.description,
    marketId: MARKET_ID,
    cityId: row.cityId,
    areaLabel: row.areaLabel,
    address: { line1: row.line1, line2: null, city: row.city, province: 'ON', postalCode: row.postalCode },
    location: row.location,
    phone: row.phone,
    email: null,
    imageKey: STORE_SPECIALTY_ART[row.specialty],
    hours: row.hours,
    closures: row.closures ?? [],
    fulfilment: { delivery: true, pickup: true, deliveryRadiusKm: row.deliveryRadiusKm },
    prepMinutes: row.prepMinutes,
    sameDayCutoff: row.sameDayCutoff,
    status: row.status,
    acceptingOrders: live,
  };
  const settings: StorePrivateSettings = {
    commissionBps: row.commissionBps,
    payoutAccount: live
      ? { provider: 'test', accountRef: `acct_seed_${row.id}`, label: 'Test bank ••0001' }
      : null,
    ordersEmail: row.ordersEmail,
    alertPhone: row.phone,
    loadingNotes: row.loadingNotes,
    onboarding: { catalogReady: live, payoutsReady: live, trained: live },
    notes: live ? null : `Seed store, status ${row.status}.`,
  };
  const reviews = row.ratings.map((review, index): SeedReview => ({
    id: `seed-${row.id}-${index + 1}`,
    authorName: review.authorName,
    rating: review.rating,
    text: review.text,
    daysAgo: 3 + index * 9,
  }));
  return { id: row.id, doc, settings, reviews };
}

/** The 14 stores in the order of §11.3. */
export const SEED_STORES: readonly SeedStore[] = ROWS.map(toSeedStore);

/** A store by id; throws for an unknown id (a typo in a data file). */
export function seedStore(id: string): SeedStore {
  const store = SEED_STORES.find((candidate) => candidate.id === id);
  if (!store) throw new Error(`unknown seed store ${id}`);
  return store;
}

/** The rating a store shows from its seed reviews alone: `round(sum × 10 / count) / 10` (§3.3). */
export function seedRating(store: Pick<SeedStore, 'reviews'>): { rating: number; count: number } {
  const count = store.reviews.length;
  const sum = store.reviews.reduce((total, review) => total + review.rating, 0);
  return { rating: count > 0 ? Math.round((sum * 10) / count) / 10 : 0, count };
}
