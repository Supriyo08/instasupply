/**
 * Material-list typing (MARKETPLACE §7.3 quotes/new): pasting several lines splits them into items, and
 * a leading or trailing number becomes the quantity. "120 2x4x8 SPF studs" → 120 × "2x4x8 SPF studs";
 * "Drywall 1/2 in x 40" → 40 × "Drywall 1/2 in"; "2x4x8 SPF stud" keeps its sizes.
 */
export interface DraftLine {
  key: string;
  text: string;
  /** As typed; empty for "no quantity". */
  quantity: string;
}

/** Bullets and list numbering ("- ", "• ", "1. ", "2) ") are not quantities. */
const BULLET = /^\s*(?:[-•*·]|\d{1,2}[.)])\s+/;
/** "120 studs", "120 x studs", "120x studs", "120 pcs studs". The space after keeps "2x4x8" whole. */
const LEADING = /^(\d[\d,]{0,6})\s*(?:x|×|pcs?|ea)?\s+(\S.*)$/i;
/**
 * "studs 120", "studs x 120", "studs - 120", "studs: 120 pcs". The number needs a space or a separator
 * before it, so "2x4x8" and "Rebar 10M" keep their sizes.
 */
const TRAILING = /^(.*?\S)(?:\s+[x×:-]?\s*|\s*[:×]\s*)(\d[\d,]{0,6})\s*(?:pcs?|ea|each)?$/i;

const toQuantity = (digits: string): string => {
  const value = Number(digits.replace(/,/g, ''));
  return Number.isSafeInteger(value) && value >= 1 && value <= 99_999 ? String(value) : '';
};

/** One typed or pasted line as text and quantity. */
export function parseListLine(raw: string): { text: string; quantity: string } {
  const line = raw.replace(BULLET, '').trim();
  const leading = LEADING.exec(line);
  if (leading?.[1] && leading[2]) {
    const quantity = toQuantity(leading[1]);
    if (quantity) return { text: leading[2].trim(), quantity };
  }
  const trailing = TRAILING.exec(line);
  if (trailing?.[1] && trailing[2]) {
    const quantity = toQuantity(trailing[2]);
    if (quantity) return { text: trailing[1].trim(), quantity };
  }
  return { text: line, quantity: '' };
}

/** Several lines (a paste) as items; blank lines are dropped. */
export function splitPastedList(raw: string): { text: string; quantity: string }[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseListLine);
}

/** The request lines `submitMaterialList` takes; rows left completely empty are dropped. */
export function requestLines(lines: readonly DraftLine[]): { text: string; quantity: number | null }[] {
  return lines
    .filter((line) => line.text.trim() || line.quantity.trim())
    .map((line) => {
      const quantity = line.quantity.trim() ? Number(line.quantity.replace(/,/g, '')) : null;
      return {
        text: line.text.trim(),
        quantity: quantity != null && Number.isFinite(quantity) ? quantity : null,
      };
    });
}

/**
 * The editor's first lines: a list handed over as text (the cart's "Send as a material list", one item
 * per line, "24 × 2x4x8 SPF stud (…)") split into items, else one empty row.
 */
export function initialDraftLines(raw: string | null | undefined, newKey: () => string): DraftLine[] {
  const items = raw ? splitPastedList(raw) : [];
  if (items.length === 0) return [{ key: newKey(), text: '', quantity: '' }];
  return items.map((item) => ({ key: newKey(), ...item }));
}
