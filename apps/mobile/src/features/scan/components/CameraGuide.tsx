import { StyleSheet, Text, View } from 'react-native';
import { spacing } from '@/shared/ui';
import { guideFrameSize, SCAN_GUIDE_TEXT } from '../scanGuide';
import type { ScanMode } from '../types/scan.types';

interface CameraGuideProps {
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly barcodeFound: boolean;
  readonly mode: ScanMode;
}

/**
 * Рамка с уголками и подсказки поверх CameraView. pointerEvents="none": нажатия уходят камере и кнопкам.
 * Это обычные RN-view над превью, поэтому takePictureAsync их не снимает.
 */
export function CameraGuide({ screenWidth, screenHeight, barcodeFound, mode }: CameraGuideProps) {
  const frame = guideFrameSize(screenWidth, screenHeight, mode);
  const text = SCAN_GUIDE_TEXT[mode];
  return (
    <View pointerEvents="none" style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        {text.title}
      </Text>
      <View accessible accessibilityLabel={text.frameAccessibilityLabel} style={[styles.frame, frame]}>
        {CORNERS.map((corner, index) => (
          <View key={index} style={[styles.corner, corner, barcodeFound && styles.cornerFound]} />
        ))}
      </View>
      {barcodeFound ? null : <Text style={styles.hint}>{text.hint}</Text>}
      {barcodeFound ? (
        <Text style={styles.found} accessibilityLiveRegion="polite">
          {SCAN_GUIDE_TEXT.barcodeFound}
        </Text>
      ) : null}
    </View>
  );
}

const CORNER = 28;
const STROKE = 4;
/** Место под кнопку спуска внизу, чтобы рамка была по центру видимой области. */
const CONTROLS_SPACE = 140;

const CORNER_STYLES = StyleSheet.create({
  topLeft: { top: -1, left: -1, borderTopWidth: STROKE, borderLeftWidth: STROKE, borderTopLeftRadius: 18 },
  topRight: { top: -1, right: -1, borderTopWidth: STROKE, borderRightWidth: STROKE, borderTopRightRadius: 18 },
  bottomLeft: { bottom: -1, left: -1, borderBottomWidth: STROKE, borderLeftWidth: STROKE, borderBottomLeftRadius: 18 },
  bottomRight: { bottom: -1, right: -1, borderBottomWidth: STROKE, borderRightWidth: STROKE, borderBottomRightRadius: 18 },
});
const CORNERS = [CORNER_STYLES.topLeft, CORNER_STYLES.topRight, CORNER_STYLES.bottomLeft, CORNER_STYLES.bottomRight];

const styles = StyleSheet.create({
  cornerFound: { borderColor: '#4ADE80' },
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: CONTROLS_SPACE,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  frame: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.5)' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#fff' },
  hint: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 10,
    overflow: 'hidden',
  },
  found: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    backgroundColor: 'rgba(47,143,78,0.9)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 14,
    overflow: 'hidden',
  },
});
