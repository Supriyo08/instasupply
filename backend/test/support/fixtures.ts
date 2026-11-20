/**
 * Rows a test needs before it can call the API (docs/PLATFORM.md §12.2): accounts of every role, stores,
 * products, jobsites and cards. They are written with SQL in the shapes of §3.2/§3.3 because the wave-2
 * repositories that will own these writes do not exist yet; passwords are hashed with the test cost.
 *
 * `seedCatalog` and `seedAccounts` give the named MARKETPLACE §11 data set (Dana, Kestrel, Marco, …). Until
 * the seed workstream writes backend/src/cli/seed/*.ts, they read the minimal in-file set below; switch the
 * data constants to imports from those files once they exist, so tests and the seed share one data set.
 */
import type {
  CardBrand,
  CategoryId,
  CityId,
  DriverVehicle,
  JobsiteFields,
  Role,
  SellUnit,
  StoreRole,
  StoreSpecialty,
  StoreStatus,
  VehicleClass,
  Weekday,
} from '@instasupply/shared';
import { buildSearchTerms } from '@instasupply/shared';
import type pg from 'pg';
import { hashPassword } from '../../src/platform/auth/passwords';
import { newId } from '../../src/platform/ids';
import type { FakeClock } from './clock';

type Ctx = { pool: pg.Pool; clock: FakeClock };

/** The seed password of MARKETPLACE §11; every fixture account uses it unless told otherwise. */
export const FIXTURE_PASSWORD = 'Instasupply@123';

// ---------- per-context state ----------

interface FixtureState {
  counter: number;
  accounts: Map<string, Account>;
  stores: Map<string, StoreFixture>;
  catalogSeeded: Promise<void> | null;
  accountsSeeded: Promise<void> | null;
}

const states = new WeakMap<object, FixtureState>();

function stateOf(ctx: object): FixtureState {
  let state = states.get(ctx);
  if (!state) {
    state = { counter: 0, accounts: new Map(), stores: new Map(), catalogSeeded: null, accountsSeeded: null };
    states.set(ctx, state);
  }
  return state;
}

/** A number unique within the context, for emails, store ids and SKUs. */
export function nextSerial(ctx: object): number {
  const state = stateOf(ctx);
  state.counter += 1;
  return state.counter;
}

const at = (ctx: Ctx): Date => new Date(ctx.clock.now());

// ---------- accounts ----------

export interface AccountSpec {
  /** A name for `as(ctx, key)`; also used to build the email when none is given. */
  key?: string;
  role: Role | null;
  status?: 'active' | 'pending' | 'suspended';
  email?: string;
  password?: string | null;
  displayName?: string;
  phoneNumber?: string | null;
  phoneVerified?: boolean;
  /** Suppliers. */
  storeId?: string;
  storeRole?: StoreRole;
  /** Drivers. */
  cityId?: CityId;
  vehicle?: Partial<DriverVehicle> & { capacityClass: VehicleClass };
  /** Drivers: a driver_locations row (online unless `online: false`). */
  position?: { lat: number; lng: number; online?: boolean };
  /** Extra keys of users.doc (§3.3), merged over the role's defaults. */
  doc?: Record<string, unknown>;
}

export interface Account {
  key: string;
  uid: string;
  email: string;
  password: string | null;
  role: Role | null;
  status: 'active' | 'pending' | 'suspended';
  displayName: string;
  storeId: string | null;
  storeRole: StoreRole | null;
  cityId: CityId | null;
  capacityClass: VehicleClass | null;
}

const VEHICLE_TYPE_FOR: Record<VehicleClass, DriverVehicle['type']> = {
  car: 'car',
  suv: 'suv',
  pickup: 'pickup',
  cargo_van: 'cargo_van',
  box_truck: 'box_truck',
  flatbed: 'flatbed',
};

function vehicleOf(spec: NonNullable<AccountSpec['vehicle']>): DriverVehicle {
  const type = spec.type ?? VEHICLE_TYPE_FOR[spec.capacityClass];
  return {
    type,
    make: spec.make ?? 'Ford',
    model: spec.model ?? 'Transit',
    year: spec.year ?? 2022,
    plate: spec.plate ?? 'TEST 001',
    colour: spec.colour ?? 'white',
    boxLengthFt: spec.boxLengthFt ?? (type === 'pickup' ? 6.5 : null),
    payloadKg: spec.payloadKg ?? null,
    extras: spec.extras ?? [],
    capacityClass: spec.capacityClass,
  };
}

function defaultDoc(spec: AccountSpec, now: number): Record<string, unknown> {
  switch (spec.role) {
    case 'customer':
      return {
        companyName: null,
        accountType: 'contractor',
        stats: { nonCancelledOrders: 0, completedOrders: 0, lastOrderAt: null },
        promoUses: {},
        preferences: { orderPush: true, chatPush: true, promoPush: false },
      };
    case 'driver': {
      const approved = (spec.status ?? 'active') === 'active';
      return {
        vehicle: vehicleOf(spec.vehicle ?? { capacityClass: 'cargo_van' }),
        vehicleDraft: null,
        vehicleReviewRequired: false,
        payoutAccount: approved
          ? { provider: 'test', accountRef: `acct_${newId()}`, label: 'Test bank' }
          : null,
        compliance: {
          licenceAttestedAt: now,
          insuranceAttestedAt: now,
          termsAcceptedAt: now,
          licenceVerified: approved,
          insuranceVerified: approved,
          verifiedBy: null,
          verifiedAt: approved ? now : null,
        },
        driverStats: { deliveries: 0, earnedCents: 0 },
        preferences: { jobPush: true, chatPush: true },
      };
    }
    default:
      return { preferences: {} };
  }
}

/** Inserts one user row. A supplier needs `storeId` (the store must exist); a driver gets a vehicle. */
export async function createAccount(ctx: Ctx, spec: AccountSpec): Promise<Account> {
  const state = stateOf(ctx);
  const serial = nextSerial(ctx);
  const key = spec.key ?? `${spec.role ?? 'user'}-${serial}`;
  if (state.accounts.has(key)) throw new Error(`fixture account ${key} already exists in this context`);
  const email = (spec.email ?? `${key}@instasupply.test`).toLowerCase();
  const password = spec.password === undefined ? FIXTURE_PASSWORD : spec.password;
  const status = spec.status ?? 'active';
  const now = ctx.clock.now();
  const doc = { ...defaultDoc(spec, now), ...(spec.doc ?? {}) };
  if (spec.role === 'supplier' && !spec.storeId) throw new Error('a supplier fixture needs a storeId');
  if (spec.role === 'driver' && !spec.cityId) throw new Error('a driver fixture needs a cityId');
  const uid = newId();
  const displayName = spec.displayName ?? `Test ${spec.role ?? 'user'} ${serial}`;
  const phone = spec.phoneNumber ?? null;
  await ctx.pool.query(
    `INSERT INTO users (id, email, password_hash, role, status, display_name, phone_number, phone_verified,
                        store_id, store_role, city_id, doc, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $13)`,
    [
      uid,
      email,
      password === null ? null : await hashPassword(password),
      spec.role,
      status,
      displayName,
      phone,
      phone !== null && (spec.phoneVerified ?? true),
      spec.role === 'supplier' ? spec.storeId : null,
      spec.role === 'supplier' ? (spec.storeRole ?? 'owner') : null,
      spec.role === 'driver' ? spec.cityId : null,
      JSON.stringify(doc),
      new Date(now),
    ],
  );
  if (spec.role === 'driver' && spec.position) {
    await ctx.pool.query(
      `INSERT INTO driver_locations (driver_id, lat, lng, heading, speed, accuracy, battery, online, updated_at)
       VALUES ($1, $2, $3, NULL, NULL, 10, NULL, $4, $5)`,
      [uid, spec.position.lat, spec.position.lng, spec.position.online ?? true, new Date(now)],
    );
  }
  const account: Account = {
    key,
    uid,
    email,
    password,
    role: spec.role,
    status,
    displayName,
    storeId: spec.role === 'supplier' ? (spec.storeId ?? null) : null,
    storeRole: spec.role === 'supplier' ? (spec.storeRole ?? 'owner') : null,
    cityId: spec.role === 'driver' ? (spec.cityId ?? null) : null,
    capacityClass: spec.role === 'driver' ? (spec.vehicle?.capacityClass ?? 'cargo_van') : null,
  };
  state.accounts.set(key, account);
  return account;
}

/** A fixture account created earlier in this context (by key). */
export function accountOf(ctx: object, key: string): Account | undefined {
  return stateOf(ctx).accounts.get(key);
}

// ---------- stores and products ----------

export interface StoreSpec {
  id?: string;
  name?: string;
  specialty?: StoreSpecialty;
  categoryIds?: CategoryId[];
  status?: StoreStatus;
  cityId?: CityId;
  areaLabel?: string;
  location?: { lat: number; lng: number };
  phone?: string;
  acceptingOrders?: boolean;
  /** Mon–Fri, Saturday, Sunday; null closes the day. */
  hours?: { weekdays: [string, string] | null; sat: [string, string] | null; sun: [string, string] | null };
  prepMinutes?: number;
  sameDayCutoff?: string;
  deliveryRadiusKm?: number;
  commissionBps?: number;
  closures?: string[];
  /** Extra keys merged over the store doc. */
  doc?: Record<string, unknown>;
}

export interface StoreFixture {
  id: string;
  name: string;
  status: StoreStatus;
  doc: Record<string, unknown>;
}

function hoursDoc(
  hours: NonNullable<StoreSpec['hours']>,
): Record<Weekday, { open: string; close: string } | null> {
  const day = (value: [string, string] | null) => (value ? { open: value[0], close: value[1] } : null);
  const weekday = day(hours.weekdays);
  return {
    mon: weekday,
    tue: weekday,
    wed: weekday,
    thu: weekday,
    fri: weekday,
    sat: day(hours.sat),
    sun: day(hours.sun),
  };
}

/** Inserts a store with its private settings (§3.2 `stores`). Defaults: live, Toronto, open 06:30–18:00. */
export async function createStore(ctx: Ctx, spec: StoreSpec = {}): Promise<StoreFixture> {
  const serial = nextSerial(ctx);
  const id = spec.id ?? `test-store-${serial}`;
  const name = spec.name ?? `Test Store ${serial}`;
  const status = spec.status ?? 'live';
  const location = spec.location ?? { lat: 43.6966, lng: -79.5752 };
  const phone = spec.phone ?? '+14165550120';
  const doc: Record<string, unknown> = {
    name,
    specialty: spec.specialty ?? 'lumber_building',
    categoryIds: spec.categoryIds ?? ['wood', 'fasteners', 'adhesives', 'masonry'],
    description: `${name} (test fixture).`,
    marketId: 'gta',
    cityId: spec.cityId ?? 'toronto',
    areaLabel: spec.areaLabel ?? 'Etobicoke',
    address: {
      line1: 'Dixon Rd & Martin Grove Rd',
      line2: null,
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M9W 5L4',
    },
    location,
    phone,
    email: null,
    photoPath: null,
    imageKey: null,
    hours: hoursDoc(spec.hours ?? { weekdays: ['06:30', '18:00'], sat: ['07:00', '16:00'], sun: null }),
    closures: spec.closures ?? [],
    fulfilment: { delivery: true, pickup: true, deliveryRadiusKm: spec.deliveryRadiusKm ?? 45 },
    prepMinutes: spec.prepMinutes ?? 25,
    sameDayCutoff: spec.sameDayCutoff ?? '15:00',
    status,
    acceptingOrders: spec.acceptingOrders ?? status === 'live',
    ...(spec.doc ?? {}),
  };
  const settings = {
    commissionBps: spec.commissionBps ?? 1000,
    payoutAccount: { provider: 'test', accountRef: `acct_${id}`, label: 'Test bank' },
    ordersEmail: null,
    alertPhone: phone,
    loadingNotes: null,
    onboarding: { catalogReady: true, payoutsReady: true, trained: true },
    notes: null,
  };
  await ctx.pool.query(
    `INSERT INTO stores (id, doc, settings, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $4)`,
    [id, JSON.stringify(doc), JSON.stringify(settings), at(ctx)],
  );
  const store: StoreFixture = { id, name, status, doc };
  stateOf(ctx).stores.set(id, store);
  return store;
}

export interface ProductSpec {
  sku?: string;
  name?: string;
  brand?: string | null;
  categoryId?: CategoryId;
  familyKey?: string | null;
  unit?: SellUnit;
  size?: string | null;
  priceCents?: number;
  compareAtCents?: number | null;
  stockOnHand?: number;
  reserved?: number;
  maxPerOrder?: number | null;
  weightKg?: number;
  dimsCm?: { l: number; w: number; h: number };
  active?: boolean;
  featured?: boolean;
  imageKey?: string | null;
}

export interface ProductFixture {
  id: string;
  storeId: string;
  sku: string;
  name: string;
  priceCents: number;
  stockOnHand: number;
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Inserts a product of a store created earlier (§3.2 `products`; id `${storeId}--${skuSlug}`). */
export async function createProduct(
  ctx: Ctx,
  storeId: string,
  spec: ProductSpec = {},
): Promise<ProductFixture> {
  const { rows } = await ctx.pool.query<{ name: string; status: StoreStatus }>(
    'SELECT name, status FROM stores WHERE id = $1',
    [storeId],
  );
  const store = rows[0];
  if (!store) throw new Error(`createProduct: no store ${storeId}`);
  const serial = nextSerial(ctx);
  const sku = spec.sku ?? `TST-${serial}`;
  const name = spec.name ?? `Test product ${serial}`;
  const id = `${storeId}--${slug(sku)}`;
  const priceCents = spec.priceCents ?? 1000;
  const stockOnHand = spec.stockOnHand ?? 100;
  const brand = spec.brand ?? null;
  const size = spec.size ?? null;
  const categoryId = spec.categoryId ?? 'wood';
  const familyKey = spec.familyKey ?? null;
  const doc = {
    sku,
    name,
    brand,
    categoryId,
    familyKey,
    unit: spec.unit ?? 'each',
    size,
    description: `${name} (test fixture).`,
    priceCents,
    compareAtCents: spec.compareAtCents ?? null,
    maxPerOrder: spec.maxPerOrder ?? null,
    weightKg: spec.weightKg ?? 4.5,
    dimsCm: spec.dimsCm ?? { l: 244, w: 9, h: 4 },
    shipEstimated: false,
    active: spec.active ?? true,
    featured: spec.featured ?? false,
    badge: null,
    imageKey: spec.imageKey ?? null,
    imagePath: null,
    updatedBy: 'fixture',
  };
  const extra = [brand, sku, size, categoryId, familyKey].filter((value): value is string => !!value);
  await ctx.pool.query(
    `INSERT INTO products (id, store_id, doc, stock_on_hand, reserved, store_name, store_status, search_terms,
                           created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $9)`,
    [
      id,
      storeId,
      JSON.stringify(doc),
      stockOnHand,
      spec.reserved ?? 0,
      store.name,
      store.status,
      buildSearchTerms(name, extra),
      at(ctx),
    ],
  );
  return { id, storeId, sku, name, priceCents, stockOnHand };
}

// ---------- the customer's own data ----------

export interface JobsiteFixture {
  id: string;
  label: string;
  isDefault: boolean;
  fields: JobsiteFields;
}

/** Inserts a jobsite (defaults: Leslieville, attended). */
export async function createJobsite(
  ctx: Ctx,
  uid: string,
  spec: Partial<JobsiteFields> & { isDefault?: boolean } = {},
): Promise<JobsiteFixture> {
  const { isDefault = false, ...overrides } = spec;
  const fields: JobsiteFields = {
    label: 'Leslieville semi reno',
    line1: 'Pape Ave & Dundas St E',
    line2: null,
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M4M 2E3',
    location: { lat: 43.6648, lng: -79.3405 },
    cityId: 'toronto',
    areaLabel: 'Leslieville · M4M',
    contactName: 'Site Contact',
    contactPhone: '+14165550110',
    instructions: null,
    receiving: 'attended',
    maxVehicleClass: null,
    ...overrides,
  };
  const id = newId();
  await ctx.pool.query(
    `INSERT INTO jobsites (id, user_id, doc, is_default, last_used_at, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, NULL, $5, $5)`,
    [id, uid, JSON.stringify(fields), isDefault, at(ctx)],
  );
  return { id, label: fields.label, isDefault, fields };
}

export interface CardFixture {
  id: string;
  brand: CardBrand;
  last4: string;
  isDefault: boolean;
}

/**
 * Inserts a test-mode card. The last 4 decide TestGateway's answer (MARKETPLACE §3.8): 0002 declined,
 * 9995 insufficient funds, 0069 expired, 0341 authorizes but every capture fails, anything else succeeds.
 */
export async function createCard(
  ctx: Ctx,
  uid: string,
  spec: { last4?: string; brand?: CardBrand; isDefault?: boolean; holder?: string; expYear?: number } = {},
): Promise<CardFixture> {
  const id = newId();
  const last4 = spec.last4 ?? '4242';
  const brand = spec.brand ?? (last4 === '4444' ? 'mastercard' : 'visa');
  const isDefault = spec.isDefault ?? false;
  await ctx.pool.query(
    `INSERT INTO cards (id, user_id, brand, last4, exp_month, exp_year, holder, is_default, provider, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 12, $5, $6, $7, 'test', $8, $8)`,
    [id, uid, brand, last4, spec.expYear ?? 2030, spec.holder ?? 'Test Holder', isDefault, at(ctx)],
  );
  return { id, brand, last4, isDefault };
}

// ---------- the named data set (MARKETPLACE §11, minimal in-file copy) ----------

type Hours = NonNullable<StoreSpec['hours']>;
const h = (
  weekdays: [string, string] | null,
  sat: [string, string] | null,
  sun: [string, string] | null,
): Hours => ({
  weekdays,
  sat,
  sun,
});

/** The stores the vectors V1 to V9 need, plus one coming_soon store (MARKETPLACE §11.3). */
export const SEED_STORES: readonly (StoreSpec & { id: string; owner: { key: string; name: string } })[] = [
  {
    id: 'kestrel-lumber',
    name: 'Kestrel Lumber Yard',
    specialty: 'lumber_building',
    categoryIds: ['wood', 'masonry', 'adhesives', 'fasteners', 'outdoors'],
    cityId: 'toronto',
    areaLabel: 'Etobicoke',
    location: { lat: 43.6966, lng: -79.5752 },
    phone: '+14165550120',
    hours: h(['06:30', '18:00'], ['07:00', '16:00'], null),
    prepMinutes: 25,
    sameDayCutoff: '15:00',
    deliveryRadiusKm: 45,
    commissionBps: 900,
    owner: { key: 'kestrelOwner', name: 'Owen Mercer' },
  },
  {
    id: 'grainline-building',
    name: 'Grainline Building Centre',
    specialty: 'lumber_building',
    categoryIds: ['wood', 'drywall', 'insulation', 'flooring', 'tools', 'safety', 'cleaning', 'appliances'],
    cityId: 'toronto',
    areaLabel: 'Scarborough',
    location: { lat: 43.7655, lng: -79.2829 },
    phone: '+14165550121',
    hours: h(['07:00', '19:00'], ['08:00', '17:00'], ['10:00', '16:00']),
    prepMinutes: 20,
    sameDayCutoff: '15:00',
    deliveryRadiusKm: 40,
    commissionBps: 900,
    owner: { key: 'grainlineOwner', name: 'Priya Anand' },
  },
  {
    id: 'bluestone-drywall',
    name: 'Bluestone Drywall & Paint',
    specialty: 'drywall_paint',
    categoryIds: ['drywall', 'paint'],
    cityId: 'toronto',
    areaLabel: 'North York',
    location: { lat: 43.7709, lng: -79.4912 },
    phone: '+14165550122',
    hours: h(['06:30', '17:00'], ['07:00', '13:00'], null),
    prepMinutes: 20,
    sameDayCutoff: '15:00',
    deliveryRadiusKm: 40,
    commissionBps: 1000,
    owner: { key: 'bluestoneOwner', name: 'Nadia Petrov' },
  },
  {
    id: 'voltway-electrical',
    name: 'Voltway Electrical Supply',
    specialty: 'electrical',
    categoryIds: ['electrical'],
    cityId: 'mississauga',
    areaLabel: 'Mississauga',
    location: { lat: 43.6262, lng: -79.6143 },
    phone: '+19055550123',
    hours: h(['07:00', '17:30'], ['08:00', '13:00'], null),
    prepMinutes: 15,
    sameDayCutoff: '15:30',
    deliveryRadiusKm: 40,
    commissionBps: 1000,
    owner: { key: 'voltwayOwner', name: 'Ken Ito' },
  },
  {
    id: 'copperline-plumbing',
    name: 'Copperline Plumbing Depot',
    specialty: 'plumbing',
    categoryIds: ['plumbing'],
    cityId: 'vaughan',
    areaLabel: 'Concord',
    location: { lat: 43.801, lng: -79.499 },
    phone: '+19055550124',
    hours: h(['07:00', '17:00'], ['08:00', '14:00'], null),
    prepMinutes: 15,
    sameDayCutoff: '15:00',
    deliveryRadiusKm: 40,
    commissionBps: 1000,
    owner: { key: 'copperlineOwner', name: 'Maria Santos' },
  },
  {
    id: 'boltbin-hardware',
    name: 'Boltbin Fasteners & Hardware',
    specialty: 'fasteners_hardware',
    categoryIds: ['fasteners', 'hardware', 'adhesives', 'tools'],
    cityId: 'brampton',
    areaLabel: 'Brampton',
    location: { lat: 43.7262, lng: -79.6885 },
    phone: '+19055550126',
    hours: h(['07:00', '18:00'], ['08:00', '15:00'], null),
    prepMinutes: 10,
    sameDayCutoff: '16:00',
    deliveryRadiusKm: 45,
    commissionBps: 1100,
    owner: { key: 'boltbinOwner', name: 'Chris Doyle' },
  },
  {
    id: 'glassmoor-glass',
    name: 'Glassmoor Glass & Mirror',
    specialty: 'glass_mirrors',
    categoryIds: ['glass', 'windows'],
    cityId: 'toronto',
    areaLabel: 'Leaside',
    location: { lat: 43.7102, lng: -79.3615 },
    phone: '+14165550127',
    hours: h(['08:00', '17:00'], ['09:00', '13:00'], null),
    prepMinutes: 30,
    sameDayCutoff: '14:00',
    deliveryRadiusKm: 30,
    commissionBps: 1200,
    closures: ['2026-11-27'],
    owner: { key: 'glassmoorOwner', name: 'Elena Rossi' },
  },
  {
    id: 'slatebridge-masonry',
    name: 'Slatebridge Masonry & Roofing',
    specialty: 'masonry_roofing',
    categoryIds: ['masonry', 'roofing'],
    cityId: 'oakville',
    areaLabel: 'Oakville',
    location: { lat: 43.4441, lng: -79.688 },
    phone: '+19055550129',
    hours: h(['06:30', '17:00'], ['07:00', '13:00'], null),
    prepMinutes: 25,
    sameDayCutoff: '14:00',
    deliveryRadiusKm: 45,
    commissionBps: 900,
    owner: { key: 'slatebridgeOwner', name: 'Fiona Walsh' },
  },
  {
    id: 'tapstone-bath',
    name: 'Tapstone Bath & Fixtures',
    specialty: 'bath_fixtures',
    categoryIds: ['bath'],
    status: 'coming_soon',
    cityId: 'mississauga',
    areaLabel: 'Cooksville',
    location: { lat: 43.589, lng: -79.623 },
    phone: '+19055550132',
    hours: h(null, null, null),
    owner: { key: 'tapstoneOwner', name: 'Tapstone Owner' },
  },
];

/** A few products per live store, with the cross-store family keys of MARKETPLACE §11.4. */
export const SEED_PRODUCTS: readonly (ProductSpec & { storeId: string; sku: string; name: string })[] = [
  {
    storeId: 'kestrel-lumber',
    sku: 'KLY-SPF248',
    name: '2x4x8 SPF stud, kiln-dried',
    categoryId: 'wood',
    unit: 'each',
    size: '2 in × 4 in × 8 ft',
    priceCents: 479,
    stockOnHand: 1200,
    weightKg: 4.5,
    dimsCm: { l: 244, w: 9, h: 4 },
    familyKey: 'spf-2x4x8',
    imageKey: 'lumber-stud',
  },
  {
    storeId: 'kestrel-lumber',
    sku: 'KLY-OSB716',
    name: 'OSB sheathing 7/16 in, 4×8',
    categoryId: 'wood',
    unit: 'sheet',
    priceCents: 2298,
    stockOnHand: 260,
    weightKg: 23,
    dimsCm: { l: 244, w: 122, h: 1.1 },
    imageKey: 'osb-sheet',
  },
  {
    storeId: 'kestrel-lumber',
    sku: 'KLY-CONC30',
    name: 'Concrete mix, 30 kg',
    categoryId: 'masonry',
    unit: 'bag',
    priceCents: 948,
    stockOnHand: 400,
    weightKg: 30,
    dimsCm: { l: 60, w: 40, h: 12 },
    imageKey: 'concrete-mix-bag',
  },
  {
    storeId: 'kestrel-lumber',
    sku: 'KLY-ADH',
    name: 'Construction adhesive, 300 ml',
    categoryId: 'adhesives',
    unit: 'tube',
    priceCents: 698,
    stockOnHand: 240,
    weightKg: 0.4,
    dimsCm: { l: 25, w: 6, h: 6 },
    familyKey: 'const-adhesive-300ml',
    imageKey: 'construction-adhesive',
  },
  {
    storeId: 'kestrel-lumber',
    sku: 'KLY-JH28',
    name: 'Joist hanger 2x8, galvanized',
    categoryId: 'fasteners',
    unit: 'each',
    priceCents: 298,
    stockOnHand: 600,
    weightKg: 0.3,
    dimsCm: { l: 15, w: 8, h: 5 },
    familyKey: 'joist-hanger-2x8',
    imageKey: 'joist-hanger',
  },
  {
    storeId: 'grainline-building',
    sku: 'GBC-SPF248',
    name: '2x4x8 SPF stud',
    categoryId: 'wood',
    unit: 'each',
    size: '2 in × 4 in × 8 ft',
    priceCents: 498,
    stockOnHand: 800,
    weightKg: 4.5,
    dimsCm: { l: 244, w: 9, h: 4 },
    familyKey: 'spf-2x4x8',
    imageKey: 'lumber-stud',
  },
  {
    storeId: 'grainline-building',
    sku: 'GBC-DW12',
    name: 'Drywall 1/2 in regular, 4×8',
    categoryId: 'drywall',
    unit: 'sheet',
    priceCents: 1898,
    stockOnHand: 400,
    weightKg: 25,
    dimsCm: { l: 244, w: 122, h: 1.3 },
    familyKey: 'drywall-12-4x8',
    imageKey: 'drywall-sheet',
  },
  {
    storeId: 'bluestone-drywall',
    sku: 'BDP-DW12',
    name: 'Drywall 1/2 in regular, 4×8',
    categoryId: 'drywall',
    unit: 'sheet',
    priceCents: 1848,
    stockOnHand: 900,
    weightKg: 25,
    dimsCm: { l: 244, w: 122, h: 1.3 },
    familyKey: 'drywall-12-4x8',
    imageKey: 'drywall-sheet',
  },
  {
    storeId: 'bluestone-drywall',
    sku: 'BDP-JC17',
    name: 'All-purpose joint compound, 17 L',
    categoryId: 'drywall',
    unit: 'pail',
    priceCents: 2998,
    stockOnHand: 150,
    weightKg: 28,
    dimsCm: { l: 30, w: 30, h: 38 },
    imageKey: 'joint-compound',
  },
  {
    storeId: 'voltway-electrical',
    sku: 'VES-NMD14',
    name: 'NMD90 14/2 cable, 75 m',
    categoryId: 'electrical',
    unit: 'roll',
    priceCents: 10998,
    stockOnHand: 80,
    weightKg: 7,
    dimsCm: { l: 35, w: 35, h: 12 },
  },
  {
    storeId: 'copperline-plumbing',
    sku: 'CPD-PEX12',
    name: 'PEX-B pipe 1/2 in, 100 ft',
    categoryId: 'plumbing',
    unit: 'roll',
    priceCents: 5498,
    stockOnHand: 90,
    weightKg: 4,
    dimsCm: { l: 60, w: 60, h: 8 },
  },
  {
    storeId: 'boltbin-hardware',
    sku: 'BFH-SCR212',
    name: 'Subfloor screws #9 × 2-1/2 in, 5 lb',
    categoryId: 'fasteners',
    unit: 'box',
    priceCents: 3298,
    stockOnHand: 200,
    weightKg: 2.4,
    dimsCm: { l: 18, w: 12, h: 8 },
    familyKey: 'subfloor-screws-212-5lb',
    imageKey: 'screws-box',
  },
  {
    storeId: 'boltbin-hardware',
    sku: 'BFH-JH28',
    name: 'Joist hanger 2x8, galvanized',
    categoryId: 'fasteners',
    unit: 'each',
    priceCents: 279,
    stockOnHand: 900,
    weightKg: 0.3,
    dimsCm: { l: 15, w: 8, h: 5 },
    familyKey: 'joist-hanger-2x8',
    imageKey: 'joist-hanger',
  },
  {
    storeId: 'boltbin-hardware',
    sku: 'BFH-ADH',
    name: 'Construction adhesive, 300 ml',
    categoryId: 'adhesives',
    unit: 'tube',
    priceCents: 649,
    stockOnHand: 300,
    weightKg: 0.4,
    dimsCm: { l: 25, w: 6, h: 6 },
    familyKey: 'const-adhesive-300ml',
    imageKey: 'construction-adhesive',
  },
  {
    storeId: 'glassmoor-glass',
    sku: 'GMG-MIR3648',
    name: 'Frameless mirror 36 × 48 in',
    categoryId: 'glass',
    unit: 'each',
    priceCents: 18998,
    stockOnHand: 12,
    weightKg: 18,
    dimsCm: { l: 122, w: 92, h: 1 },
  },
  {
    storeId: 'slatebridge-masonry',
    sku: 'SBM-SHING',
    name: 'Architectural shingles, bundle',
    categoryId: 'roofing',
    unit: 'bundle',
    priceCents: 4698,
    stockOnHand: 300,
    weightKg: 30,
    dimsCm: { l: 100, w: 33, h: 10 },
  },
];

/** Writes SEED_STORES and SEED_PRODUCTS once per context. Categories come with the template. */
export function seedCatalog(ctx: Ctx): Promise<void> {
  const state = stateOf(ctx);
  state.catalogSeeded ??= (async () => {
    for (const { owner: _owner, ...store } of SEED_STORES) await createStore(ctx, store);
    for (const { storeId, ...product } of SEED_PRODUCTS) await createProduct(ctx, storeId, product);
  })();
  return state.catalogSeeded;
}

/** The keys `as(ctx, key)` accepts after seedAccounts. */
export type SeedAccountKey =
  | 'admin'
  | 'dispatcher'
  | 'dana'
  | 'sam'
  | 'kestrelOwner'
  | 'kestrelStaff'
  | 'grainlineOwner'
  | 'bluestoneOwner'
  | 'voltwayOwner'
  | 'copperlineOwner'
  | 'boltbinOwner'
  | 'glassmoorOwner'
  | 'slatebridgeOwner'
  | 'tapstoneOwner'
  | 'marco'
  | 'aisha'
  | 'tom'
  | 'gurpreet'
  | 'devon'
  | 'lena';

/** Dana's cards, in the order of §12.2; ••4242 is the default. */
export const DANA_CARDS = ['4242', '4444', '0002', '9995', '0069', '0341'] as const;

/** The jobsites of MARKETPLACE §11.2. */
export const SEED_JOBSITES = {
  leslieville: {
    label: 'Leslieville semi reno',
    line1: 'Pape Ave & Dundas St E',
    postalCode: 'M4M 2E3',
    location: { lat: 43.6648, lng: -79.3405 },
    areaLabel: 'Leslieville · M4M',
    contactName: 'Dana Whitfield',
    contactPhone: '+14165550110',
    instructions: 'Laneway access off Pape. Stack lumber under the tarp by the garage.',
    receiving: 'attended',
  },
  junction: {
    label: 'Junction basement',
    line1: 'Dundas St W & Keele St',
    postalCode: 'M6P 1Z2',
    location: { lat: 43.6655, lng: -79.4636 },
    areaLabel: 'The Junction · M6P',
    contactName: 'Luis Ortega',
    contactPhone: '+16475550141',
    instructions: 'Side door code 4410. Drywall inside the side door.',
    receiving: 'unattended',
    maxVehicleClass: 'cargo_van',
  },
  mimico: {
    label: 'Mimico laneway house',
    line1: 'Royal York Rd & Lake Shore Blvd W',
    postalCode: 'M8V 1L4',
    location: { lat: 43.6163, lng: -79.4955 },
    areaLabel: 'Mimico · M8V',
    contactName: 'Dana Whitfield',
    contactPhone: '+14165550110',
    instructions: 'Lane behind the house; park on the gravel pad.',
    receiving: 'attended',
  },
  danforth: {
    label: 'Home — Danforth',
    line1: 'Danforth Ave & Woodbine Ave',
    postalCode: 'M4C 1L9',
    location: { lat: 43.6866, lng: -79.3127 },
    areaLabel: 'Danforth · M4C',
    contactName: 'Sam Okafor',
    contactPhone: '+14375550144',
    instructions: null,
    receiving: 'attended',
  },
} satisfies Record<string, Partial<JobsiteFields>>;

interface SeedDriver {
  key: SeedAccountKey;
  name: string;
  cityId: CityId;
  vehicle: NonNullable<AccountSpec['vehicle']>;
  position: { lat: number; lng: number };
  phone: string;
  status?: 'active' | 'pending';
}

const SEED_DRIVERS: readonly SeedDriver[] = [
  {
    key: 'marco',
    name: 'Marco Bellini',
    cityId: 'toronto',
    vehicle: {
      capacityClass: 'pickup',
      type: 'pickup',
      make: 'Ford',
      model: 'F-150',
      year: 2021,
      plate: 'CBKX 214',
      boxLengthFt: 6.5,
    },
    position: { lat: 43.7, lng: -79.56 },
    phone: '+14165550151',
  },
  {
    key: 'aisha',
    name: 'Aisha Rahman',
    cityId: 'toronto',
    vehicle: {
      capacityClass: 'cargo_van',
      make: 'Ford',
      model: 'Transit 250',
      year: 2022,
      plate: 'DMRT 538',
    },
    position: { lat: 43.7615, lng: -79.4111 },
    phone: '+16475550152',
  },
  {
    key: 'tom',
    name: 'Tom Nguyen',
    cityId: 'toronto',
    vehicle: {
      capacityClass: 'car',
      make: 'Toyota',
      model: 'Corolla',
      year: 2019,
      plate: 'CAPW 771',
      colour: 'grey',
    },
    position: { lat: 43.7731, lng: -79.2577 },
    phone: '+14375550153',
  },
  {
    key: 'gurpreet',
    name: 'Gurpreet Sandhu',
    cityId: 'brampton',
    vehicle: { capacityClass: 'flatbed', make: 'Isuzu', model: 'NPR', year: 2020, plate: 'AK 41927' },
    position: { lat: 43.72, lng: -79.7 },
    phone: '+19055550154',
  },
  {
    key: 'devon',
    name: 'Devon Clarke',
    cityId: 'toronto',
    vehicle: {
      capacityClass: 'box_truck',
      make: 'Hino',
      model: '195',
      year: 2020,
      plate: 'AM 52038',
      extras: ['liftgate'],
    },
    position: { lat: 43.65, lng: -79.45 },
    phone: '+14165550155',
  },
  {
    key: 'lena',
    name: 'Lena Kowalski',
    cityId: 'mississauga',
    vehicle: { capacityClass: 'suv', make: 'Honda', model: 'CR-V', year: 2020, plate: 'CNLT 902' },
    position: { lat: 43.589, lng: -79.644 },
    phone: '+19055550156',
    status: 'pending',
  },
];

/**
 * The accounts of §12.2 (seeds the catalogue first): admin, dispatcher, Dana (verified phone, three
 * jobsites, the six test cards), Sam, every store owner, Kestrel's staff, the active drivers online at
 * their seed positions and the pending driver Lena. Once per context.
 */
export function seedAccounts(ctx: Ctx): Promise<void> {
  const state = stateOf(ctx);
  state.accountsSeeded ??= (async () => {
    await seedCatalog(ctx);
    const email = (local: string) => `${local}@instasupply.test`;
    await createAccount(ctx, {
      key: 'admin',
      role: 'admin',
      email: email('admin'),
      displayName: 'Morgan Lee',
    });
    await createAccount(ctx, {
      key: 'dispatcher',
      role: 'dispatcher',
      email: email('dispatch'),
      displayName: 'Riley Chen',
    });
    const dana = await createAccount(ctx, {
      key: 'dana',
      role: 'customer',
      email: email('customer'),
      displayName: 'Dana Whitfield',
      phoneNumber: '+14165550110',
      doc: { companyName: 'Whitfield Renovations', accountType: 'contractor' },
    });
    await createJobsite(ctx, dana.uid, { ...SEED_JOBSITES.leslieville, isDefault: true });
    await createJobsite(ctx, dana.uid, SEED_JOBSITES.junction);
    await createJobsite(ctx, dana.uid, SEED_JOBSITES.mimico);
    for (const last4 of DANA_CARDS)
      await createCard(ctx, dana.uid, { last4, isDefault: last4 === '4242', holder: 'Dana Whitfield' });
    const sam = await createAccount(ctx, {
      key: 'sam',
      role: 'customer',
      email: email('homeowner'),
      displayName: 'Sam Okafor',
      phoneNumber: '+14375550144',
      doc: { accountType: 'homeowner' },
    });
    await createJobsite(ctx, sam.uid, { ...SEED_JOBSITES.danforth, isDefault: true });
    await createCard(ctx, sam.uid, { last4: '4242', isDefault: true, holder: 'Sam Okafor' });
    for (const store of SEED_STORES) {
      await createAccount(ctx, {
        key: store.owner.key,
        role: 'supplier',
        email: email(store.id.split('-')[0]!),
        displayName: store.owner.name,
        storeId: store.id,
        storeRole: 'owner',
      });
    }
    await createAccount(ctx, {
      key: 'kestrelStaff',
      role: 'supplier',
      email: email('kestrel.staff'),
      displayName: 'Jas Dhillon',
      storeId: 'kestrel-lumber',
      storeRole: 'staff',
    });
    for (const driver of SEED_DRIVERS) {
      await createAccount(ctx, {
        key: driver.key,
        role: 'driver',
        status: driver.status ?? 'active',
        email: email(driver.key === 'lena' ? 'new.driver' : driver.key),
        displayName: driver.name,
        phoneNumber: driver.phone,
        cityId: driver.cityId,
        vehicle: driver.vehicle,
        position: { ...driver.position, online: (driver.status ?? 'active') === 'active' },
      });
    }
  })();
  return state.accountsSeeded;
}
