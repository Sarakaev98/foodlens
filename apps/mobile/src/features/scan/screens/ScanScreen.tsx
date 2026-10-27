import { StyleSheet, Text } from 'react-native';
import { ScreenPlaceholder, colors } from '@/shared/ui';
import { useAvailableScanModes } from '../hooks/useAvailableScanModes';
import type { ScanMode } from '../types/scan.types';

const SCAN_MODE_LABELS: Record<ScanMode, string> = {
  photo: 'Фото продукта',
  barcode: 'Штрихкод',
};

export function ScanScreen() {
  const modes = useAvailableScanModes();

  return (
    <ScreenPlaceholder title="Сканирование" description="Здесь будет камера для распознавания продукта.">
      <Text style={styles.modes}>Способы: {modes.map((mode) => SCAN_MODE_LABELS[mode]).join(', ')}</Text>
    </ScreenPlaceholder>
  );
}

const styles = StyleSheet.create({
  modes: {
    fontSize: 13,
    color: colors.accent,
  },
});
