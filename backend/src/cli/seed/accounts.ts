/**
 * The demo accounts of MARKETPLACE §11.1: staff, customers with their test cards, store owners and staff,
 * and drivers with their vehicles and seed positions. Emails end in `@instasupply.test`; phones are in the
 * reserved 555-0100…0199 range. Passwords are not data: `seed --demo` gives every account `SEED_PASSWORD`,
 * except the two staff accounts in production, which get a set-password link (docs/PLATFORM.md §2.2).
 */
import {
  capacityClassFor,
  type AccountType,
  type CardBrand,
  type CityId,
  type DriverVehicle,
  type LatLng,
  type StoreRole,
} from '@instasupply/shared';

export const SEED_EMAIL_DOMAIN = 'instasupply.test';
const email = (local: string): string => `${local}@${SEED_EMAIL_DOMAIN}`;

export interface SeedCard {
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  holder: string;
  isDefault: boolean;
}

interface SeedAccountBase {
  /** The name scenarios and fixtures use for the account, e.g. `dana`. */
  key: string;
  email: string;
  displayName: string;
  phoneNumber: string | null;
  phoneVerified: boolean;
}

export interface SeedStaff extends SeedAccountBase {
  role: 'admin' | 'dispatcher';
}

export interface SeedCustomer extends SeedAccountBase {
  role: 'customer';
  companyName: string | null;
  accountType: AccountType;
  cards: readonly SeedCard[];
}

export interface SeedSupplier extends SeedAccountBase {
  role: 'supplier';
  storeId: string;
  storeRole: StoreRole;
}

export interface SeedDriver extends SeedAccountBase {
  role: 'driver';
  status: 'active' | 'pending';
  cityId: CityId;
  vehicle: DriverVehicle;
  position: LatLng;
  online: boolean;
}

export type SeedAccount = SeedStaff | SeedCustomer | SeedSupplier | SeedDriver;

// ---------- staff ----------

export const SEED_STAFF: readonly SeedStaff[] = [
  {
    key: 'admin',
    role: 'admin',
    email: email('admin'),
    displayName: 'Morgan Lee',
    phoneNumber: null,
    phoneVerified: false,
  },
  {
    key: 'dispatcher',
    role: 'dispatcher',
    email: email('dispatch'),
    displayName: 'Riley Chen',
    phoneNumber: null,
    phoneVerified: false,
  },
];

// ---------- customers ----------

const visa = (last4: string, holder: string, isDefault = false): SeedCard => ({
  brand: 'visa',
  last4,
  expMonth: 12,
  expYear: 2030,
  holder,
  isDefault,
});

/**
 * Dana's cards in the demo (§11.1): Visa ••4242 (default), Mastercard ••4444 and the "test decline" Visa
 * ••0002. TestGateway answers by the last 4 (MARKETPLACE §3.8).
 */
export const DANA_CARDS: readonly SeedCard[] = [
  visa('4242', 'Dana Whitfield', true),
  {
    brand: 'mastercard',
    last4: '4444',
    expMonth: 12,
    expYear: 2030,
    holder: 'Dana Whitfield',
    isDefault: false,
  },
  visa('0002', 'Dana Whitfield'),
];

/**
 * The extra TestGateway cards the test fixtures give Dana (docs/PLATFORM.md §12.2): ••9995 insufficient
 * funds, ••0069 expired, ••0341 authorizes but every capture fails. Not written by the seed.
 */
export const DANA_TEST_CARDS: readonly SeedCard[] = [
  ...DANA_CARDS,
  visa('9995', 'Dana Whitfield'),
  visa('0069', 'Dana Whitfield'),
  visa('0341', 'Dana Whitfield'),
];

export const SEED_CUSTOMERS: readonly SeedCustomer[] = [
  {
    key: 'dana',
    role: 'customer',
    email: email('customer'),
    displayName: 'Dana Whitfield',
    phoneNumber: '+14165550110',
    phoneVerified: true,
    companyName: 'Whitfield Renovations',
    accountType: 'contractor',
    cards: DANA_CARDS,
  },
  {
    key: 'sam',
    role: 'customer',
    email: email('homeowner'),
    displayName: 'Sam Okafor',
    phoneNumber: '+14375550144',
    phoneVerified: true,
    companyName: null,
    accountType: 'homeowner',
    cards: [visa('4242', 'Sam Okafor', true)],
  },
];

// ---------- suppliers ----------

const owner = (key: string, storeId: string, local: string, displayName: string): SeedSupplier => ({
  key,
  role: 'supplier',
  email: email(local),
  displayName,
  phoneNumber: null,
  phoneVerified: false,
  storeId,
  storeRole: 'owner',
});

/** One owner per live store, plus Kestrel's staff member. The stores that are not live have no users yet. */
export const SEED_SUPPLIERS: readonly SeedSupplier[] = [
  owner('kestrelOwner', 'kestrel-lumber', 'kestrel', 'Owen Mercer'),
  { ...owner('kestrelStaff', 'kestrel-lumber', 'kestrel.staff', 'Jas Dhillon'), storeRole: 'staff' },
  owner('grainlineOwner', 'grainline-building', 'grainline', 'Priya Anand'),
  owner('bluestoneOwner', 'bluestone-drywall', 'bluestone', 'Nadia Petrov'),
  owner('voltwayOwner', 'voltway-electrical', 'voltway', 'Ken Ito'),
  owner('copperlineOwner', 'copperline-plumbing', 'copperline', 'Maria Santos'),
  owner('aircrestOwner', 'aircrest-hvac', 'aircrest', 'Hamid Karimi'),
  owner('boltbinOwner', 'boltbin-hardware', 'boltbin', 'Chris Doyle'),
  owner('glassmoorOwner', 'glassmoor-glass', 'glassmoor', 'Elena Rossi'),
  owner('casingcraftOwner', 'casingcraft-doors', 'casingcraft', 'Victor Lam'),
  owner('slatebridgeOwner', 'slatebridge-masonry', 'slatebridge', 'Fiona Walsh'),
];

// ---------- drivers ----------

type VehicleSpec = Omit<DriverVehicle, 'capacityClass' | 'payloadKg' | 'extras'> &
  Partial<Pick<DriverVehicle, 'payloadKg' | 'extras'>>;

/** The vehicle with its class derived by the shared rule (§3.3), as the server does on approval. */
function vehicle(spec: VehicleSpec): DriverVehicle {
  const full = { payloadKg: null, extras: [], ...spec };
  return { ...full, capacityClass: capacityClassFor(full) };
}

export const SEED_DRIVERS: readonly SeedDriver[] = [
  {
    key: 'marco',
    role: 'driver',
    status: 'active',
    email: email('marco'),
    displayName: 'Marco Bellini',
    phoneNumber: '+14165550151',
    phoneVerified: true,
    cityId: 'toronto',
    vehicle: vehicle({
      type: 'pickup',
      make: 'Ford',
      model: 'F-150',
      year: 2021,
      plate: 'CBKX 214',
      colour: 'white',
      boxLengthFt: 6.5,
    }),
    position: { lat: 43.7, lng: -79.56 },
    online: true,
  },
  {
    key: 'aisha',
    role: 'driver',
    status: 'active',
    email: email('aisha'),
    displayName: 'Aisha Rahman',
    phoneNumber: '+16475550152',
    phoneVerified: true,
    cityId: 'toronto',
    vehicle: vehicle({
      type: 'cargo_van',
      make: 'Ford',
      model: 'Transit 250',
      year: 2022,
      plate: 'DMRT 538',
      colour: 'white',
      boxLengthFt: null,
    }),
    position: { lat: 43.7615, lng: -79.4111 },
    online: true,
  },
  {
    key: 'tom',
    role: 'driver',
    status: 'active',
    email: email('tom'),
    displayName: 'Tom Nguyen',
    phoneNumber: '+14375550153',
    phoneVerified: true,
    cityId: 'toronto',
    vehicle: vehicle({
      type: 'car',
      make: 'Toyota',
      model: 'Corolla',
      year: 2019,
      plate: 'CAPW 771',
      colour: 'grey',
      boxLengthFt: null,
    }),
    position: { lat: 43.7731, lng: -79.2577 },
    online: false,
  },
  {
    key: 'gurpreet',
    role: 'driver',
    status: 'active',
    email: email('gurpreet'),
    displayName: 'Gurpreet Sandhu',
    phoneNumber: '+19055550154',
    phoneVerified: true,
    cityId: 'brampton',
    vehicle: vehicle({
      type: 'flatbed',
      make: 'Isuzu',
      model: 'NPR',
      year: 2020,
      plate: 'AK 41927',
      colour: 'white',
      boxLengthFt: null,
    }),
    position: { lat: 43.72, lng: -79.7 },
    online: true,
  },
  {
    key: 'devon',
    role: 'driver',
    status: 'active',
    email: email('devon'),
    displayName: 'Devon Clarke',
    phoneNumber: '+14165550155',
    phoneVerified: true,
    cityId: 'toronto',
    vehicle: vehicle({
      type: 'box_truck',
      make: 'Hino',
      model: '195',
      year: 2020,
      plate: 'AM 52038',
      colour: 'white',
      boxLengthFt: null,
      extras: ['liftgate'],
    }),
    position: { lat: 43.65, lng: -79.45 },
    online: true,
  },
  {
    key: 'lena',
    role: 'driver',
    status: 'pending',
    email: email('new.driver'),
    displayName: 'Lena Kowalski',
    phoneNumber: '+19055550156',
    phoneVerified: true,
    cityId: 'mississauga',
    vehicle: vehicle({
      type: 'suv',
      make: 'Honda',
      model: 'CR-V',
      year: 2020,
      plate: 'CNLT 902',
      colour: 'blue',
      boxLengthFt: null,
    }),
    position: { lat: 43.589, lng: -79.644 },
    online: false,
  },
];

/** Every demo account, staff first. */
export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  ...SEED_STAFF,
  ...SEED_CUSTOMERS,
  ...SEED_SUPPLIERS,
  ...SEED_DRIVERS,
];

/** An account by key; throws for an unknown key (a typo in a data file or a scenario). */
export function seedAccount(key: string): SeedAccount {
  const account = SEED_ACCOUNTS.find((candidate) => candidate.key === key);
  if (!account) throw new Error(`unknown seed account ${key}`);
  return account;
}

/** The OTP test numbers of MARKETPLACE §11: they always verify with 123456 (`OTP_TEST_NUMBERS`). */
export const SEED_OTP_TEST_NUMBERS = ['+14165550199', '+16475550199', '+19055550199'] as const;

/** The development support line of MARKETPLACE §11. */
export const SEED_SUPPORT_PHONE = '+14165550100';
