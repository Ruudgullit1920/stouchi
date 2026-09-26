import fr from './fr.json';

export type StringKey = keyof typeof fr;

/** The French string for `key`, with {name} placeholders filled from `vars`. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const text: string = fr[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
