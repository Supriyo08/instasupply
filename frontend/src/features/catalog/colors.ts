const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc", "aabbcc" → "#AABBCC"; null when it isn't a hex colour. */
export function normalizeHex(value: string | null | undefined): string | null {
  const digits = HEX_PATTERN.exec(value?.trim() ?? '')?.[1];
  if (!digits) return null;
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return `#${full.toUpperCase()}`;
}
