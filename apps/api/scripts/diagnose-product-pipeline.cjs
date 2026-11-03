/* Read-only live diagnostic. Build first: pnpm build.
 * Usage: node apps/api/scripts/diagnose-product-pipeline.cjs <barcode> [barcode...]
 * Uses configured provider budgets and may consume Tavily/Gemini credits.
 * Never prints environment variables, keys, request headers or response bodies.
 */
const fs = require('node:fs');
const path = require('node:path');
const api = path.resolve(__dirname, '..');
const envFile = path.join(api, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const { loadAppConfig } = require(path.join(api, 'dist/config/app-config'));
const { createProductLookupSources } = require(path.join(api, 'dist/modules/product-lookup/product-lookup.module'));
const { MultiSourceProductLookup } = require(path.join(api, 'dist/modules/product-lookup/multi-source-product-lookup'));
const { ScanService } = require(path.join(api, 'dist/modules/scan/scan.service'));
const { parseScanBarcode } = require(path.join(api, 'dist/modules/scan/scan-barcode'));

async function main() {
  const barcodes = process.argv.slice(2);
  if (!barcodes.length || barcodes.some(code => parseScanBarcode(code) !== code)) throw new Error('Pass valid barcode arguments');
  const config = loadAppConfig(process.env);
  const sources = createProductLookupSources(config);
  console.log('DIAGNOSTIC_CONFIG', JSON.stringify({ sources: sources.map(source => source.name), webSearch: config.productLookup.webSearch }));
  const ai = { name: 'diagnostic', analyzeProduct: async () => { throw new Error('No photos in this diagnostic'); } };
  const plans = { findPlanForUser: async () => null };
  const service = new ScanService(ai, plans, undefined, new MultiSourceProductLookup(sources));
  for (const barcode of barcodes) {
    const { product, score, needsPhoto, status } = await service.analyze(undefined, 'diagnostic', { barcode });
    console.log('DIAGNOSTIC_RESULT', JSON.stringify({ barcode, name: product.name, brand: product.brand, nutrition: product.nutrition,
      fieldEvidence: product.fieldEvidence, nutritionMetadata: product.nutritionMetadata, score, needsPhoto: needsPhoto ?? false, status: status ?? 'complete' }));
  }
}
main().catch(() => { console.error('Diagnostic failed; inspect the categorical provider logs above.'); process.exitCode = 1; });
