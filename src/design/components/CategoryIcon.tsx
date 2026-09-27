import {
  Bus,
  CircleEllipsis,
  Coffee,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  KeyRound,
  Landmark,
  Plane,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Ticket,
  Tv,
  Utensils,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-preact';
import { CATEGORIES, type CategoryKey } from '../../shared/categories';
import { i3d } from '../i3d';

/** Lucide icon per category — the same names as CATEGORIES[k].icon in src/shared/categories.ts. */
export const CATEGORY_ICON: Record<CategoryKey, LucideIcon> = {
  courses: ShoppingCart,
  loyer: KeyRound,
  factures: Zap,
  transport: Bus,
  essence: Fuel,
  sante: HeartPulse,
  maison: Wrench,
  ecole: GraduationCap,
  credit: Landmark,
  resto: Utensils,
  cafe: Coffee,
  shopping: ShoppingBag,
  vetements: Shirt,
  sortie: Ticket,
  voyage: Plane,
  abonnement: Tv,
  cadeau: Gift,
  beaute: Scissors,
  autre: CircleEllipsis,
};

/** the category's 3D icon (prototype I3D) */
export const categoryI3d = (k: CategoryKey): string | undefined => i3d(CATEGORIES[k].icon);
