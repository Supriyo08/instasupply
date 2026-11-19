/** `--name value` pairs of a CLI command. */
export function option(args: string[], name: string): string | null {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : null;
}
