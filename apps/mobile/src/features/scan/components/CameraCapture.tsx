import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions, type FocusMode } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, CenteredMessage, colors, radius, spacing, typography } from '@/shared/ui';
import { createBarcodeDetector, PRODUCT_BARCODE_TYPES, type BarcodeEvent } from '../barcode/barcodeDetector';
import { SCAN_FAILURE_MESSAGES } from '../scanErrors';
import { SCAN_GUIDE_TEXT } from '../scanGuide';
import type { ScanMode, ScanPhoto } from '../types/scan.types';
import { CameraGuide } from './CameraGuide';
import { FocusIndicator } from './FocusIndicator';

interface CameraCaptureProps {
  readonly mode: ScanMode;
  /** Нет при съёмке дополнительного фото: режим уже выбран. */
  readonly onModeChange?: (mode: ScanMode) => void;
  /** Режимы переключателя. Без «Еды», если функция выключена флагом mealPhoto. */
  readonly modes?: readonly ScanMode[];
  /** barcode: последний свежий штрихкод с камеры или null. Сам по себе он ничего не отправляет. */
  readonly onCaptured: (photo: ScanPhoto, barcode: string | null) => void;
  /** Новый код с камеры, ещё до снимка. */
  readonly onBarcodeDetected?: (barcode: string) => void;
  readonly onCaptureFailed: () => void;
  /** Анализ только по штрихкоду. Нет при съёмке дополнительного фото. */
  readonly onAnalyzeBarcode?: (barcode: string) => void;
  readonly onPickFromGallery: () => void;
  /** Дополнительное фото: вернуться к набору без снимка. */
  readonly onCancel?: () => void;
}

/** Короткие подписи: три вкладки помещаются в строку и на iPhone SE. */
export const SCAN_MODE_LABELS: Readonly<Record<ScanMode, string>> = { product: 'Продукт', label: 'Таблица', meal: 'Еда' };
const ALL_MODES: readonly ScanMode[] = ['product', 'label', 'meal'];

/** Разовая фокусировка: столько держим режим "on", потом возвращаем непрерывный автофокус. */
const REFOCUS_MS = 1200;

export function CameraCapture({ mode, onModeChange, modes = ALL_MODES, onCaptured, onBarcodeDetected, onAnalyzeBarcode, onCaptureFailed, onPickFromGallery, onCancel }: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [detector] = useState(() => createBarcodeDetector());
  const [detected, setDetected] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [autofocus, setAutofocus] = useState<FocusMode>('off');
  const [focusPulse, setFocusPulse] = useState(0);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();

  useEffect(() => () => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
  }, []);

  if (!permission) return <CenteredMessage loading />;

  if (!permission.granted) {
    const denied = SCAN_FAILURE_MESSAGES.camera_permission_denied;
    return (
      <SafeAreaView style={styles.permission}>
        <Text style={typography.title}>Сканирование</Text>
        <Text style={typography.subtitle}>
          {permission.canAskAgain
            ? 'Чтобы распознать продукт, FoodLens нужен доступ к камере. Фото используется только для анализа и не сохраняется.'
            : denied.description}
        </Text>
        {permission.canAskAgain ? (
          <Button label="Разрешить доступ к камере" onPress={() => void requestPermission()} />
        ) : (
          <Button label="Открыть настройки" onPress={() => void Linking.openSettings()} />
        )}
        <Button label="Выбрать из галереи" variant="secondary" onPress={onPickFromGallery} />
      </SafeAreaView>
    );
  }

  const capture = async () => {
    if (!camera.current || capturing) return;
    setCapturing(true);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.9, exif: false, shutterSound: false });
      if (!picture?.uri) throw new Error('No picture');
      onCaptured({ uri: picture.uri, width: picture.width, height: picture.height }, mode === 'product' ? detector.latest() : null);
    } catch {
      onCaptureFailed();
    } finally {
      setCapturing(false);
    }
  };

  // Первый найденный код запоминается, и сканер останавливается до «Другой штрихкод»: без повторных срабатываний.
  const onBarcodeScanned = (event: BarcodeEvent) => {
    const code = detector.accept(event);
    if (!code) return;
    onBarcodeDetected?.(code);
    setDetected(code);
  };

  const scanAgain = () => {
    detector.reset();
    setDetected(null);
  };

  // Точки фокуса в expo-camera нет: нажатие запускает настоящую разовую фокусировку всего кадра, поэтому индикатор в центре рамки.
  const refocus = () => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
    setAutofocus('on');
    setFocusPulse((pulse) => pulse + 1);
    focusTimer.current = setTimeout(() => setAutofocus('off'), REFOCUS_MS);
  };

  const selectMode = (next: ScanMode) => {
    scanAgain();
    onModeChange?.(next);
  };

  const scanning = mode === 'product' && detected === null;

  return (
    <View style={styles.container}>
      {/*
        autofocus="off" на iOS — это continuousAutoFocus (камера сама перефокусируется при движении);
        "on" — разовый фокус с блокировкой, он нужен только на момент нажатия (refocus).
        zoom=0: без цифрового зума, чтобы не терять резкость мелкого текста.
      */}
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        autofocus={autofocus}
        enableTorch={torch}
        zoom={0}
        barcodeScannerSettings={BARCODE_SETTINGS}
        onBarcodeScanned={scanning ? onBarcodeScanned : undefined}
        onCameraReady={() => setReady(true)}
        onMountError={onCaptureFailed}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={SCAN_GUIDE_TEXT.focusHint} style={StyleSheet.absoluteFill} onPress={refocus} />
      <CameraGuide screenWidth={screen.width} screenHeight={screen.height} barcodeFound={detected !== null} mode={mode} />
      <FocusIndicator pulse={focusPulse} />

      <View style={[styles.top, { top: insets.top + spacing.sm }]}>
        {onModeChange ? (
          <View style={styles.modes} accessibilityRole="tablist">
            {modes.map((id) => (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: id === mode }}
                onPress={() => selectMode(id)}
                style={[styles.mode, id === mode && styles.modeActive]}
              >
                <Text style={[styles.modeLabel, id === mode && styles.modeLabelActive]} numberOfLines={1} adjustsFontSizeToFit>
                  {SCAN_MODE_LABELS[id]}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.modes} />
        )}
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Фонарик"
          accessibilityState={{ checked: torch }}
          hitSlop={8}
          onPress={() => setTorch((on) => !on)}
          style={[styles.torch, torch && styles.torchOn]}
        >
          <Ionicons name={torch ? 'flash' : 'flash-outline'} size={20} color={torch ? colors.textPrimary : '#fff'} />
        </Pressable>
      </View>

      {detected ? (
        <View style={[styles.barcodeAction, { bottom: insets.bottom + BOTTOM_GAP + SHUTTER + spacing.md }]}>
          <Text style={styles.found} accessibilityLiveRegion="polite">
            {SCAN_GUIDE_TEXT.barcodeFound} · {detected}
          </Text>
          {onAnalyzeBarcode ? <Button label="Анализировать продукт" onPress={() => onAnalyzeBarcode(detected)} /> : null}
          <Pressable accessibilityRole="button" onPress={scanAgain} hitSlop={6}>
            <Text style={styles.scanAgain}>Другой штрихкод</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.controls, { bottom: insets.bottom + BOTTOM_GAP }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Выбрать из галереи" onPress={onPickFromGallery} style={styles.sideButton}>
          <Ionicons name="images-outline" size={24} color="#fff" />
          <Text style={styles.sideLabel}>Галерея</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Сделать снимок"
          disabled={!ready || capturing}
          onPress={() => void capture()}
          style={({ pressed }) => [styles.shutter, (!ready || capturing) && styles.shutterDisabled, pressed && styles.shutterPressed]}
        >
          {capturing ? <ActivityIndicator color={colors.accent} /> : <View style={styles.shutterInner} />}
        </Pressable>
        {onCancel ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Отменить съёмку" onPress={onCancel} style={styles.sideButton}>
            <Ionicons name="close-outline" size={26} color="#fff" />
            <Text style={styles.sideLabel}>Отмена</Text>
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
      </View>
    </View>
  );
}

/** Константа, а не литерал в JSX: новый объект на каждом рендере заставил бы перенастраивать сканер. */
const BARCODE_SETTINGS = { barcodeTypes: [...PRODUCT_BARCODE_TYPES] };
const SHUTTER = 78;
const BOTTOM_GAP = spacing.lg;
const TORCH = 40;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  permission: { flex: 1, padding: spacing.lg, gap: spacing.md, justifyContent: 'center', backgroundColor: colors.background },
  top: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modes: { flex: 1, flexDirection: 'row', padding: 3, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.5)' },
  mode: { flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: radius.md - 3, alignItems: 'center' },
  modeActive: { backgroundColor: '#fff' },
  modeLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  modeLabelActive: { color: colors.textPrimary },
  torch: { width: TORCH, height: TORCH, borderRadius: TORCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  torchOn: { backgroundColor: '#FDE68A' },
  barcodeAction: { position: 'absolute', left: spacing.lg, right: spacing.lg, gap: spacing.sm },
  found: {
    alignSelf: 'center',
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    backgroundColor: 'rgba(47,143,78,0.95)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 14,
    overflow: 'hidden',
  },
  scanAgain: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center', padding: spacing.xs },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  shutter: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: SHUTTER - 18, height: SHUTTER - 18, borderRadius: (SHUTTER - 18) / 2, backgroundColor: '#fff' },
  shutterDisabled: { opacity: 0.4 },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  sideButton: { width: 84, alignItems: 'center', gap: 2 },
  sideLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
