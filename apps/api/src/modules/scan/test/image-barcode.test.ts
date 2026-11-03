import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidProductBarcode, readImageBarcode } from '../image-barcode';

// Картинки создаёт bwip-js прямо в тесте: сеть и внешние файлы не нужны.
const bwip = require('bwip-js') as { toBuffer(options: Record<string, unknown>): Promise<Buffer> };
const barcode = (bcid: string, text: string, extra: Record<string, unknown> = {}) =>
  bwip.toBuffer({ bcid, text, scale: 3, height: 20, includetext: false, backgroundcolor: 'FFFFFF', paddingwidth: 20, paddingheight: 20, ...extra });

describe('Barcode from an uploaded image', () => {
  it('reads EAN-13, EAN-8 and UPC-A', async () => {
    assert.equal(await readImageBarcode([{ buffer: await barcode('ean13', '5449000054227') }]), '5449000054227');
    assert.equal(await readImageBarcode([{ buffer: await barcode('ean8', '96385074') }]), '96385074');
    assert.equal(await readImageBarcode([{ buffer: await barcode('upca', '036000291452') }]), '0036000291452', 'UPC-A приходит как EAN-13 с ведущим нулём');
  });
  it('reads a rotated image', async () => {
    for (const rotate of ['R', 'L', 'I']) assert.equal(await readImageBarcode([{ buffer: await barcode('ean13', '4823077621154', { rotate }) }]), '4823077621154', rotate);
  });
  it('reads a photo set: the code may be on any photo', async () => {
    const qr = await barcode('qrcode', 'not a product');
    assert.equal(await readImageBarcode([{ buffer: qr }, { buffer: await barcode('ean13', '5449000054227') }]), '5449000054227');
  });
  it('no product barcode or an unreadable file: null, without an error', async () => {
    assert.equal(await readImageBarcode([{ buffer: await barcode('qrcode', 'not a product') }]), null);
    assert.equal(await readImageBarcode([{ buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) }]), null);
    assert.equal(await readImageBarcode([]), null);
  });
  it('checks the control digit', () => {
    assert.equal(isValidProductBarcode('EAN13', '5449000054227'), true);
    assert.equal(isValidProductBarcode('EAN13', '5449000054228'), false);
    assert.equal(isValidProductBarcode('EAN8', '96385074'), true);
    assert.equal(isValidProductBarcode('EAN8', '96385075'), false);
    assert.equal(isValidProductBarcode('UPCA', '036000291452'), true);
    assert.equal(isValidProductBarcode('UPCA', '036000291453'), false);
    assert.equal(isValidProductBarcode('EAN13', '123'), false);
    assert.equal(isValidProductBarcode('QRCode', '5449000054227'), false);
  });
});
