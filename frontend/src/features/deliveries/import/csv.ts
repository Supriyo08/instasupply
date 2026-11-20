/**
 * CSV import of manual deliveries: template, header mapping and row → delivery input mapping.
 * Customers pay by card, so there is no cash-on-delivery column (MARKETPLACE §12.5). Headers that do not
 * map to a column, and two headers that map to the same column, are reported before importing (R45).
 */
import { addLocalDays, localDateOf, validateDeliveryInput, type DeliveryInput } from '@instasupply/shared';

import { fromLocalInput } from '../components/delivery-form';

export const CSV_COLUMNS = [
  'customerName',
  'customerPhone',
  'customerEmail',
  'address',
  'lat',
  'lng',
  'addressNotes',
  'notes',
  'packageCount',
  'priority',
  'requireCode',
  'windowStart',
  'windowEnd',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

export const COLUMN_LABEL: Record<CsvColumn, string> = {
  customerName: 'Site contact',
  customerPhone: 'Phone',
  customerEmail: 'Email',
  address: 'Address',
  lat: 'Latitude',
  lng: 'Longitude',
  addressNotes: 'Directions',
  notes: 'Notes',
  packageCount: 'Pieces',
  priority: 'Priority',
  requireCode: 'Hand-off code',
  windowStart: 'Window start',
  windowEnd: 'Deliver by',
};

/** Example window: tomorrow 7:00–9:00 am, Toronto time. */
function exampleWindow(): [string, string] {
  const day = addLocalDays(localDateOf(Date.now()), 1);
  return [`${day} 07:00`, `${day} 09:00`];
}

const templateRows = (): string[][] => [
  [
    'Dana Whitfield',
    '+14165550142',
    'site@whitfieldreno.ca',
    '1200 Queen St E, Toronto, ON M4M 1L5',
    '43.6629',
    '-79.3315',
    'Side lane off Leslie St, ask for Dana',
    '',
    '3',
    'normal',
    'false',
    '',
    '',
  ],
  [
    'Marco Bianchi',
    '647-555-0199',
    '',
    '88 Main St N, Brampton, ON L6V 1N7',
    '',
    '',
    'Unload at the back gate',
    'Fragile: windows',
    '2',
    'high',
    'true',
    ...exampleWindow(),
  ],
];

const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function templateCsv(): string {
  return [CSV_COLUMNS.join(','), ...templateRows().map((row) => row.map(quote).join(','))].join('\n');
}

export function downloadTemplate() {
  const blob = new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'instasupply-deliveries-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Common header spellings, matched after lower-casing and dropping everything but letters: "Customer
 * Name", "customer_name", "Phone Number", "Mobile No", "Latitude"… Kept conservative: generic headers such
 * as "amount" or "total" are never mapped to anything.
 */
const HEADER_ALIASES: Record<string, CsvColumn> = {
  customername: 'customerName',
  name: 'customerName',
  customer: 'customerName',
  contact: 'customerName',
  contactname: 'customerName',
  sitecontact: 'customerName',
  customerphone: 'customerPhone',
  phone: 'customerPhone',
  phonenumber: 'customerPhone',
  phoneno: 'customerPhone',
  mobile: 'customerPhone',
  mobileno: 'customerPhone',
  mobilenumber: 'customerPhone',
  cell: 'customerPhone',
  cellphone: 'customerPhone',
  contactnumber: 'customerPhone',
  customermobile: 'customerPhone',
  customeremail: 'customerEmail',
  email: 'customerEmail',
  emailaddress: 'customerEmail',
  address: 'address',
  deliveryaddress: 'address',
  siteaddress: 'address',
  jobsiteaddress: 'address',
  lat: 'lat',
  latitude: 'lat',
  lng: 'lng',
  lon: 'lng',
  long: 'lng',
  longitude: 'lng',
  addressnotes: 'addressNotes',
  directions: 'addressNotes',
  siteinstructions: 'addressNotes',
  notes: 'notes',
  packagecount: 'packageCount',
  packages: 'packageCount',
  pieces: 'packageCount',
  priority: 'priority',
  requirecode: 'requireCode',
  handoffcode: 'requireCode',
  windowstart: 'windowStart',
  windowend: 'windowEnd',
  deliverby: 'windowEnd',
};

/** Headers that look like a cash amount: reported with an explanation instead of silently dropped. */
const CASH_HEADERS = new Set(['cod', 'codamount', 'cashondelivery', 'amounttocollect', 'cash', 'collect']);

export function normalizeHeader(header: string): CsvColumn | null {
  const key = header.toLowerCase().replace(/[^a-z]/g, '');
  return HEADER_ALIASES[key] ?? null;
}

export interface HeaderReport {
  /** Original header → column, for the headers that are used. */
  mapped: { header: string; column: CsvColumn }[];
  /** Headers whose values are not imported. */
  ignored: { header: string; reason: string }[];
  /** Columns that more than one header maps to; only the first header's values are used. */
  duplicates: { column: CsvColumn; headers: string[] }[];
  /** Which original header feeds each column. */
  sourceOf: Partial<Record<CsvColumn, string>>;
}

export function mapHeaders(headers: readonly string[]): HeaderReport {
  const report: HeaderReport = { mapped: [], ignored: [], duplicates: [], sourceOf: {} };
  const byColumn = new Map<CsvColumn, string[]>();
  for (const header of headers) {
    if (!header.trim()) continue;
    const column = normalizeHeader(header);
    if (!column) {
      const key = header.toLowerCase().replace(/[^a-z]/g, '');
      report.ignored.push({
        header,
        reason:
          CASH_HEADERS.has(key) || key.startsWith('cod')
            ? 'no cash on delivery: customers pay by card'
            : 'not a delivery column',
      });
      continue;
    }
    const list = byColumn.get(column) ?? [];
    list.push(header);
    byColumn.set(column, list);
  }
  for (const [column, list] of byColumn) {
    report.sourceOf[column] = list[0]!;
    report.mapped.push({ header: list[0]!, column });
    if (list.length > 1) {
      report.duplicates.push({ column, headers: list });
      for (const extra of list.slice(1)) {
        report.ignored.push({ header: extra, reason: `same column as "${list[0]}"` });
      }
    }
  }
  return report;
}

export interface ParsedRow {
  rowNumber: number;
  /** Values by column (first header of each column). */
  raw: Partial<Record<CsvColumn, string>>;
  input: DeliveryInput | null;
  error: string | null;
  /** No coordinates: the server will geocode the address. */
  needsGeocoding: boolean;
}

/** Picks each column's value from the header that feeds it. */
export function projectRow(
  record: Record<string, string | undefined>,
  sourceOf: HeaderReport['sourceOf'],
): Partial<Record<CsvColumn, string>> {
  const raw: Partial<Record<CsvColumn, string>> = {};
  for (const column of CSV_COLUMNS) {
    const header = sourceOf[column];
    const value = header ? record[header] : undefined;
    if (value !== undefined) raw[column] = value;
  }
  return raw;
}

/** "2026-11-21 07:00" or "2026-11-21T07:00", Toronto time; empty is null; anything else is NaN. */
const parseTime = (value: string | undefined): number | null => {
  if (!value?.trim()) return null;
  return fromLocalInput(value) ?? Number.NaN;
};

export function mapRow(raw: Partial<Record<CsvColumn, string>>, index: number): ParsedRow {
  const lat = raw.lat?.trim();
  const lng = raw.lng?.trim();
  const windowStart = parseTime(raw.windowStart);
  const windowEnd = parseTime(raw.windowEnd);
  const rowNumber = index + 2; // header is row 1

  if (Number.isNaN(windowStart) || Number.isNaN(windowEnd)) {
    return {
      rowNumber,
      raw,
      input: null,
      error: 'Time window must look like 2026-11-21 07:00 (Toronto time).',
      needsGeocoding: false,
    };
  }

  const result = validateDeliveryInput({
    ...raw,
    location: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
    windowStart,
    windowEnd,
    driverId: null,
  });
  if (!result.ok) {
    const error = Object.values(result.errors).find(Boolean) ?? 'Invalid row.';
    return { rowNumber, raw, input: null, error, needsGeocoding: false };
  }
  return { rowNumber, raw, input: result.value, error: null, needsGeocoding: !result.value.location };
}
