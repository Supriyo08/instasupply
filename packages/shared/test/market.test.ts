import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { haversineMeters } from '../src/geo';
import { audienceFor, audienceKey, MAX_ACTIVE_JOBS_PER_DRIVER } from '../src/jobs';
import {
  CITIES,
  CITY_IDS,
  CURRENCY,
  isInServiceArea,
  MARKET_ID,
  MARKET_TIME_ZONE,
  nearestCity,
  ONTARIO_HOLIDAYS,
  SERVICE_AREA,
  SUPPORT_HOURS,
  TAX,
  type CityId,
} from '../src/market';
import type { LatLng } from '../src/types';
import { VEHICLE_CLASSES, type VehicleClass } from '../src/vehicles';

// ---------- fixtures: the seed pins of §11.2 and §11.3 ----------

interface SeedPin {
  name: string;
  pin: LatLng;
  /** The `cityId` the seed data gives the document. */
  cityId: CityId;
}

const SEED_STORES: readonly SeedPin[] = [
  { name: 'kestrel-lumber', pin: { lat: 43.6966, lng: -79.5752 }, cityId: 'toronto' },
  { name: 'grainline-building', pin: { lat: 43.7655, lng: -79.2829 }, cityId: 'toronto' },
  { name: 'bluestone-drywall', pin: { lat: 43.7709, lng: -79.4912 }, cityId: 'toronto' },
  { name: 'voltway-electrical', pin: { lat: 43.6262, lng: -79.6143 }, cityId: 'mississauga' },
  { name: 'copperline-plumbing', pin: { lat: 43.801, lng: -79.499 }, cityId: 'vaughan' },
  { name: 'aircrest-hvac', pin: { lat: 43.8306, lng: -79.3598 }, cityId: 'markham' },
  { name: 'boltbin-hardware', pin: { lat: 43.7262, lng: -79.6885 }, cityId: 'brampton' },
  { name: 'glassmoor-glass', pin: { lat: 43.7102, lng: -79.3615 }, cityId: 'toronto' },
  { name: 'casingcraft-doors', pin: { lat: 43.847, lng: -79.399 }, cityId: 'richmond_hill' },
  { name: 'slatebridge-masonry', pin: { lat: 43.4441, lng: -79.688 }, cityId: 'oakville' },
  { name: 'quietcore-insulation', pin: { lat: 43.829, lng: -79.087 }, cityId: 'pickering' },
  { name: 'tapstone-bath', pin: { lat: 43.589, lng: -79.623 }, cityId: 'mississauga' },
  { name: 'brightrafter-lighting', pin: { lat: 43.644, lng: -79.403 }, cityId: 'toronto' },
  { name: 'cabinetwell-kitchens', pin: { lat: 43.817, lng: -79.522 }, cityId: 'vaughan' },
];

const SEED_JOBSITES: readonly SeedPin[] = [
  { name: 'Leslieville semi reno', pin: { lat: 43.6648, lng: -79.3405 }, cityId: 'toronto' },
  { name: 'Junction basement', pin: { lat: 43.6655, lng: -79.4636 }, cityId: 'toronto' },
  { name: 'Mimico laneway house', pin: { lat: 43.6163, lng: -79.4955 }, cityId: 'toronto' },
  { name: 'Home — Danforth', pin: { lat: 43.6866, lng: -79.3127 }, cityId: 'toronto' },
];

const storePin = (name: string): LatLng => {
  const store = SEED_STORES.find((candidate) => candidate.name === name);
  assert.ok(store, `no seed store called ${name}`);
  return store.pin;
};

/** What `nearestCity` would answer with city centres alone, the rule §1.5 says is not good enough. */
const nearestCentre = (point: LatLng): CityId =>
  CITY_IDS.reduce((best, cityId) =>
    haversineMeters(point, CITIES[cityId].center) < haversineMeters(point, CITIES[best].center)
      ? cityId
      : best,
  );

const VEHICLE_CLASS_LIST: readonly VehicleClass[] = [
  'car',
  'suv',
  'pickup',
  'cargo_van',
  'box_truck',
  'flatbed',
];

/** mulberry32: a small seeded generator, so every run draws the same "random" pins. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the market ----------

describe('market constants (§1.1, §1.5, §4.2)', () => {
  it('is one market: the GTA, priced in CAD with Ontario HST, on Toronto time', () => {
    assert.equal(MARKET_ID, 'gta');
    assert.equal(CURRENCY, 'CAD');
    assert.deepEqual(TAX, { label: 'HST', rateBps: 1300 });
    assert.equal(MARKET_TIME_ZONE, 'America/Toronto');
  });

  it('lists the 15 cities in the order of the security rules (§6.1 cityIds)', () => {
    assert.deepEqual(CITY_IDS, [
      'toronto',
      'mississauga',
      'brampton',
      'vaughan',
      'markham',
      'richmond_hill',
      'oakville',
      'burlington',
      'milton',
      'pickering',
      'ajax',
      'whitby',
      'oshawa',
      'newmarket',
      'aurora',
    ]);
    assert.deepEqual(Object.keys(CITIES), CITY_IDS);
  });

  it('has the city centres of §1.5', () => {
    assert.deepEqual(
      CITY_IDS.map((cityId) => [
        cityId,
        CITIES[cityId].name,
        CITIES[cityId].center.lat,
        CITIES[cityId].center.lng,
      ]),
      [
        ['toronto', 'Toronto', 43.6532, -79.3832],
        ['mississauga', 'Mississauga', 43.589, -79.6441],
        ['brampton', 'Brampton', 43.7315, -79.7624],
        ['vaughan', 'Vaughan', 43.8361, -79.4983],
        ['markham', 'Markham', 43.8561, -79.337],
        ['richmond_hill', 'Richmond Hill', 43.8828, -79.4403],
        ['oakville', 'Oakville', 43.4675, -79.6877],
        ['burlington', 'Burlington', 43.3255, -79.799],
        ['milton', 'Milton', 43.5183, -79.8774],
        ['pickering', 'Pickering', 43.8384, -79.0868],
        ['ajax', 'Ajax', 43.8509, -79.0204],
        ['whitby', 'Whitby', 43.8975, -78.9429],
        ['oshawa', 'Oshawa', 43.8971, -78.8658],
        ['newmarket', 'Newmarket', 44.0592, -79.4613],
        ['aurora', 'Aurora', 44.0065, -79.4504],
      ],
    );
  });

  it('gives Toronto its three anchors (North York, Scarborough, Etobicoke) and no other city any', () => {
    assert.deepEqual(CITIES.toronto.anchors, [
      { lat: 43.7615, lng: -79.4111 },
      { lat: 43.7731, lng: -79.2577 },
      { lat: 43.66, lng: -79.53 },
    ]);
    for (const cityId of CITY_IDS) {
      if (cityId !== 'toronto') assert.deepEqual(CITIES[cityId].anchors, [], cityId);
    }
  });

  it('lists the Ontario holidays of §4.2, in date order and once each', () => {
    assert.deepEqual(ONTARIO_HOLIDAYS, [
      '2026-01-01',
      '2026-02-16',
      '2026-04-03',
      '2026-05-18',
      '2026-07-01',
      '2026-08-03',
      '2026-09-07',
      '2026-10-12',
      '2026-12-25',
      '2026-12-26',
      '2026-12-28',
      '2027-01-01',
      '2027-02-15',
      '2027-03-26',
      '2027-05-24',
      '2027-07-01',
      '2027-08-02',
      '2027-09-06',
      '2027-10-11',
      '2027-12-25',
      '2027-12-26',
      '2027-12-27',
      '2027-12-28',
    ]);
    assert.deepEqual([...ONTARIO_HOLIDAYS].sort(), ONTARIO_HOLIDAYS);
    assert.equal(new Set(ONTARIO_HOLIDAYS).size, 23);
  });

  it('answers support Mon–Fri 07:00–18:00 and Sat 08:00–14:00, never on Sunday', () => {
    const weekday = { open: '07:00', close: '18:00' };
    assert.deepEqual(SUPPORT_HOURS, {
      mon: weekday,
      tue: weekday,
      wed: weekday,
      thu: weekday,
      fri: weekday,
      sat: { open: '08:00', close: '14:00' },
      sun: null,
    });
  });
});

describe('nearestCity (§1.5)', () => {
  it('files the Grainline, Bluestone and Kestrel pins under toronto', () => {
    assert.equal(nearestCity(storePin('grainline-building')), 'toronto');
    assert.equal(nearestCity(storePin('bluestone-drywall')), 'toronto');
    assert.equal(nearestCity(storePin('kestrel-lumber')), 'toronto');
  });

  it('files the Copperline, Aircrest and Voltway pins under vaughan, markham and mississauga', () => {
    assert.equal(nearestCity(storePin('copperline-plumbing')), 'vaughan');
    assert.equal(nearestCity(storePin('aircrest-hvac')), 'markham');
    assert.equal(nearestCity(storePin('voltway-electrical')), 'mississauga');
  });

  it('needs the anchors: with centres alone those three Toronto pins land in other cities', () => {
    // Scarborough → Markham, North York → Vaughan, north Etobicoke → Mississauga, as §1.5 warns.
    assert.equal(nearestCentre(storePin('grainline-building')), 'markham');
    assert.equal(nearestCentre(storePin('bluestone-drywall')), 'vaughan');
    assert.equal(nearestCentre(storePin('kestrel-lumber')), 'mississauga');
    // The three pins outside Toronto do not depend on the anchors.
    assert.equal(nearestCentre(storePin('copperline-plumbing')), 'vaughan');
    assert.equal(nearestCentre(storePin('aircrest-hvac')), 'markham');
    assert.equal(nearestCentre(storePin('voltway-electrical')), 'mississauga');
  });

  it('answers each city for its own centre, and toronto for each anchor', () => {
    for (const cityId of CITY_IDS) assert.equal(nearestCity(CITIES[cityId].center), cityId);
    for (const anchor of CITIES.toronto.anchors) assert.equal(nearestCity(anchor), 'toronto');
  });

  it('files every seed jobsite of §11.2 under toronto', () => {
    for (const site of SEED_JOBSITES) assert.equal(nearestCity(site.pin), site.cityId, site.name);
  });

  it('agrees with the seed city of every store of §11.3 but the one on a border', () => {
    assert.deepEqual(
      SEED_STORES.filter((store) => nearestCity(store.pin) !== store.cityId).map((store) => store.name),
      ['casingcraft-doors'],
    );
  });

  it('is approximate near a border: the Casingcraft pin in Richmond Hill reads as markham', () => {
    // West Beaver Creek Rd & Hwy 7 is about 5.07 km from Markham's centre and 5.18 km from Richmond
    // Hill's. That is why a store's cityId is set by staff and a geocoded municipality wins (§1.5).
    const pin = storePin('casingcraft-doors');
    assert.equal(nearestCity(pin), 'markham');
    assert.equal(Math.round(haversineMeters(pin, CITIES.markham.center)), 5074);
    assert.equal(Math.round(haversineMeters(pin, CITIES.richmond_hill.center)), 5178);
  });

  it('is the city of the nearest centre or anchor for 2 000 seeded pins across the service area', () => {
    // Every place a pin can be nearest to, with its city, in the order of §1.5.
    const places = CITY_IDS.flatMap((cityId) =>
      [CITIES[cityId].center, ...CITIES[cityId].anchors].map((place) => ({ cityId, place })),
    );
    const random = mulberry32(20261119);
    const counts = new Map<CityId, number>();
    for (let pin = 0; pin < 2000; pin += 1) {
      const point = {
        lat: SERVICE_AREA.south + random() * (SERVICE_AREA.north - SERVICE_AREA.south),
        lng: SERVICE_AREA.west + random() * (SERVICE_AREA.east - SERVICE_AREA.west),
      };
      const distances = places.map(({ place }) => haversineMeters(point, place));
      const nearest = places[distances.indexOf(Math.min(...distances))];
      assert.ok(nearest);
      const cityId = nearestCity(point);
      assert.equal(cityId, nearest.cityId, JSON.stringify(point));
      counts.set(cityId, (counts.get(cityId) ?? 0) + 1);
    }
    // All 15 cities get pins, so none is shadowed by a neighbour's centre or by Toronto's anchors.
    assert.deepEqual([...counts.keys()].sort(), [...CITY_IDS].sort());
  });

  it('answers for a valid point outside the service area too', () => {
    // Downtown Barrie is not served, but the question "which city is nearest" still has an answer.
    const barrie = { lat: 44.3894, lng: -79.6903 };
    assert.equal(isInServiceArea(barrie), false);
    assert.equal(nearestCity(barrie), 'newmarket');
  });

  it('refuses a pin without usable coordinates', () => {
    const broken: unknown[] = [
      { lat: Number.NaN, lng: -79.4 },
      { lat: 43.7, lng: Number.POSITIVE_INFINITY },
      { lat: 91, lng: -79.4 },
      { lat: 43.7, lng: -181 },
      { lat: '43.7', lng: '-79.4' },
      { lat: 43.7 },
      null,
      undefined,
    ];
    for (const point of broken) {
      assert.throws(() => nearestCity(point as LatLng), RangeError, JSON.stringify(point));
    }
  });

  it('does not change the point or the city table', () => {
    const point = Object.freeze({ lat: 43.7, lng: -79.4 });
    const before = JSON.stringify(CITIES);
    assert.equal(nearestCity(point), 'toronto');
    assert.equal(JSON.stringify(CITIES), before);
  });
});

describe('isInServiceArea and SERVICE_AREA (§1.3, §6.1)', () => {
  const { south, west, north, east } = SERVICE_AREA;

  it('is the box the security rules check', () => {
    assert.deepEqual(SERVICE_AREA, { south: 43.25, west: -80, north: 44.15, east: -78.75 });
  });

  it('includes its four corners and the middle of each edge', () => {
    const midLat = (south + north) / 2;
    const midLng = (west + east) / 2;
    const onTheEdge: LatLng[] = [
      { lat: south, lng: west },
      { lat: south, lng: east },
      { lat: north, lng: west },
      { lat: north, lng: east },
      { lat: south, lng: midLng },
      { lat: north, lng: midLng },
      { lat: midLat, lng: west },
      { lat: midLat, lng: east },
    ];
    for (const point of onTheEdge) assert.equal(isInServiceArea(point), true, JSON.stringify(point));
    assert.equal(isInServiceArea({ lat: midLat, lng: midLng }), true);
  });

  it('excludes a point a hair outside each edge', () => {
    const justOutside: LatLng[] = [
      { lat: 43.249999, lng: -79.4 },
      { lat: 44.150001, lng: -79.4 },
      { lat: 43.7, lng: -80.000001 },
      { lat: 43.7, lng: -78.749999 },
    ];
    for (const point of justOutside) assert.equal(isInServiceArea(point), false, JSON.stringify(point));
    // The same four points pulled back onto the edge are inside.
    assert.equal(isInServiceArea({ lat: 43.25, lng: -79.4 }), true);
    assert.equal(isInServiceArea({ lat: 44.15, lng: -79.4 }), true);
    assert.equal(isInServiceArea({ lat: 43.7, lng: -80 }), true);
    assert.equal(isInServiceArea({ lat: 43.7, lng: -78.75 }), true);
  });

  it('holds every city centre and anchor, every seed store and every seed jobsite', () => {
    for (const cityId of CITY_IDS) {
      assert.equal(isInServiceArea(CITIES[cityId].center), true, cityId);
      for (const anchor of CITIES[cityId].anchors) assert.equal(isInServiceArea(anchor), true, cityId);
    }
    for (const place of [...SEED_STORES, ...SEED_JOBSITES]) {
      assert.equal(isInServiceArea(place.pin), true, place.name);
    }
  });

  it('excludes towns around the GTA', () => {
    const outside: Record<string, LatLng> = {
      Barrie: { lat: 44.3894, lng: -79.6903 },
      Kitchener: { lat: 43.4516, lng: -80.4925 },
      'Niagara Falls': { lat: 43.0896, lng: -79.0849 },
      Peterborough: { lat: 44.3091, lng: -78.3197 },
      Bowmanville: { lat: 43.9126, lng: -78.6877 },
    };
    for (const [town, point] of Object.entries(outside)) assert.equal(isInServiceArea(point), false, town);
  });

  it('is false, never an error, for anything that is not a point', () => {
    const notPoints: unknown[] = [
      { lat: Number.NaN, lng: -79.4 },
      { lat: 43.7, lng: Number.NaN },
      { lat: Number.POSITIVE_INFINITY, lng: -79.4 },
      { lat: '43.7', lng: '-79.4' },
      { lat: 43.7 },
      {},
      [],
      '43.7,-79.4',
      null,
      undefined,
    ];
    for (const value of notPoints)
      assert.equal(isInServiceArea(value as LatLng), false, JSON.stringify(value));
  });
});

// ---------- the job board (jobs.ts) ----------

describe('job-board audiences (§2.4)', () => {
  it('writes a key the way the security rules do: "{cityId}:{capacityClass}"', () => {
    assert.equal(audienceKey('toronto', 'pickup'), 'toronto:pickup');
    assert.equal(audienceKey('richmond_hill', 'cargo_van'), 'richmond_hill:cargo_van');
  });

  it('opens a pickup job to pickups and every larger class', () => {
    assert.deepEqual(audienceFor(['toronto'], 'pickup', null), [
      'toronto:pickup',
      'toronto:cargo_van',
      'toronto:box_truck',
      'toronto:flatbed',
    ]);
  });

  it('lists a city once when the store and the jobsite share it', () => {
    // Kestrel (toronto) → Leslieville (toronto).
    assert.deepEqual(audienceFor(['toronto', 'toronto'], 'box_truck', null), [
      'toronto:box_truck',
      'toronto:flatbed',
    ]);
  });

  it('covers the store city and the jobsite city, in the order given', () => {
    // Voltway (mississauga) → Leslieville (toronto), a load that fits a car.
    assert.deepEqual(audienceFor(['mississauga', 'toronto'], 'car', null), [
      'mississauga:car',
      'mississauga:suv',
      'mississauga:pickup',
      'mississauga:cargo_van',
      'mississauga:box_truck',
      'mississauga:flatbed',
      'toronto:car',
      'toronto:suv',
      'toronto:pickup',
      'toronto:cargo_van',
      'toronto:box_truck',
      'toronto:flatbed',
    ]);
  });

  it('stops at the largest vehicle the jobsite can take', () => {
    // Junction basement: "Max vehicle: cargo_van" (§11.2).
    assert.deepEqual(audienceFor(['toronto'], 'pickup', 'cargo_van'), [
      'toronto:pickup',
      'toronto:cargo_van',
    ]);
    assert.deepEqual(audienceFor(['brampton', 'toronto'], 'suv', 'pickup'), [
      'brampton:suv',
      'brampton:pickup',
      'toronto:suv',
      'toronto:pickup',
    ]);
    // A limit of flatbed is no limit.
    assert.deepEqual(audienceFor(['toronto'], 'pickup', 'flatbed'), audienceFor(['toronto'], 'pickup', null));
  });

  it('is a single class when the site limit is the job class, and flatbed jobs go to flatbeds only', () => {
    assert.deepEqual(audienceFor(['toronto'], 'cargo_van', 'cargo_van'), ['toronto:cargo_van']);
    assert.deepEqual(audienceFor(['oakville', 'toronto'], 'flatbed', null), [
      'oakville:flatbed',
      'toronto:flatbed',
    ]);
  });

  it('is empty when the job needs more than the site allows, or has no city', () => {
    assert.deepEqual(audienceFor(['toronto'], 'box_truck', 'cargo_van'), []);
    assert.deepEqual(audienceFor(['toronto', 'vaughan'], 'suv', 'car'), []);
    assert.deepEqual(audienceFor([], 'car', null), []);
  });

  it('shows the seed drivers of §11.1 the jobs they can take, and only those', () => {
    const sees = (audience: string[], cityId: CityId, capacityClass: VehicleClass) =>
      audience.includes(audienceKey(cityId, capacityClass));

    // Kestrel (toronto) → Leslieville (toronto), a pickup load.
    const lumber = audienceFor(['toronto', 'toronto'], 'pickup', null);
    assert.equal(sees(lumber, 'toronto', 'pickup'), true, 'Marco, pickup');
    assert.equal(sees(lumber, 'toronto', 'cargo_van'), true, 'Aisha, cargo van');
    assert.equal(sees(lumber, 'toronto', 'box_truck'), true, 'Devon, box truck');
    assert.equal(sees(lumber, 'toronto', 'car'), false, 'Tom, car: too small');
    assert.equal(sees(lumber, 'brampton', 'flatbed'), false, 'Gurpreet: another city');
    assert.equal(sees(lumber, 'mississauga', 'suv'), false, 'Lena: another city and too small');

    // Boltbin (brampton) → Mimico (toronto): drivers of both cities see it.
    const hardware = audienceFor(['brampton', 'toronto'], 'car', null);
    assert.equal(sees(hardware, 'brampton', 'flatbed'), true, 'Gurpreet');
    assert.equal(sees(hardware, 'toronto', 'car'), true, 'Tom');

    // Bluestone (toronto) → Junction basement (toronto), cargo van max.
    const drywall = audienceFor(['toronto', 'toronto'], 'pickup', 'cargo_van');
    assert.equal(sees(drywall, 'toronto', 'pickup'), true, 'Marco');
    assert.equal(sees(drywall, 'toronto', 'cargo_van'), true, 'Aisha');
    assert.equal(sees(drywall, 'toronto', 'box_truck'), false, 'Devon: too large for the lane');
  });

  it('holds exactly the classes that can carry the job and fit the site, for every combination', () => {
    const rank = (vehicleClass: VehicleClass) => VEHICLE_CLASSES[vehicleClass].rank;
    const citySets: CityId[][] = [
      ['toronto'],
      ['aurora', 'newmarket'],
      ['whitby', 'whitby'],
      ['ajax', 'oshawa', 'ajax'],
    ];
    for (const cityIds of citySets) {
      for (const jobClass of VEHICLE_CLASS_LIST) {
        for (const siteMax of [null, ...VEHICLE_CLASS_LIST]) {
          const expected: string[] = [];
          for (const cityId of new Set(cityIds)) {
            for (const capacityClass of VEHICLE_CLASS_LIST) {
              const carries = rank(capacityClass) >= rank(jobClass);
              const fits = siteMax === null || rank(capacityClass) <= rank(siteMax);
              if (carries && fits) expected.push(`${cityId}:${capacityClass}`);
            }
          }
          const audience = audienceFor(cityIds, jobClass, siteMax);
          assert.deepEqual(audience, expected, `${cityIds.join('+')} ${jobClass} max ${String(siteMax)}`);
          assert.equal(new Set(audience).size, audience.length, 'no entry twice');
        }
      }
    }
  });

  it('follows the class ranks of §3.3: car 0 … flatbed 5', () => {
    assert.deepEqual(
      VEHICLE_CLASS_LIST.map((vehicleClass) => VEHICLE_CLASSES[vehicleClass].rank),
      [0, 1, 2, 3, 4, 5],
    );
  });

  it('refuses a vehicle class that is not in the §3.3 table', () => {
    assert.throws(() => audienceFor(['toronto'], 'bike' as VehicleClass, null), RangeError);
    assert.throws(() => audienceFor(['toronto'], 'car', 'van' as VehicleClass), RangeError);
    assert.throws(() => audienceFor(['toronto'], 'toString' as VehicleClass, null), RangeError);
  });

  it('does not change the city list it is given', () => {
    const cityIds: readonly CityId[] = Object.freeze<CityId[]>(['toronto', 'markham', 'toronto']);
    assert.deepEqual(audienceFor(cityIds, 'flatbed', null), ['toronto:flatbed', 'markham:flatbed']);
    assert.deepEqual(cityIds, ['toronto', 'markham', 'toronto']);
  });

  it('lets a driver hold at most 4 active jobs (§5.5.3)', () => {
    assert.equal(MAX_ACTIVE_JOBS_PER_DRIVER, 4);
  });
});
