import type { ProductScore, ScoreFactor } from '@foodlens/core';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/ui';
import { factorDetail, factorReason, formatScore, isPreliminaryScore, partialScoreNote, scoreVerdict, unscoredMessage } from '../productScoreLabels';

/** Сколько причин каждого знака показывать: самые весомые, чтобы карточка не вытесняла пищевую ценность. */
const MAX_REASONS = 4;

interface ProductScoreCardProps {
  readonly score: ProductScore;
  readonly estimated?: boolean;
  /** Значения факторов приведены к 100 г или к 100 мл. */
  readonly per: 'g' | 'ml';
}

function tone(value: number) {
  if (value >= 7) return { color: colors.accent, background: colors.accentSoft };
  if (value >= 5) return { color: colors.warning, background: colors.warningSoft };
  return { color: colors.danger, background: '#FDECE3' };
}

function byId(score: ProductScore, id: ScoreFactor['id']): ScoreFactor {
  return score.factors.find((factor) => factor.id === id)!;
}

function strongest(factors: readonly ScoreFactor[], impact: 'positive' | 'negative'): ScoreFactor[] {
  return factors
    .filter((factor) => factor.impact === impact)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, MAX_REASONS);
}

export function ProductScoreCard({ score, per, estimated = false }: ProductScoreCardProps) {
  if (score.value === null) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Оценка продукта</Text>
        <Text style={typography.subtitle}>{unscoredMessage(score)}</Text>
      </View>
    );
  }

  // Оценка без главных данных не должна выглядеть как хороший или плохой результат: цвет нейтральный.
  const preliminary = isPreliminaryScore(score);
  const { color, background } = preliminary ? { color: colors.textSecondary, background: colors.border } : tone(score.value);
  const positives = strongest(score.factors, 'positive');
  const negatives = strongest(score.factors, 'negative');
  const partial = partialScoreNote(score);

  return (
    <View style={styles.card} accessible accessibilityLabel={`Оценка продукта ${formatScore(score.value)} из 10`}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: background }]}>
          <Text style={[styles.value, { color }]}>{formatScore(score.value)}</Text>
          <Text style={[styles.outOf, { color }]}>/ 10</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Оценка продукта</Text>
          <Text style={typography.caption}>Общее качество продукта</Text>
          <Text style={[styles.verdict, { color }]}>{preliminary ? 'Предварительно' : scoreVerdict(score.value)}</Text>
        </View>
      </View>

      {positives.length + negatives.length > 0 ? (
        <View style={styles.reasons}>
          {positives.map((factor) => (
            <Reason key={factor.id} factor={factor} per={per} />
          ))}
          {negatives.map((factor) => (
            <Reason key={factor.id} factor={factor} per={per} />
          ))}
        </View>
      ) : null}

      {score.ceiling ? (
        <Text style={typography.caption}>
          Оценка не выше {formatScore(score.ceiling.max)}: {score.ceiling.factorIds.map((id) => factorReason(byId(score, id)).toLowerCase()).join(', ')}
        </Text>
      ) : null}
      {preliminary ? <Text style={styles.unreliable}>Данных недостаточно для надёжной оценки</Text> : null}
      {estimated ? <Text style={typography.caption}>Часть пищевых данных оценена автоматически.</Text> : null}
      {partial ? <Text style={[typography.caption, styles.partial]}>{partial}</Text> : null}
      <Text style={typography.caption}>Общая оценка продукта, не зависит от ваших целей.</Text>
    </View>
  );
}

function Reason({ factor, per }: { readonly factor: ScoreFactor; readonly per: 'g' | 'ml' }) {
  const positive = factor.impact === 'positive';
  const detail = factorDetail(factor, per);
  return (
    <View style={styles.reason}>
      <Text style={[styles.reasonIcon, { color: positive ? colors.accent : colors.danger }]}>{positive ? '+' : '−'}</Text>
      <Text style={styles.reasonText}>
        {factorReason(factor)}
        {detail ? <Text style={styles.reasonDetail}> · {detail}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, gap: 2 },
  value: { fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  outOf: { fontSize: 15, fontWeight: '600' },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  verdict: { fontSize: 15, fontWeight: '600' },
  partial: { color: colors.warning },
  unreliable: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.warning },
  reasons: { gap: 4 },
  reason: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  reasonIcon: { width: 14, fontSize: 16, fontWeight: '800', lineHeight: 20, textAlign: 'center' },
  reasonText: { flex: 1, fontSize: 15, lineHeight: 20, color: colors.textPrimary },
  reasonDetail: { color: colors.textSecondary },
});
