/**
 * CSV import: template, header normalization and row → delivery input mapping.
 */
import { validateDeliveryInput, type DeliveryInput } from '@instasupply/shared';

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
  'codAmount',
  'requireCode',
  'windowStart',
  'windowEnd',
] as const;

/** Example window: tomorrow 10:00–13:00 local time. */
function exampleWindow(): [string, string] {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return [`${day} 10:00`, `${day} 13:00`];
}

const templateRows = (): string[][] => [
  [
    'Asha Rao',
    '+919811000001',
    'asha@example.com',
    '12, 80 Feet Rd, Koramangala 4th Block, Bengaluru',
    '12.9352',
    '77.6245',
    'Blue gate, 2nd floor',
    '',
    '1',
    'normal',
    '',
    'false',
    '',
    '',
  ],
  [
    'Vikram Shetty',
    '9811000002',
    '',
    '27th Main Rd, HSR Layout Sector 1, Bengaluru',
    '',
    '',
    '',
    'Fragile',
    '2',
    'high',
    '1299',
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

/** Accept common header spellings: "Customer Name", "customer_name", "Latitude"… */
const HEADER_ALIASES: Record<string, (typeof CSV_COLUMNS)[number]> = {
  customername: 'customerName',
  name: 'customerName',
  customer: 'customerName',
  customerphone: 'customerPhone',
  phone: 'customerPhone',
  mobile: 'customerPhone',
  customeremail: 'customerEmail',
  email: 'customerEmail',
  address: 'address',
  lat: 'lat',
  latitude: 'lat',
  lng: 'lng',
  lon: 'lng',
  long: 'lng',
  longitude: 'lng',
  addressnotes: 'addressNotes',
  directions: 'addressNotes',
  notes: 'notes',
  packagecount: 'packageCount',
  packages: 'packageCount',
  priority: 'priority',
  codamount: 'codAmount',
  cod: 'codAmount',
  requirecode: 'requireCode',
  handoffcode: 'requireCode',
  windowstart: 'windowStart',
  windowend: 'windowEnd',
  deliverby: 'windowEnd',
};

export function normalizeHeader(header: string): string {
  const key = header.toLowerCase().replace(/[^a-z]/g, '');
  return HEADER_ALIASES[key] ?? header;
}

export interface ParsedRow {
  rowNumber: number;
  raw: Record<string, string>;
  input: DeliveryInput | null;
  error: string | null;
  /** No coordinates: the server will geocode the address. */
  needsGeocoding: boolean;
}

const parseTime = (value: string | undefined): number | null => {
  if (!value?.trim()) return null;
  const millis = new Date(value.trim().replace(' ', 'T')).getTime();
  return Number.isFinite(millis) ? millis : Number.NaN;
};

export function mapRow(raw: Record<string, string>, index: number): ParsedRow {
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
      error: 'Time window must look like 2026-01-31 14:00.',
      needsGeocoding: false,
    };
  }

  const result = validateDeliveryInput({
    ...raw,
    location: lat && lng ? { lat, lng } : null,
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
