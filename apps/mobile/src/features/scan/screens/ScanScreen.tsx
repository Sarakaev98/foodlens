import { useFeatureFlag } from '@/shared/feature-flags';
import { AnalyzingView } from '../components/AnalyzingView';
import { CameraCapture } from '../components/CameraCapture';
import { PhotoPreview } from '../components/PhotoPreview';
import { ScanErrorView } from '../components/ScanErrorView';
import { useProductScan } from '../hooks/useProductScan';
import { MealResultScreen } from './MealResultScreen';
import { ProductResultScreen } from './ProductResultScreen';

const PRODUCT_MODES = ['product', 'label'] as const;
const ALL_MODES = ['product', 'label', 'meal'] as const;

/**
 * Режим «продукт», «таблица» или «еда», камера или галерея → предпросмотр → анализ → результат. Состояние целиком в useProductScan.
 * «Еда» (оценка блюда по фото) скрыта флагом mealPhoto.
 */
export function ScanScreen() {
  const scan = useProductScan();
  const { state } = scan;
  const mealPhoto = useFeatureFlag('mealPhoto');

  switch (state.status) {
    case 'capturing':
      return (
        <CameraCapture
          mode={scan.mode}
          onModeChange={state.target ? undefined : scan.setMode}
          modes={mealPhoto ? ALL_MODES : PRODUCT_MODES}
          onCaptured={scan.onPhotoCaptured}
          onBarcodeDetected={scan.onBarcodeDetected}
          onAnalyzeBarcode={state.target || scan.mode === 'label' ? undefined : scan.analyzeBarcode}
          onCaptureFailed={scan.onCaptureFailed}
          onPickFromGallery={scan.pickFromGallery}
          onCancel={state.target ? scan.backToPhotos : undefined}
        />
      );
    case 'preview':
      return (
        <PhotoPreview
          photos={state.photos}
          barcode={state.barcode}
          notice={state.notice}
          allowExtraPhotos={scan.mode === 'product'}
          photoLabel={scan.mode === 'meal' ? 'Meal photo' : undefined}
          onAnalyze={scan.analyze}
          onAddPhoto={scan.addPhoto}
          onRetake={scan.retakePhoto}
          onRemove={scan.removePhoto}
        />
      );
    case 'analyzing':
      return <AnalyzingView photo={state.photo} mode={scan.mode} onCancel={scan.reset} />;
    case 'result':
      return (
        <ProductResultScreen
          product={state.product}
          score={state.score}
          goalMatch={state.goalMatch}
          photo={state.photo}
          barcode={state.barcode}
          onTakeNutritionPhoto={state.needsPhoto ? scan.takeNutritionPhoto : undefined}
          onScanAnother={scan.reset}
        />
      );
    case 'meal_result':
      return <MealResultScreen estimate={state.estimate} photo={state.photo} onScanAnother={scan.reset} />;
    case 'error':
      return (
        <ScanErrorView
          code={state.code}
          canRetry={state.photo !== null}
          onRetry={scan.analyze}
          onScanAgain={scan.reset}
          onEditPhotos={state.canEditPhotos ? scan.backToPhotos : undefined}
        />
      );
  }
}
