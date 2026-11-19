/**
 * Catalogue reference data (§1.5), product ids (§1.1) and search keys (§5.6), on the seed listings of
 * §11.4 and the example searches the site shows (§7.3).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  CATEGORIES,
  CATEGORY_IDS,
  LOW_STOCK_THRESHOLD,
  SEARCH_SYNONYMS,
  SELL_UNITS,
  STORE_SPECIALTY_ART,
  STORE_SPECIALTY_LABELS,
  SUGGEST_STORE_INTERESTS,
  WEEKDAYS,
  availableQty,
  buildSearchTerms,
  discountPercent,
  isCategoryId,
  isSellUnit,
  isStoreId,
  productIdFor,
  searchKeyFor,
  searchKeysFor,
  shortStoreName,
  skuSlug,
  type CategoryId,
} from '../src';

/** A small seeded generator (mulberry32): the random cases are the same on every run. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- seed listings (§11.4) ----------

type Listing = [
  sku: string,
  name: string,
  categoryId: CategoryId,
  size: string | null,
  familyKey: string | null,
];

const LISTINGS: Listing[] = [
  ['KLY-SPF248', '2x4x8 SPF stud, kiln-dried', 'wood', '2 in × 4 in × 8 ft', 'spf-2x4x8'],
  ['GBC-SPF248', '2x4x8 SPF stud', 'wood', null, 'spf-2x4x8'],
  ['KLY-PT2612', 'Pressure-treated 2x6, 12 ft', 'wood', null, null],
  ['KLY-OSB716', 'OSB sheathing 7/16 in, 4×8', 'wood', null, null],
  ['KLY-PLY12', 'Plywood CDX 1/2 in, 4×8', 'wood', null, null],
  ['KLY-SUB34', 'T&G OSB subfloor 3/4 in, 4×8', 'wood', null, null],
  ['KLY-IJ916', 'I-joist 9-1/2 in, 16 ft', 'wood', null, null],
  ['KLY-REBAR', 'Rebar 10M, 20 ft', 'masonry', null, null],
  ['KLY-CONC30', 'Concrete mix, 30 kg', 'masonry', null, null],
  ['KLY-ADH', 'Construction adhesive, 300 ml', 'adhesives', null, 'const-adhesive-300ml'],
  ['KLY-SCR212', 'Subfloor screws #9 × 2-1/2 in, 5 lb', 'fasteners', null, 'subfloor-screws-212-5lb'],
  ['KLY-JH28', 'Joist hanger 2x8, galvanized', 'fasteners', null, 'joist-hanger-2x8'],
  ['BDP-DW12', 'Drywall 1/2 in regular, 4×8', 'drywall', null, 'drywall-12-4x8'],
  ['BDP-DW58X', 'Drywall 5/8 in Type X, 4×8', 'drywall', null, null],
  ['BDP-JC17', 'All-purpose joint compound, 17 L', 'drywall', null, null],
  ['BDP-CB8', 'Metal corner bead, 8 ft', 'drywall', null, null],
  ['BDP-TAPE', 'Paper drywall tape, 500 ft', 'drywall', null, null],
  ['VES-NMD142', 'NMD90 14/2 cable, 75 m', 'electrical', null, null],
  ['VES-EMT12', 'EMT conduit 1/2 in, 10 ft', 'electrical', null, null],
  ['VES-POT', '4 in slim LED pot light, 4-pack', 'electrical', null, null],
  ['CPD-CU34L', 'Copper pipe 3/4 in Type L, 12 ft', 'plumbing', null, null],
  ['CPD-PEX12', 'PEX-A pipe 1/2 in, 100 ft coil', 'plumbing', null, null],
  ['GBC-FOAM', 'Spray foam, low expansion, 340 g', 'insulation', null, null],
  ['GBC-R20', 'Fibreglass batts R20, 15 in (78.3 sq ft)', 'insulation', null, null],
  ['AHR-FILTER', 'Furnace filter MERV 11, 16×25×1 in', 'hvac', null, null],
  ['BFH-BOLTS', 'Hex bolts and nuts 3/8 × 4 in, 25-pack', 'hardware', null, null],
  ['BFH-HINGE', 'Door hinges 3-1/2 in, satin nickel, 3-pack', 'hardware', null, null],
  ['BFH-DECK', 'Deck screws #10 × 2-1/2 in, 5 lb', 'fasteners', null, null],
  ['SMR-SHING', 'Architectural shingles, bundle (32.8 sq ft)', 'roofing', null, null],
  ['GGM-MIRROR', 'Bevelled mirror, 24 × 36 in', 'glass', null, null],
  ['CDT-DOOR30', 'Prehung interior door 30 × 80 in, shaker', 'doors', null, null],
  ['GBC-HAT', 'Hard hat, Type 1 Class E', 'safety', null, null],
  ['CPD-WH40', 'Electric water heater, 40 gal', 'appliances', null, null],
];

/**
 * The terms `onProductWritten` stores for a listing (§5.6): the name, then the SKU, the size, the
 * category name with its synonyms and the family key. No seed listing has a brand.
 */
function termsFor([sku, name, categoryId, size, familyKey]: Listing): string[] {
  const category = CATEGORIES[categoryId];
  const extra = [sku, size, category.name, ...category.synonyms, familyKey];
  return buildSearchTerms(
    name,
    extra.filter((part): part is string => part !== null),
  );
}

const INDEX = LISTINGS.map((listing) => ({ sku: listing[0], terms: new Set(termsFor(listing)) }));

/** The SKUs of the seed listings a search finds: those whose terms hold every key of what was typed. */
function find(typed: string): string[] {
  const keys = searchKeysFor(typed);
  if (keys.length === 0) return [];
  return INDEX.filter((entry) => keys.every((key) => entry.terms.has(key))).map((entry) => entry.sku);
}

const DRYWALL_CATEGORY = ['BDP-DW12', 'BDP-DW58X', 'BDP-JC17', 'BDP-CB8', 'BDP-TAPE'];

/** docs/MARKETPLACE.md, whether the tests are started in this package or at the repository root. */
const SPEC_PATH = ['../../docs/MARKETPLACE.md', 'docs/MARKETPLACE.md']
  .map((candidate) => resolve(candidate))
  .find((candidate) => existsSync(candidate));

// ---------- reference data ----------

describe('catalogue reference data', () => {
  it('has the 25 categories in tile order', () => {
    assert.equal(CATEGORY_IDS.length, 25);
    assert.equal(new Set(CATEGORY_IDS).size, 25);
    assert.equal(CATEGORY_IDS[0], 'adhesives');
    assert.equal(CATEGORY_IDS[24], 'outdoors');
    CATEGORY_IDS.forEach((id, index) => {
      assert.equal(CATEGORIES[id].id, id);
      assert.equal(CATEGORIES[id].sortOrder, index + 1, id);
      assert.equal(CATEGORIES[id].iconKey, `cat-${id}`);
      assert.equal(CATEGORIES[id].active, true);
    });
  });

  it('lists the categories exactly as the security rules do', () => {
    // The `d.categoryId in [...]` list of `isValidProduct` (§6.3), in its order.
    assert.deepEqual(
      [...CATEGORY_IDS],
      [
        'adhesives',
        'fasteners',
        'tools',
        'safety',
        'wood',
        'drywall',
        'insulation',
        'masonry',
        'roofing',
        'electrical',
        'plumbing',
        'hvac',
        'doors',
        'windows',
        'glass',
        'hardware',
        'paint',
        'flooring',
        'wall-decor',
        'cleaning',
        'storage',
        'bath',
        'kitchen',
        'appliances',
        'outdoors',
      ],
    );
  });

  it('has every row of the category table of the spec, cell by cell', (t) => {
    if (SPEC_PATH === undefined) {
      t.skip('docs/MARKETPLACE.md is not next to this package');
      return;
    }
    // §1.5: | id | name | default kg | default cm (l×w×h) | synonyms (search) |
    const lines = readFileSync(SPEC_PATH, 'utf8').split('\n');
    const header = lines.findIndex((line) => line.startsWith('| id | name | default kg'));
    assert.ok(header > 0, 'the category table is not in the spec');
    const rows: string[][] = [];
    for (let index = header + 2; lines[index]?.startsWith('|'); index += 1) {
      rows.push(
        (lines[index] ?? '')
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    }
    assert.deepEqual(
      rows.map((row) => row[0]),
      [...CATEGORY_IDS],
    );
    for (const [id = '', name, kilograms, size = '', synonyms = ''] of rows) {
      assert.ok(isCategoryId(id), id);
      const category = CATEGORIES[id];
      const [l, w, h] = size.split('×').map(Number);
      assert.equal(category.name, name, id);
      assert.equal(category.defaultWeightKg, Number(kilograms), id);
      assert.deepEqual(category.defaultDimsCm, { l, w, h }, id);
      assert.deepEqual(
        category.synonyms,
        synonyms.split(',').map((word) => word.trim()),
        id,
      );
    }
  });

  it('carries the shipping defaults and tints of the category table', () => {
    assert.equal(CATEGORIES.drywall.name, 'Drywall');
    assert.equal(CATEGORIES.drywall.defaultWeightKg, 25);
    assert.deepEqual(CATEGORIES.drywall.defaultDimsCm, { l: 244, w: 122, h: 1.3 });
    assert.deepEqual(CATEGORIES.drywall.synonyms, ['gypsum', 'sheetrock', 'gyprock', 'mud']);
    assert.equal(CATEGORIES['wall-decor'].name, 'Wall Decor');
    assert.equal(CATEGORIES.safety.defaultWeightKg, 0.3);
    assert.deepEqual(CATEGORIES.paint.defaultDimsCm, { l: 20, w: 20, h: 25 });
    assert.deepEqual(CATEGORIES.appliances.synonyms, ['range', 'water heater']);
    // The nine pastels repeat from the tenth tile on.
    assert.equal(CATEGORIES.adhesives.tint, '#E6F2EA');
    assert.equal(CATEGORIES.roofing.tint, '#E8F5DA');
    assert.equal(CATEGORIES.electrical.tint, '#E6F2EA');
    assert.equal(CATEGORIES.outdoors.tint, '#D2EFFF');
    assert.equal(new Set(CATEGORY_IDS.map((id) => CATEGORIES[id].tint)).size, 9);
  });

  it('recognises category ids and sell units, and nothing else', () => {
    assert.equal(isCategoryId('wall-decor'), true);
    assert.equal(isCategoryId('fruits'), false);
    assert.equal(isCategoryId(7), false);
    assert.equal(SELL_UNITS.length, 13);
    assert.equal(isSellUnit('sheet'), true);
    assert.equal(isSellUnit('kg'), false);
    assert.deepEqual([...WEEKDAYS], ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('has the 24 store interests of the site, in its order', (t) => {
    assert.equal(SUGGEST_STORE_INTERESTS.length, 24);
    assert.equal(new Set(SUGGEST_STORE_INTERESTS).size, 24);
    assert.equal(SUGGEST_STORE_INTERESTS[0], 'Lumber');
    assert.equal(SUGGEST_STORE_INTERESTS[6], 'Concrete & Masonry');
    assert.equal(SUGGEST_STORE_INTERESTS[23], 'Appliances');
    if (SPEC_PATH === undefined) {
      t.skip('docs/MARKETPLACE.md is not next to this package');
      return;
    }
    // §1.5 lists the names in one paragraph: "… readable from the page): Lumber, Drywall, …, Appliances."
    const spec = readFileSync(SPEC_PATH, 'utf8');
    const from = spec.indexOf('**`SUGGEST_STORE_INTERESTS`**');
    const paragraph = spec.slice(from, spec.indexOf('\n\n', from)).replace(/\s+/g, ' ');
    const names = paragraph
      .slice(paragraph.indexOf('page): ') + 'page): '.length)
      .replace(/\.$/, '')
      .split(', ');
    assert.deepEqual([...SUGGEST_STORE_INTERESTS], names);
  });

  it('names the 13 store specialties as the site does, each with its storefront drawing', () => {
    assert.deepEqual(STORE_SPECIALTY_LABELS, {
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
    });
    // §12.7: ten drawings for thirteen specialties.
    assert.deepEqual(STORE_SPECIALTY_ART, {
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
    });
    assert.equal(new Set(Object.values(STORE_SPECIALTY_ART)).size, 10);
  });
});

describe('shortStoreName', () => {
  it('uses the first word, as the sentences of §4.3 and §4.4 do', () => {
    assert.equal(shortStoreName('Kestrel Lumber Yard'), 'Kestrel');
    assert.equal(shortStoreName('  Bluestone Drywall & Paint '), 'Bluestone');
    assert.equal(shortStoreName('Casingcraft'), 'Casingcraft');
  });

  it('keeps a name that starts with an article whole, and never returns an empty name', () => {
    assert.equal(shortStoreName('The Tile Shop'), 'The Tile Shop');
    assert.equal(shortStoreName('a Better Bolt'), 'a Better Bolt');
    assert.equal(shortStoreName('   '), 'The store');
  });
});

describe('product helpers', () => {
  it('shows a discount only when the compare-at price is higher', () => {
    assert.equal(discountPercent({ priceCents: 18_900, compareAtCents: 22_000 }), 14);
    // The two seed deals: $64.98 from $74.98 and $72.98 from $79.98.
    assert.equal(discountPercent({ priceCents: 6_498, compareAtCents: 7_498 }), 13);
    assert.equal(discountPercent({ priceCents: 7_298, compareAtCents: 7_998 }), 9);
    // Exactly half a percent rounds up: 199 of 200 is 0.5 % off.
    assert.equal(discountPercent({ priceCents: 199, compareAtCents: 200 }), 1);
    assert.equal(discountPercent({ priceCents: 10_000, compareAtCents: null }), null);
    assert.equal(discountPercent({ priceCents: 10_000, compareAtCents: 10_000 }), null);
    assert.equal(discountPercent({ priceCents: 10_000, compareAtCents: 9_000 }), null);
  });

  it('never sells what open orders already hold', () => {
    assert.equal(availableQty({ stockOnHand: 12, reserved: 5 }), 7);
    assert.equal(availableQty({ stockOnHand: 4, reserved: 4 }), 0);
    assert.equal(availableQty({ stockOnHand: 3, reserved: 9 }), 0);
    assert.equal(LOW_STOCK_THRESHOLD, 10);
  });
});

// ---------- product ids (§1.1) ----------

describe('product ids', () => {
  it('turns a SKU into its slug', () => {
    assert.equal(skuSlug('KLY-SPF248'), 'kly-spf248');
    assert.equal(skuSlug('BDP-DW58X'), 'bdp-dw58x');
    assert.equal(skuSlug('DW 5/8 X'), 'dw-5-8-x');
    assert.equal(skuSlug('ab__cd..ef'), 'ab-cd-ef');
    assert.equal(skuSlug('  cpd-cu34l '), 'cpd-cu34l');
    assert.equal(skuSlug('#9-SCREW'), '-9-screw');
    assert.equal(skuSlug('40'), '40');
  });

  it('builds the listing id from the store and the SKU', () => {
    assert.equal(productIdFor('kestrel-lumber', 'KLY-SPF248'), 'kestrel-lumber--kly-spf248');
    assert.equal(productIdFor('bluestone-drywall', 'BDP-DW12'), 'bluestone-drywall--bdp-dw12');
    assert.equal(productIdFor('boltbin-hardware', 'BFH SCR 2-1/2'), 'boltbin-hardware--bfh-scr-2-1-2');
  });

  it('lets the rules read the store back from every id', () => {
    // §6.3: `productId.split('--')[0] == request.resource.data.storeId`.
    const skus = [...LISTINGS.map(([sku]) => sku), '#9-SCREW', '--odd--sku--', 'A--B', '9', 'é'];
    for (const storeId of ['kestrel-lumber', 'store-24-7', 'abc']) {
      assert.equal(isStoreId(storeId), true);
      for (const sku of skus) {
        const id = productIdFor(storeId, sku);
        assert.equal(id.split('--')[0], storeId, id);
        // A slug never holds the separator itself, so the SKU part cannot be mistaken for a store.
        assert.equal(skuSlug(sku).includes('--'), false, sku);
        assert.match(skuSlug(sku), /^[a-z0-9-]+$/, sku);
      }
    }
  });
});

// ---------- search keys (§5.6) ----------

describe('buildSearchTerms', () => {
  it('stores every prefix of a size, so 2x and 2x4 find 2x4x8', () => {
    assert.deepEqual(buildSearchTerms('2x4x8 SPF stud, kiln-dried', []), [
      '2x',
      '2x4',
      '2x4x',
      '2x4x8',
      'sp',
      'spf',
      'st',
      'stu',
      'stud',
      'ki',
      'kil',
      'kiln',
      'dr',
      'dri',
      'drie',
      'dried',
    ]);
  });

  it('keeps a fraction as one word', () => {
    assert.deepEqual(buildSearchTerms('Drywall 1/2 in regular, 4×8', []), [
      'dr',
      'dry',
      'dryw',
      'drywa',
      'drywal',
      'drywall',
      '1/',
      '1/2',
      'in',
      're',
      'reg',
      'regu',
      'regul',
      'regula',
      'regular',
      '4x',
      '4x8',
    ]);
    assert.deepEqual(buildSearchTerms('OSB 7/16 in', []), ['os', 'osb', '7/', '7/1', '7/16', 'in']);
    assert.deepEqual(buildSearchTerms('3/4" Type L', []), ['3/', '3/4', 'ty', 'typ', 'type']);
    assert.deepEqual(buildSearchTerms('NMD90 14/2', []), ['nm', 'nmd', 'nmd9', 'nmd90', '14', '14/', '14/2']);
    // The characters a price list pastes in read like the typed ones.
    assert.deepEqual(buildSearchTerms('Plywood ¾ in', []), [
      'pl',
      'ply',
      'plyw',
      'plywo',
      'plywoo',
      'plywood',
      '3/',
      '3/4',
      'in',
    ]);
    assert.deepEqual(buildSearchTerms('1⁄2 in', []), ['1/', '1/2', 'in']);
  });

  it('keeps a metric size such as 10M as one word', () => {
    assert.deepEqual(buildSearchTerms('Rebar 10M, 20 ft', []), [
      're',
      'reb',
      'reba',
      'rebar',
      '10',
      '10m',
      '20',
      'ft',
    ]);
    assert.deepEqual(buildSearchTerms('R20', []), ['r2', 'r20']);
  });

  it('stores a plural also in its singular', () => {
    assert.deepEqual(buildSearchTerms('Studs', []), ['st', 'stu', 'stud', 'studs']);
    assert.deepEqual(buildSearchTerms('Boxes', []), ['bo', 'box', 'boxe', 'boxes']);
    assert.deepEqual(buildSearchTerms('Batteries', []), [
      'ba',
      'bat',
      'batt',
      'batte',
      'batter',
      'batteri',
      'batterie',
      'batteries',
      'battery',
    ]);
    // Not plurals: nothing is added or cut.
    assert.deepEqual(buildSearchTerms('Glass', []), ['gl', 'gla', 'glas', 'glass']);
    assert.deepEqual(buildSearchTerms('ABS', []), ['ab', 'abs']);
  });

  it('reads a size the same however it is written', () => {
    const joined = buildSearchTerms('2x4x8', []);
    for (const written of [
      '2×4×8',
      '2 x 4 x 8',
      '2 X 4 X 8',
      '2" x 4" x 8\'',
      // The inch and foot marks a phone keyboard or a word processor puts in.
      '2” x 4” x 8’',
      '2″ × 4″ × 8′',
      '2 in × 4 in × 8 ft',
      '2 in. x 4 in. x 8 ft.',
      '2in x 4in x 8',
      '2inx4inx8ft',
    ]) {
      const terms = buildSearchTerms(written, []);
      for (const key of joined) assert.ok(terms.includes(key), `${written} has no ${key}`);
      assert.equal(searchKeyFor(written), '2x4x8', written);
    }
    assert.deepEqual(buildSearchTerms('SPF stud', ['2 in × 4 in × 8 ft']), [
      'sp',
      'spf',
      'st',
      'stu',
      'stud',
      '2x',
      '2x4',
      '2x4x',
      '2x4x8',
      'ft',
    ]);
    assert.deepEqual(buildSearchTerms('48 mm × 55 m', []), ['48', '48x', '48x5', '48x55', '55']);
  });

  it('stores a size also under each of its parts', () => {
    assert.deepEqual(buildSearchTerms('16×25×1 in', []), [
      '16',
      '16x',
      '16x2',
      '16x25',
      '16x25x',
      '16x25x1',
      '25',
      'in',
    ]);
    assert.deepEqual(buildSearchTerms('3/8 × 4 in', []), ['3/', '3/8', '3/8x', '3/8x4', 'in']);
    assert.deepEqual(buildSearchTerms('#9 × 2-1/2 in', []), [
      '9x',
      '9x2',
      '9x2-',
      '9x2-1',
      '9x2-1/',
      '9x2-1/2',
      '1/',
      '1/2',
      'in',
    ]);
  });

  it('files a whole number and a fraction under the fraction, with or without a dash', () => {
    assert.deepEqual(buildSearchTerms('I-joist 9-1/2 in', []), [
      'jo',
      'joi',
      'jois',
      'joist',
      '1/',
      '1/2',
      'in',
    ]);
    assert.deepEqual(buildSearchTerms('I-joist 9 1/2 in', []), [
      'jo',
      'joi',
      'jois',
      'joist',
      '1/',
      '1/2',
      'in',
    ]);
    assert.deepEqual(buildSearchTerms('2½ in', []), ['1/', '1/2', 'in']);
  });

  it('adds the extra texts after the name and skips what is missing', () => {
    assert.deepEqual(buildSearchTerms('Stud', ['Kestrel', 'KLY-SPF248', 'Wood', 'lumber']), [
      'st',
      'stu',
      'stud',
      'ke',
      'kes',
      'kest',
      'kestr',
      'kestre',
      'kestrel',
      'kl',
      'kly',
      'sp',
      'spf',
      'spf2',
      'spf24',
      'spf248',
      'wo',
      'woo',
      'wood',
      'lu',
      'lum',
      'lumb',
      'lumbe',
      'lumber',
    ]);
    assert.deepEqual(buildSearchTerms('', []), []);
    assert.deepEqual(buildSearchTerms('A & B, 8 ft', []), ['ft']);
    // A listing without a brand: a caller that is not type-checked passes null.
    const withGaps = [null, 'Wood', undefined] as unknown as string[];
    assert.deepEqual(buildSearchTerms('Stud', withGaps), ['st', 'stu', 'stud', 'wo', 'woo', 'wood']);
    // The end of one text never runs into the start of the next.
    assert.deepEqual(buildSearchTerms('Pack of 2', ['x 4 mm']), ['pa', 'pac', 'pack', 'of', 'mm']);
  });

  it('keeps every key between 2 and 15 characters, in lower case, once', () => {
    const terms = buildSearchTerms('Weatherstripping, self-adhesive EPDM (Soundproofing)', []);
    assert.ok(terms.includes('weatherstrippin'));
    assert.ok(!terms.includes('weatherstripping'));
    for (const listing of LISTINGS) {
      const stored = termsFor(listing);
      assert.equal(new Set(stored).size, stored.length, listing[0]);
      for (const term of stored) {
        assert.ok(term.length >= 2 && term.length <= 15, `${listing[0]}: ${term}`);
        assert.equal(term, term.toLowerCase());
      }
      // The same listing gives the same list in the same order: the trigger writes only on a change.
      assert.deepEqual(termsFor(listing), stored);
      assert.ok(stored.length <= 60, `${listing[0]} stores ${stored.length} terms`);
    }
    assert.equal(termsFor(LISTINGS[0] ?? assert.fail('no listings')).length, 47);
  });
});

describe('searchKeyFor', () => {
  it('searches by the longest word of what was typed', () => {
    assert.equal(searchKeyFor('2×4×8 SPF studs'), '2x4x8');
    assert.equal(searchKeyFor('Drywall 1/2 in'), 'drywall');
    assert.equal(searchKeyFor('3/4" Type L copper'), 'copper');
    assert.equal(searchKeyFor('Rebar 10M 20 ft'), 'rebar');
    assert.equal(searchKeyFor('Subfloor screws'), 'subfloor');
    assert.equal(searchKeyFor('Spray foam low expansion'), 'expansion');
    assert.equal(searchKeyFor('2x4'), '2x4');
    assert.equal(searchKeyFor('PEX'), 'pex');
    assert.equal(searchKeyFor('10M'), '10m');
    assert.equal(searchKeyFor('1/2'), '1/2');
    assert.equal(searchKeyFor('½'), '1/2');
    // Equal lengths: the word typed first.
    assert.equal(searchKeyFor('pot led'), 'pot');
    assert.equal(searchKeyFor('weatherstripping'), 'weatherstrippin');
  });

  it('reads an accented letter as the plain one', () => {
    // A phone keyboard corrects "decor" to "décor"; the tile is called Wall Decor.
    assert.deepEqual(searchKeysFor('Wall décor'), ['decor', 'wall']);
    assert.equal(searchKeyFor('DÉCOR'), 'decor');
    const wallDecor = buildSearchTerms('Acoustic slat wall panel', ['Wall Decor', 'trim', 'baseboard']);
    for (const key of searchKeysFor('wall décor')) assert.ok(wallDecor.includes(key), key);
    // Bilingual labels are found either way.
    assert.deepEqual(buildSearchTerms('Cloison sèche', []), [
      'cl',
      'clo',
      'cloi',
      'clois',
      'cloiso',
      'cloison',
      'se',
      'sec',
      'sech',
      'seche',
    ]);
    assert.equal(searchKeyFor('seche'), 'seche');
    assert.equal(searchKeyFor('sèche'), 'seche');
  });

  it('has no key for what is too short', () => {
    for (const typed of ['', '   ', 'a', '8', 'x', '#', '2 x', 'a & b', "8'"]) {
      assert.equal(searchKeyFor(typed), null, JSON.stringify(typed));
      assert.deepEqual(searchKeysFor(typed), []);
    }
    // Not text at all: no key, and no crash.
    assert.equal(searchKeyFor(undefined as unknown as string), null);
    assert.deepEqual(searchKeysFor(42 as unknown as string), []);
  });

  it('lists every key, the longest first', () => {
    assert.deepEqual(searchKeysFor('2×4×8 SPF studs'), ['2x4x8', 'stud', 'spf']);
    assert.deepEqual(searchKeysFor('Drywall 1/2 in'), ['drywall', '1/2', 'in']);
    assert.deepEqual(searchKeysFor('3/4" Type L copper'), ['copper', 'type', '3/4']);
    assert.deepEqual(searchKeysFor('Rebar 10M 20 ft'), ['rebar', '10m', '20', 'ft']);
    assert.deepEqual(searchKeysFor('Spray foam low expansion'), ['expansion', 'spray', 'foam', 'low']);
    assert.deepEqual(searchKeysFor('studs STUDS stud'), ['stud']);
    assert.deepEqual(searchKeysFor('#9 x 2-1/2 screws'), ['9x2-1/2', 'screw']);
    assert.deepEqual(searchKeysFor('2 1/2 screws'), ['screw', '1/2']);
    assert.deepEqual(searchKeysFor('2-1/2 screws'), ['screw', '1/2']);
  });

  it('strips a plural the way the stored terms do', () => {
    const singulars: [typed: string, key: string][] = [
      ['studs', 'stud'],
      ['screws', 'screw'],
      ['hinges', 'hinge'],
      ['shingles', 'shingle'],
      ['boxes', 'box'],
      ['brushes', 'brush'],
      ['wrenches', 'wrench'],
      ['glasses', 'glass'],
      ['batteries', 'battery'],
      ['hoses', 'hose'],
      ['nuts', 'nut'],
      ['ties', 'tie'],
      // Not plurals.
      ['glass', 'glass'],
      ['brass', 'brass'],
      ['stainless', 'stainless'],
      ['plus', 'plus'],
      ['chassis', 'chassis'],
      ['abs', 'abs'],
      ['gas', 'gas'],
      ['pex', 'pex'],
      ['r20s', 'r20s'],
    ];
    for (const [typed, key] of singulars) {
      assert.equal(searchKeyFor(typed), key, typed);
      // Typed in the plural or in the singular, the word finds a product named either way.
      assert.ok(buildSearchTerms(typed, []).includes(key), `${typed} is not stored under ${key}`);
      assert.ok(buildSearchTerms(key, []).includes(key));
    }
  });

  it('still has a key while a word is being typed', () => {
    const stud = termsFor(LISTINGS[0] ?? assert.fail('no listings'));
    for (const typed of ['2x', '2x4', '2x4x', '2x4x8', 'sp', 'spf', 'st', 'stu', 'stud', 'studs']) {
      const key = searchKeyFor(typed) ?? assert.fail(`no key for ${typed}`);
      assert.ok(stud.includes(key), `${typed} → ${key}`);
    }
  });
});

describe('search on the seed listings', () => {
  it('finds every listing by each word of its own name, and by its SKU', () => {
    for (const listing of LISTINGS) {
      const [sku, name] = listing;
      const stored = new Set(termsFor(listing));
      for (const key of searchKeysFor(name)) assert.ok(stored.has(key), `${sku}: ${key}`);
      assert.ok(find(name).includes(sku), sku);
      assert.ok(find(sku).includes(sku), sku);
      assert.ok(find(sku.toLowerCase()).includes(sku), sku);
    }
  });

  it('answers the example searches of the site with the listing they describe', () => {
    assert.deepEqual(find('2×4×8 SPF studs'), ['KLY-SPF248', 'GBC-SPF248']);
    assert.deepEqual(find('Drywall 1/2 in'), ['BDP-DW12']);
    assert.deepEqual(find('3/4" Type L copper'), ['CPD-CU34L']);
    assert.deepEqual(find('Rebar 10M 20 ft'), ['KLY-REBAR']);
    assert.deepEqual(find('Subfloor screws'), ['KLY-SCR212']);
    assert.deepEqual(find('Spray foam low expansion'), ['GBC-FOAM']);
    // "Search 2x4, drywall, PEX…"
    assert.deepEqual(find('2x4'), ['KLY-SPF248', 'GBC-SPF248']);
    assert.deepEqual(find('drywall'), DRYWALL_CATEGORY);
    assert.deepEqual(find('PEX'), ['CPD-CU34L', 'CPD-PEX12']);
  });

  it('finds drywall by sheetrock, NMD90 cable by romex and joint compound by mud', () => {
    // The three words are synonyms of a category (§1.5), so they find everything in it …
    assert.deepEqual(SEARCH_SYNONYMS.sheetrock, ['drywall']);
    assert.deepEqual(SEARCH_SYNONYMS.romex, ['electrical']);
    assert.deepEqual(SEARCH_SYNONYMS.mud, ['drywall']);
    assert.deepEqual(find('sheetrock'), DRYWALL_CATEGORY);
    assert.deepEqual(find('romex'), ['VES-NMD142', 'VES-EMT12', 'VES-POT']);
    assert.deepEqual(find('mud'), DRYWALL_CATEGORY);
    // … and one more word narrows the answer to the listing.
    assert.deepEqual(find('sheetrock 1/2'), ['BDP-DW12']);
    assert.deepEqual(find('1/2 sheetrock 4x8'), ['BDP-DW12']);
    assert.deepEqual(find('romex 14/2'), ['VES-NMD142']);
    assert.deepEqual(find('joint compound mud'), ['BDP-JC17']);
    assert.deepEqual(find('gyprock 5/8'), ['BDP-DW58X']);
    // A word that is not a synonym of anything finds nothing.
    assert.deepEqual(find('plasterboard'), []);
  });

  it('finds listings by size, fraction and trade word', () => {
    assert.deepEqual(find('2 x 4'), ['KLY-SPF248', 'GBC-SPF248']);
    assert.deepEqual(find('4x8'), ['KLY-OSB716', 'KLY-PLY12', 'KLY-SUB34', 'BDP-DW12', 'BDP-DW58X']);
    assert.deepEqual(find('osb 7/16'), ['KLY-OSB716']);
    assert.deepEqual(find('10M'), ['KLY-REBAR']);
    assert.deepEqual(find('14/2'), ['VES-NMD142']);
    assert.deepEqual(find('16x25x1'), ['AHR-FILTER']);
    assert.deepEqual(find('16 x 25'), ['AHR-FILTER']);
    assert.deepEqual(find('30x80 door'), ['CDT-DOOR30']);
    assert.deepEqual(find('3/8 bolts'), ['BFH-BOLTS']);
    assert.deepEqual(find('#10 x 2-1/2'), ['BFH-DECK']);
    assert.deepEqual(find('2-1/2 screws'), ['KLY-SCR212', 'BFH-DECK']);
    assert.deepEqual(find('2 1/2 screws'), ['KLY-SCR212', 'BFH-DECK']);
    assert.deepEqual(find('i-joist 9 1/2'), ['KLY-IJ916']);
    assert.deepEqual(find('hard hat'), ['GBC-HAT']);
    assert.deepEqual(find('water heater'), ['CPD-WH40']);
    assert.deepEqual(find('pot lights'), ['VES-POT']);
    assert.deepEqual(find('mirrors'), ['GGM-MIRROR']);
    assert.deepEqual(find('shingle'), ['SMR-SHING']);
    assert.deepEqual(find('spf-2x4x8'), ['KLY-SPF248', 'GBC-SPF248']);
  });
});

describe('search synonyms', () => {
  it('maps every synonym of the category table to its categories', () => {
    for (const id of CATEGORY_IDS) {
      for (const word of CATEGORIES[id].synonyms) {
        assert.ok(SEARCH_SYNONYMS[word]?.includes(id), `${word} → ${id}`);
      }
    }
    // "cement" is glue and it is masonry.
    assert.deepEqual(SEARCH_SYNONYMS.cement, ['adhesives', 'masonry']);
    // Words of the site's names that the table does not carry.
    assert.deepEqual(SEARCH_SYNONYMS.mirrors, ['glass']);
    assert.deepEqual(SEARCH_SYNONYMS.exteriors, ['outdoors']);
    for (const ids of Object.values(SEARCH_SYNONYMS)) assert.ok(ids.every(isCategoryId));
  });

  it('is safe to look up with whatever a customer typed', () => {
    assert.equal(SEARCH_SYNONYMS.constructor, undefined);
    assert.equal(SEARCH_SYNONYMS.toString, undefined);
    assert.equal(SEARCH_SYNONYMS['not a word'], undefined);
  });
});

describe('sizes, however they are typed', () => {
  it('gives 300 random sizes one key in every spelling', () => {
    const random = mulberry32(248);
    const pick = <T>(list: readonly T[]): T =>
      list[Math.floor(random() * list.length)] ?? assert.fail('empty list');
    const numbers = ['2', '4', '6', '8', '10', '12', '16', '24', '1/2', '3/4', '5/8', '7/16', '1.5', '94.5'];
    const units = ['', '', ' in', 'in', ' ft', ' mm', ' cm', ' m', '"', "'", ' in.', ' inches', ' feet'];
    const crosses = ['x', ' x ', 'X', ' X ', '×', ' × ', ' x', 'x '];
    for (let round = 0; round < 300; round += 1) {
      const parts = Array.from({ length: 2 + Math.floor(random() * 2) }, () => pick(numbers));
      const key = parts.join('x');
      let written = '';
      parts.forEach((part, index) => {
        // The last number keeps no unit here: a unit after it is a word of its own ("ft").
        written += index < parts.length - 1 ? `${part}${pick(units)}${pick(crosses)}` : part;
      });
      assert.deepEqual(searchKeysFor(written), [key], written);
      assert.equal(searchKeyFor(`${written} lumber`), key.length >= 6 ? key : 'lumber', written);
      const stored = buildSearchTerms(`Board ${written}`, []);
      assert.ok(stored.includes(key), `${written} is not stored under ${key}`);
      // Every part of two or more characters is a key of its own.
      for (const part of parts) if (part.length >= 2) assert.ok(stored.includes(part), `${written}: ${part}`);
    }
  });
});
