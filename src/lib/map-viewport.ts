/**
 * GAL-UI-01 (Issue #19, 2026-10-28): чистая математика viewport карты галактики.
 *
 * Прежде «Fit» (resetView) просто сбрасывал zoom=1/pan=(0,0) — при контейнере
 * больше канвы SVG 900×600 галактика съезжала в левый верхний угол (отчёт
 * владельца: «Fit ставит 100%, галактика уменьшается и смещается влево-вверх»).
 * Вынесено в чистую функцию для юнит-тестов (tests/gal-ui-viewport.test.ts).
 */

/** Минимальный/максимальный zoom карты (синхронизировано с galaxy-map.tsx). */
export const MAP_ZOOM_MIN = 0.15;
export const MAP_ZOOM_MAX = 80;

export interface FitView {
  /** Масштаб: svg-пиксели → экранные пиксели. */
  zoom: number;
  /** Смещение канвы в экранных пикселях (CSS translate). */
  panX: number;
  /** Смещение канвы по вертикали в экранных пикселях. */
  panY: number;
}

/**
 * Вписать канву SVG (svgW×svgH) в контейнер (containerW×containerH) целиком
 * и центрировать. Канва содержит галактику с полем (padding) и уже
 * центрирована внутри себя, поэтому центрирование канвы = центрирование
 * галактики.
 *
 * Свойства (покрыты тестами):
 * - детерминизм: одинаковые входы → одинаковый результат (повторный Fit
 *   не дрейфует);
 * - масштаб = min(containerW/svgW, containerH/svgH), ограничен
 *   [MAP_ZOOM_MIN, MAP_ZOOM_MAX];
 * - при container ≥ svg (по обеим осям) масштаб = 1 не форсируется:
 *   канва вписывается без увеличения сверх 1× (обзор не «раздувается»);
 * - канва центрирована: свободное место делится поровну слева/справа и
 *   сверху/снизу;
 * - крайние случаи: нулевой/отрицательный контейнер → безопасный фолбэк
 *   (масштаб 1, центр 0).
 */
export function computeFitView(
  containerW: number,
  containerH: number,
  svgW: number,
  svgH: number,
): FitView {
  // Фолбэк для ещё не измеренного/невалидного контейнера.
  if (!(containerW > 0) || !(containerH > 0) || !(svgW > 0) || !(svgH > 0)) {
    return { zoom: 1, panX: 0, panY: 0 };
  }
  // Вписать без увеличения сверх 1×: контейнер больше канвы → обзор 1:1
  // (галактика и так видна целиком; «раздувать» пиксели не нужно).
  const fit = Math.min(containerW / svgW, containerH / svgH);
  const zoom = Math.min(1, Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, fit)));
  const panX = (containerW - svgW * zoom) / 2;
  const panY = (containerH - svgH * zoom) / 2;
  return { zoom, panX, panY };
}
