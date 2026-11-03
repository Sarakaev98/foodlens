import { NOT_DETECTED, NUTRIENT_KEYS } from '@foodlens/core';
import type { ScanResult } from '../scan.service';

/** Source acceptance tests inspect only verified source evidence after the full API call.
 * The returned score and metadata remain the actual final API result (including estimates).
 * The separate nutrition-estimator suite tests the unmodified completed API product.
 */
export function sourceEvidenceView(result: ScanResult): ScanResult {
  const { product } = result;
  if (!product.nutrition || !product.nutritionMetadata) return result;
  const fields = product.nutritionMetadata.fields;
  const accepted = NUTRIENT_KEYS.filter(key => fields[key].quality === 'verified');
  const nutrition = accepted.length === 0 && product.nutritionMetadata.basis.quality === 'estimated' ? null
    : { ...product.nutrition, ...Object.fromEntries(NUTRIENT_KEYS.filter(key => fields[key].quality !== 'verified').map(key => [key, NOT_DETECTED])) };
  return { ...result, product: { ...product, nutrition } };
}
