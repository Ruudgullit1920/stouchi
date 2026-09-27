/* 3D icons for categories, bills and pots (prototype/index.html, I3D): Microsoft
 * Fluent Emoji 3D (MIT), resized to 160 px WebP in src/assets/i3d. They ship as
 * hashed files under /assets/, so the service worker precaches them and the CSP
 * needs no new origin. UI chrome stays on Lucide. */
const FILES = import.meta.glob<string>('../assets/i3d/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** a file in src/assets/i3d, by its name without the extension */
export const i3dFile = (slug: string): string | undefined => FILES[`../assets/i3d/${slug}.webp`];

/* Lucide name → Fluent file, as in the prototype's I3D */
const BY_LUCIDE: Record<string, string> = {
  house: 'house',
  sparkles: 'sparkles',
  coins: 'money_bag',
  'hand-coins': 'money_with_wings',
  'shopping-cart': 'shopping_cart',
  'key-round': 'key',
  zap: 'high_voltage',
  bus: 'bus',
  fuel: 'fuel_pump',
  'heart-pulse': 'pill',
  utensils: 'fork_and_knife_with_plate',
  coffee: 'hot_beverage',
  'shopping-bag': 'shopping_bags',
  ticket: 'admission_tickets',
  tv: 'television',
  gift: 'wrapped_gift',
  wrench: 'hammer_and_wrench',
  'graduation-cap': 'graduation_cap',
  landmark: 'bank',
  shirt: 't-shirt',
  plane: 'airplane',
  scissors: 'lipstick',
  'circle-ellipsis': 'package',
  droplet: 'droplet',
  wifi: 'globe_with_meridians',
  smartphone: 'mobile_phone',
  shield: 'shield',
  'shield-check': 'shield',
  dumbbell: 'person_lifting_weights',
  car: 'automobile',
  heart: 'red_heart',
  receipt: 'receipt',
};

/** the 3D icon for a Lucide icon name, when there is one */
export const i3d = (lucide: string): string | undefined => {
  const slug = BY_LUCIDE[lucide];
  return slug ? i3dFile(slug) : undefined;
};

/* A bill has no icon of its own: its label picks one (the prototype's bill
   icons), the receipt otherwise. */
const BILL_WORDS: [RegExp, string][] = [
  [/loyer|location/i, 'key'],
  [/steg|[ée]lectricit|gaz/i, 'high_voltage'],
  [/sonede|\beau\b/i, 'droplet'],
  [/internet|fibre|adsl|wi-?fi|topnet|ooredoo|globalnet|hexabyte/i, 'globe_with_meridians'],
  [/t[ée]l[ée]phone|mobile|forfait|orange|telecom/i, 'mobile_phone'],
  [/cr[ée]dit|pr[êe]t|banque/i, 'bank'],
  [/assurance/i, 'shield'],
  [/[ée]cole|cr[èe]che|scolarit/i, 'graduation_cap'],
  [/sport|gym|salle/i, 'person_lifting_weights'],
  [/netflix|spotify|abonnement|canal|osn|youtube/i, 'television'],
  [/voiture|auto/i, 'automobile'],
];
export const billI3d = (label: string): string | undefined =>
  i3dFile(BILL_WORDS.find(([re]) => re.test(label))?.[1] ?? 'receipt');

/** A decorative 3D icon: empty alt, so screen readers skip it. Nothing without a src. */
export function Icon3D({ src, size, class: cls }: { src?: string; size?: number; class?: string }) {
  if (!src) return null;
  return (
    <img
      class={cls ? `i3d ${cls}` : 'i3d'}
      src={src}
      alt=""
      width={size}
      height={size}
      decoding="async"
      draggable={false}
    />
  );
}
