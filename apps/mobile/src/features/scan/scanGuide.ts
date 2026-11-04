import type { ScanMode } from './types/scan.types';

/** Тексты и размеры рамки-подсказки на экране камеры. Рамка — только оверлей, в снимок она не попадает. */
export const SCAN_GUIDE_TEXT = {
  product: {
    title: 'Point at the Barcode',
    hint: 'Or take a photo of the package',
    frameAccessibilityLabel: 'Barcode frame',
  },
  label: {
    title: 'Point at the Nutrition Label',
    hint: 'Hold your phone closer so the text is sharp',
    frameAccessibilityLabel: 'Nutrition label frame',
  },
  meal: {
    title: 'Take a Photo of Your Plate',
    hint: 'From above or at an angle, with all the food in view',
    frameAccessibilityLabel: 'Plate frame',
  },
  barcodeFound: 'Barcode Found',
  focusHint: 'Tap the screen to focus',
} as const;

const WIDTH_SHARE = 0.8;
/** Штрихкод вытянут по ширине, таблица и тарелка почти квадратные. */
const ASPECT: Readonly<Record<ScanMode, number>> = { product: 0.6, label: 1, meal: 1 };
/** Высота рамки не больше этой доли экрана: на iPhone SE остаётся место для текста и кнопок. */
const MAX_HEIGHT_SHARE = 0.42;

export function guideFrameSize(screenWidth: number, screenHeight: number, mode: ScanMode = 'product'): { width: number; height: number } {
  const width = Math.round(screenWidth * WIDTH_SHARE);
  const height = Math.round(Math.min(width * ASPECT[mode], screenHeight * MAX_HEIGHT_SHARE));
  return { width, height };
}
