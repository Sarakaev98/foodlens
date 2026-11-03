import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, radius, spacing, typography } from '@/shared/ui';
import { EXTRA_PHOTO_OPTIONS, MAX_SCAN_PHOTOS, SCAN_PHOTO_LABELS } from '../services/scanPhotos';
import type { ScanPhotoRole, ScanSlot } from '../types/scan.types';

interface PhotoPreviewProps {
  readonly photos: readonly ScanSlot[];
  readonly barcode?: string | null;
  readonly notice?: string | null;
  /** false в режиме таблицы: там анализируется ровно одно фото. */
  readonly allowExtraPhotos?: boolean;
  /** Подпись вместо роли фото: в режиме еды это «Фото блюда». */
  readonly photoLabel?: string;
  readonly onAnalyze: () => void;
  readonly onAddPhoto: (role: ScanPhotoRole) => void;
  readonly onRetake: (index: number) => void;
  readonly onRemove: (index: number) => void;
}

/**
 * Выбранный снимок на всю ширину (contain), чтобы проверить, читается ли этикетка.
 * Под ним миниатюры с подписями; лишнее фото можно убрать, не теряя остальные. Отправка только по кнопке.
 */
export function PhotoPreview({ photos, barcode, notice, allowExtraPhotos = true, photoLabel, onAnalyze, onAddPhoto, onRetake, onRemove }: PhotoPreviewProps) {
  const [selected, setSelected] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const index = selected < photos.length ? selected : 0;
  const current = photos[index]!;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Image source={{ uri: current.photo.uri }} style={styles.image} resizeMode="contain" accessibilityLabel={`Снимок: ${photoLabel ?? SCAN_PHOTO_LABELS[current.role]}`} />
      <View style={styles.strip}>
        {photos.map((slot, i) => {
          const label = photoLabel ?? SCAN_PHOTO_LABELS[slot.role];
          return (
            <View key={slot.photo.uri} style={styles.slot}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Показать: ${label}`}
                accessibilityState={{ selected: i === index }}
                onPress={() => setSelected(i)}
              >
                <Image source={{ uri: slot.photo.uri }} style={[styles.thumbnail, i === index && styles.thumbnailSelected]} resizeMode="cover" />
              </Pressable>
              <Text style={styles.label} numberOfLines={2}>
                {label}
              </Text>
              <SlotAction text="Переснять" accessibilityLabel={`Переснять: ${label}`} onPress={() => onRetake(i)} />
              {photos.length > 1 ? <SlotAction text="Убрать" accessibilityLabel={`Убрать: ${label}`} onPress={() => onRemove(i)} /> : null}
            </View>
          );
        })}
      </View>
      <View style={styles.actions}>
        {barcode ? <Text style={[typography.caption, styles.center]}>Штрихкод: {barcode}</Text> : null}
        {notice ? <Text style={[typography.caption, styles.center]}>{notice}</Text> : null}
        {choosing ? (
          <>
            <Text style={[typography.subtitle, styles.center]}>Что сфотографировать дополнительно?</Text>
            {EXTRA_PHOTO_OPTIONS.map((option) => (
              <Button
                key={option.role}
                label={option.label}
                onPress={() => {
                  setChoosing(false);
                  onAddPhoto(option.role);
                }}
              />
            ))}
            <Button label="Отмена" variant="secondary" onPress={() => setChoosing(false)} />
          </>
        ) : (
          <>
            <Button label="Анализировать" onPress={onAnalyze} />
            {!allowExtraPhotos ? null : photos.length < MAX_SCAN_PHOTOS ? (
              <Button label="Добавить фото" variant="secondary" onPress={() => setChoosing(true)} />
            ) : (
              <Text style={[typography.caption, styles.center]}>Максимум {MAX_SCAN_PHOTOS} фото</Text>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function SlotAction({ text, accessibilityLabel, onPress }: { readonly text: string; readonly accessibilityLabel: string; readonly onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={6} onPress={onPress}>
      <Text style={styles.slotAction}>{text}</Text>
    </Pressable>
  );
}

const THUMBNAIL = 56;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  image: { flex: 1, width: '100%', marginVertical: spacing.sm, backgroundColor: '#000' },
  center: { textAlign: 'center' },
  strip: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  slot: { flex: 1, maxWidth: 112, alignItems: 'center', gap: 2 },
  thumbnail: { width: THUMBNAIL, height: THUMBNAIL, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.border },
  thumbnailSelected: { borderColor: colors.accent },
  label: { fontSize: 12, lineHeight: 15, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
  slotAction: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.accent, textAlign: 'center' },
  actions: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
});
