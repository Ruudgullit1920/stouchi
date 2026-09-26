/* A goal's icon is a lucide name (goals.icon); these are the ones the goal types use. */
import { Car, Heart, House, Plane, Shield, Sparkles, type LucideIcon } from 'lucide-preact';

const ICONS: Record<string, LucideIcon> = {
  house: House,
  car: Car,
  heart: Heart,
  plane: Plane,
  shield: Shield,
  sparkles: Sparkles,
};

export const goalIcon = (name: string): LucideIcon => ICONS[name] ?? Sparkles;
