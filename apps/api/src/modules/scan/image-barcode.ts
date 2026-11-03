import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';

/** Общий лимит на все фото запроса: чтение штрихкода не должно заметно задерживать скан. */
export const IMAGE_BARCODE_BUDGET_MS = 1500;
const OPTIONS: ReaderOptions = { formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 1 };

export type ImageBarcodeReader = (images: readonly { readonly buffer: Buffer }[]) => Promise<string | null>;

let prepared = false;

/** WASM читается из пакета: без этого библиотека скачала бы его из CDN. */
function prepare(): void {
  if (prepared) return;
  const file = readFileSync(join(dirname(require.resolve('zxing-wasm/reader')), '..', '..', 'reader', 'zxing_reader.wasm'));
  prepareZXingModule({ overrides: { wasmBinary: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer } });
  prepared = true;
}

/** Контрольная цифра GS1 для EAN-13, EAN-8 и UPC-A. У UPC-E она считается иначе, её проверяет сама библиотека. */
export function isValidProductBarcode(format: string, text: string): boolean {
  if (!/^\d+$/.test(text)) return false;
  if (format === 'UPCE') return text.length === 8;
  const length = format === 'EAN13' ? 13 : format === 'EAN8' ? 8 : format === 'UPCA' ? 12 : 0;
  if (text.length !== length) return false;
  const digits = [...text].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Штрихкод товара с уже сделанного фото: код, без AI и сети. Повороты и уменьшение делает сама библиотека.
 * Ошибка чтения не мешает скану: штрихкода просто нет.
 */
export const readImageBarcode: ImageBarcodeReader = async (images) => {
  const startedAt = Date.now();
  try {
    prepare();
    for (const image of images) {
      if (Date.now() - startedAt >= IMAGE_BARCODE_BUDGET_MS) return null;
      const [found] = await readBarcodes(new Uint8Array(image.buffer), OPTIONS);
      if (found?.isValid && isValidProductBarcode(found.format, found.text)) return found.text;
    }
  } catch {
    return null;
  }
  return null;
};
