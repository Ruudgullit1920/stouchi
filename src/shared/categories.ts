/* Categories and the pot each one draws from. Same keys and pots as the
   assistant's validator (lib/aam-salah/validate.js) — a test keeps them equal. */
import { t, type StringKey } from './i18n/t';

export type Pot = 'needs' | 'wants';

export const CATEGORY_KEYS = [
  'courses',
  'loyer',
  'factures',
  'transport',
  'essence',
  'sante',
  'maison',
  'ecole',
  'credit',
  'resto',
  'cafe',
  'shopping',
  'vetements',
  'sortie',
  'voyage',
  'abonnement',
  'cadeau',
  'beaute',
  'autre',
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** icon = Lucide icon name */
export const CATEGORIES: Record<CategoryKey, { icon: string; pot: Pot }> = {
  courses: { icon: 'shopping-cart', pot: 'needs' },
  loyer: { icon: 'key-round', pot: 'needs' },
  factures: { icon: 'zap', pot: 'needs' },
  transport: { icon: 'bus', pot: 'needs' },
  essence: { icon: 'fuel', pot: 'needs' },
  sante: { icon: 'heart-pulse', pot: 'needs' },
  maison: { icon: 'wrench', pot: 'needs' },
  ecole: { icon: 'graduation-cap', pot: 'needs' },
  credit: { icon: 'landmark', pot: 'needs' },
  resto: { icon: 'utensils', pot: 'wants' },
  cafe: { icon: 'coffee', pot: 'wants' },
  shopping: { icon: 'shopping-bag', pot: 'wants' },
  vetements: { icon: 'shirt', pot: 'wants' },
  sortie: { icon: 'ticket', pot: 'wants' },
  voyage: { icon: 'plane', pot: 'wants' },
  abonnement: { icon: 'tv', pot: 'wants' },
  cadeau: { icon: 'gift', pot: 'wants' },
  beaute: { icon: 'scissors', pot: 'wants' },
  autre: { icon: 'circle-ellipsis', pot: 'wants' },
};

export const potOf = (k: CategoryKey): Pot => CATEGORIES[k].pot;
export const isCategory = (k: string): k is CategoryKey => (CATEGORY_KEYS as readonly string[]).includes(k);
export const categoryLabel = (k: CategoryKey): string => t(`category.${k}` as StringKey);
export const categoriesIn = (pot: Pot): CategoryKey[] =>
  CATEGORY_KEYS.filter((k) => CATEGORIES[k].pot === pot);
