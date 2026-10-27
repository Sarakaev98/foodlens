import { useFeatureFlag } from '@/shared/feature-flags';
import type { ScanMode } from '../types/scan.types';

export function useAvailableScanModes(): readonly ScanMode[] {
  const barcodeEnabled = useFeatureFlag('barcode');
  return barcodeEnabled ? ['photo', 'barcode'] : ['photo'];
}
