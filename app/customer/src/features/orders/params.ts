/** First value of a route param (`?id=a&id=b` arrives as an array), or undefined when blank. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first : undefined;
}
