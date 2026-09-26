/* RFC 4122 version-5 UUIDs, synchronous and without node:crypto, so the app,
 * the backfill and (Phase 4) the payday cron derive the same ids. */

/** The app's namespace: backfill ids (`<source>:<kind>:<legacy id>`) and payday
 * deposits (`payday:<user>:<period start>`) live under it without colliding. */
export const STOUCHI_NS = '5b0e3b6c-8f0a-4d6e-9c61-2f1d7a4b9e30';

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

function sha1(msg: Uint8Array): Uint8Array {
  const bitLen = msg.length * 8;
  const padded = new Uint8Array((((msg.length + 8) >> 6) + 1) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array<number>(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  h.forEach((x, i) => outView.setUint32(i * 4, x >>> 0));
  return out;
}

/** The same name and namespace always give the same id. */
export function uuidv5(name: string, namespace: string): string {
  const nsHex = namespace.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(nsHex)) throw new Error(`namespace is not a UUID: ${namespace}`);
  const ns = Uint8Array.from(nsHex.match(/../g) ?? [], (x) => parseInt(x, 16));
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns);
  input.set(nameBytes, ns.length);
  const hash = sha1(input);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = Array.from(hash.subarray(0, 16), (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
