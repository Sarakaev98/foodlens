import type { ScanMode } from './types/scan.types';

/** Тексты и размеры рамки-подсказки на экране камеры. Рамка — только оверлей, в снимок она не попадает. */
export const SCAN_GUIDE_TEXT = {
  product: {
    title: 'Наведите на штрихкод',
    hint: 'Или сфотографируйте упаковку',
    frameAccessibilityLabel: 'Рамка для штрихкода',
  },
  label: {
    title: 'Наведите на таблицу пищевой ценности',
    hint: 'Держите телефон ближе, чтобы текст был чётким',
    frameAccessibilityLabel: 'Рамка для таблицы пищевой ценности',
  },
  barcodeFound: 'Штрихкод найден',
  focusHint: 'Нажмите на экран, чтобы сфокусироваться',
} as const;

const WIDTH_SHARE = 0.8;
/** Штрихкод вытянут по ширине, таблица почти квадратная. */
const ASPECT: Readonly<Record<ScanMode, number>> = { product: 0.6, label: 1 };
/** Высота рамки не больше этой доли экрана: на iPhone SE остаётся место для текста и кнопок. */
const MAX_HEIGHT_SHARE = 0.42;

export function guideFrameSize(screenWidth: number, screenHeight: number, mode: ScanMode = 'product'): { width: number; height: number } {
  const width = Math.round(screenWidth * WIDTH_SHARE);
  const height = Math.round(Math.min(width * ASPECT[mode], screenHeight * MAX_HEIGHT_SHARE));
  return { width, height };
}
