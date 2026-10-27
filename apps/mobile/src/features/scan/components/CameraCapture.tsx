import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, CenteredMessage, colors, spacing, typography } from '@/shared/ui';
import { SCAN_FAILURE_MESSAGES } from '../scanErrors';
import type { ScanPhoto } from '../types/scan.types';

interface CameraCaptureProps {
  readonly onCaptured: (photo: ScanPhoto) => void;
  readonly onCaptureFailed: () => void;
  readonly onPickFromGallery: () => void;
}

export function CameraCapture({ onCaptured, onCaptureFailed, onPickFromGallery }: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  if (!permission) return <CenteredMessage loading />;

  if (!permission.granted) {
    const denied = SCAN_FAILURE_MESSAGES.camera_permission_denied;
    return (
      <SafeAreaView style={styles.permission}>
        <Text style={typography.title}>Сканирование</Text>
        <Text style={typography.subtitle}>
          {permission.canAskAgain
            ? 'Чтобы распознать продукт, FoodLens нужен доступ к камере. Фото отправляется только на сервер FoodLens для анализа и не сохраняется.'
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
      onCaptured({ uri: picture.uri, width: picture.width, height: picture.height });
    } catch {
      onCaptureFailed();
    } finally {
      setCapturing(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setReady(true)}
        onMountError={onCaptureFailed}
      />
      <SafeAreaView style={styles.overlay} edges={['top']}>
        <Text style={styles.hint}>Наведите камеру на упаковку: лицевую сторону, состав или таблицу пищевой ценности</Text>
      </SafeAreaView>
      <View style={styles.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel="Выбрать из галереи" onPress={onPickFromGallery} style={styles.galleryButton}>
          <Text style={styles.galleryLabel}>Галерея</Text>
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
        <View style={styles.galleryButton} />
      </View>
    </View>
  );
}

const SHUTTER = 78;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  permission: { flex: 1, padding: spacing.lg, gap: spacing.md, justifyContent: 'center', backgroundColor: colors.background },
  overlay: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  hint: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: spacing.sm,
    borderRadius: 10,
    overflow: 'hidden',
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xl,
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
  galleryButton: { width: 84, alignItems: 'center' },
  galleryLabel: { color: '#fff', fontSize: 15, fontWeight: '600', padding: spacing.sm },
});
