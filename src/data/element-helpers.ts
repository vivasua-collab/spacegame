/**
 * Общие константы для отображения элементов в UI.
 * Единый источник правды для CATEGORY_LABELS и CATEGORY_COLORS.
 */

import type { ElementCategory } from '@/core/types';

/** Названия категорий элементов на русском */
export const CATEGORY_LABELS: Record<ElementCategory, string> = {
  structural: 'Строительные',
  fuel: 'Топливные',
  chemical: 'Химические',
  alkali: 'Щелочные',
  alkaline_earth: 'Щёлочноземельные',
  halogen: 'Галогены',
  nonmetal: 'Неметаллы',
  metal: 'Металлы',
  transmetal: 'Переходные металлы',
  noble: 'Благородные',
  lanthanide: 'Лантаноиды',
  rare: 'Редкие',
  transuranic: 'Трансурановые',
};

/** Цвета категорий элементов для UI */
export const CATEGORY_COLORS: Record<ElementCategory, string> = {
  structural: 'text-amber-400',
  fuel: 'text-red-400',
  chemical: 'text-green-400',
  alkali: 'text-violet-400',
  alkaline_earth: 'text-yellow-400',
  halogen: 'text-cyan-400',
  nonmetal: 'text-emerald-400',
  metal: 'text-blue-400',
  transmetal: 'text-sky-400',
  noble: 'text-yellow-300',
  lanthanide: 'text-purple-400',
  rare: 'text-orange-400',
  transuranic: 'text-pink-400',
};
