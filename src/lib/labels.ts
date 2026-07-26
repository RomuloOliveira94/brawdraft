// pt-BR display labels for the English enum values stored in the data layer
// (content.config.ts schemas are fixed and not translated at the data level).
// Kept small and dependency-free, mirroring the style of composition.ts.

import type { BrawlerClassName } from '@/lib/composition';

const CLASS_LABELS: Record<BrawlerClassName, string> = {
  Tank: 'Tanque',
  Assassin: 'Assassino',
  'Damage Dealer': 'Combatente',
  Marksman: 'Atirador',
  Artillery: 'Artilheiro',
  Controller: 'Controlador',
  Support: 'Suporte',
  Unknown: 'Desconhecida',
};

/** Canonical display order for grouping brawlers by class on /brawlers/. */
export const CLASS_ORDER: BrawlerClassName[] = [
  'Tank',
  'Assassin',
  'Damage Dealer',
  'Marksman',
  'Artillery',
  'Controller',
  'Support',
  'Unknown',
];

const RARITY_LABELS: Record<string, string> = {
  Common: 'Comum',
  Rare: 'Rara',
  'Super Rare': 'Super Rara',
  Epic: 'Épica',
  Mythic: 'Mítica',
  Legendary: 'Lendária',
  'Ultra Legendary': 'Ultra Lendária',
};

/** pt-BR label for a brawler class name, falling back to the raw value. */
export function classNameLabel(className: BrawlerClassName): string {
  return CLASS_LABELS[className] ?? className;
}

/** pt-BR label for a rarity string, falling back to the raw value. */
export function rarityLabel(rarity: string): string {
  return RARITY_LABELS[rarity] ?? rarity;
}
