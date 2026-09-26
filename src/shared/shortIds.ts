/* The ids Aam Salah sees (spec §4): the kind letter plus the shortest hex
 * prefix of the uuid, at least 4 characters, that no other row of the same
 * kind shares. No server state: the same rows give the same ids every turn. A
 * new row that collides lengthens both ids, so the old short id stops
 * resolving (the action is dropped) instead of pointing at the wrong row. */

export type ShortKind = 'e' | 'b' | 'd' | 'r';

const MIN = 4;
const hex = (id: string) => id.replace(/-/g, '').toLowerCase();

/** short id → uuid, in the order the rows were given */
export function shortIds(items: { kind: ShortKind; id: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of items) {
    const mine = hex(item.id);
    const others = items.filter((o) => o.kind === item.kind && o !== item).map((o) => hex(o.id));
    let len = MIN;
    while (len < mine.length && others.some((o) => o.startsWith(mine.slice(0, len)))) len++;
    out.set(item.kind + mine.slice(0, len), item.id);
  }
  return out;
}
