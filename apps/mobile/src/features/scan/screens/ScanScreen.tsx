import { AnalyzingView } from '../components/AnalyzingView';
import { CameraCapture } from '../components/CameraCapture';
import { PhotoPreview } from '../components/PhotoPreview';
import { ScanErrorView } from '../components/ScanErrorView';
import { useProductScan } from '../hooks/useProductScan';
import { ProductResultScreen } from './ProductResultScreen';

/** Камера или галерея → предпросмотр → анализ → результат. Состояние целиком в useProductScan. */
export function ScanScreen() {
  const scan = useProductScan();
  const { state } = scan;

  switch (state.status) {
    case 'capturing':
      return (
        <CameraCapture
          onCaptured={scan.onPhotoCaptured}
          onCaptureFailed={scan.onCaptureFailed}
          onPickFromGallery={scan.pickFromGallery}
        />
      );
    case 'preview':
      return <PhotoPreview photo={state.photo} onAnalyze={scan.analyze} onRetake={scan.reset} />;
    case 'analyzing':
      return <AnalyzingView photo={state.photo} stage={state.stage} onCancel={scan.reset} />;
    case 'result':
      return <ProductResultScreen product={state.product} photo={state.photo} onScanAnother={scan.reset} />;
    case 'error':
      return <ScanErrorView code={state.code} canRetry={state.photo !== null} onRetry={scan.analyze} onScanAgain={scan.reset} />;
  }
}
