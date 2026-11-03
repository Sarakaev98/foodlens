import type { GoalMatchFactor, GoalMatchLevel, Product } from '@foodlens/core';
import { StyleSheet, Text, View } from 'react-native';
import { GOAL_LABELS } from '@/features/profile';
import { colors, radius, spacing, typography } from '@/shared/ui';
import {
  LEVEL_VERDICTS, unavailableMessage, approximateNote, dietVerificationNotes, factorReason, formatGoalMatchValue,
  aiFactorReason, goalMatchSourceLabel, isTenPointScale, type AnyGoalMatch,
} from '../goalMatchLabels';

/** Самые весомые причины: карточка короче, чем «Product Score», и не повторяет её. */
const MAX_REASONS = 3;

const RESTRICTION_KINDS: readonly GoalMatchFactor['kind'][] = ['allergens', 'diet', 'avoidedIngredients'];

function tone(level: GoalMatchLevel) {
  if (level === 'great' || level === 'good') return { color: colors.accent, background: colors.accentSoft };
  if (level === 'fair') return { color: colors.warning, background: colors.warningSoft };
  return { color: colors.danger, background: '#FDECE3' };
}

/** Сначала ограничения профиля (аллергены, диета), потом остальное по весу. */
function topReasons(factors: readonly GoalMatchFactor[], version: AnyGoalMatch['version'] = 'goal-match-v1') {
  const weight = (factor: GoalMatchFactor) => (factor.level === 'conflict' ? 1000 : 0) + Math.abs(factor.points);
  return [...factors]
    .sort((a, b) => weight(b) - weight(a))
    .map((factor) => ({ factor, reason: factorReason(factor, version) }))
    .filter((item): item is { factor: GoalMatchFactor; reason: NonNullable<ReturnType<typeof factorReason>> } => item.reason !== null)
    .slice(0, MAX_REASONS);
}

interface ShownReason { readonly key: string; readonly impact: GoalMatchFactor['impact']; readonly text: string; readonly detail: string | null }

/**
 * v4 с source=ai: сначала ограничения профиля (их применяет код), затем причины AI, всего до трёх.
 * Остальные случаи: прежние детерминированные причины.
 */
function shownReasons(goalMatch: AnyGoalMatch): ShownReason[] {
  const deterministic = topReasons(goalMatch.factors, goalMatch.version)
    .map(({ factor, reason }) => ({ key: factor.id, impact: reason.impact ?? factor.impact, text: reason.text, detail: reason.detail }));
  if (goalMatch.version !== 'goal-match-v4' || goalMatch.source !== 'ai' || !goalMatch.ai) return deterministic;
  const ai = goalMatch.ai.factors.map((factor) => ({ key: 'ai.' + factor.code, ...aiFactorReason(factor) }));
  return [...deterministic, ...ai].slice(0, MAX_REASONS);
}

/** Пояснения о том, что не проверено: без них пользователь решит, что всё в порядке. */
function notes(goalMatch: AnyGoalMatch): string[] {
  const byKind = (kind: GoalMatchFactor['kind']) => goalMatch.factors.find((factor) => factor.kind === kind);
  const result: string[] = [];
  if (!isTenPointScale(goalMatch) && goalMatch.portion?.basis === 'per_100' && goalMatch.value !== null && goalMatch.level !== 'conflict') {
    result.push('Serving size isn’t listed, so the share of daily calories wasn’t calculated.');
  }
  if (byKind('allergens')?.level === 'not_counted') result.push('No allergens found in the photo. Please check the package.');
  result.push(...dietVerificationNotes(byKind('diet')));
  if (byKind('avoidedIngredients')?.level === 'not_counted') result.push('Ingredients weren’t read, so foods you avoid weren’t checked.');
  if (isTenPointScale(goalMatch) && goalMatch.uncertainty.includes('protein')) {
    result.push('Protein isn’t listed, so it wasn’t counted.');
  }
  if (isTenPointScale(goalMatch) && goalMatch.uncertainty.includes('fiber')) {
    result.push('Fiber isn’t listed, so it wasn’t counted.');
  }
  return result;
}

export function GoalMatchCard({ goalMatch, product }: { readonly goalMatch: AnyGoalMatch; readonly product?: Product }) {
  const goal = goalMatch.goal ? `Goal: ${GOAL_LABELS[goalMatch.goal]}` : null;
  const warnings = goalMatch.factors.filter((factor) => RESTRICTION_KINDS.includes(factor.kind));

  if (isTenPointScale(goalMatch) && goalMatch.state === 'not_applicable') {
    const reasons = topReasons(warnings, goalMatch.version);
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Goal Match</Text>
        {goal ? <Text style={typography.caption}>{goal}</Text> : null}
        <Text style={typography.subtitle}>Doesn’t affect your goal</Text>
        {reasons.map(({ factor, reason }) => (
          <Reason key={factor.id} impact={factor.impact} text={reason.text} detail={reason.detail} />
        ))}
        {notes(goalMatch).map((note) => <Text key={note} style={typography.caption}>{note}</Text>)}
      </View>
    );
  }

  if (goalMatch.value === null || goalMatch.level === null) {
    const reasons = topReasons(warnings, goalMatch.version);
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Goal Match</Text>
        {goal ? <Text style={typography.caption}>{goal}</Text> : null}
        <Text style={typography.subtitle}>{unavailableMessage(goalMatch, product)}</Text>
        {reasons.map(({ factor, reason }) => (
          <Reason key={factor.id} impact={reason.impact ?? factor.impact} text={reason.text} detail={reason.detail} />
        ))}
        {notes(goalMatch).map((note) => (
          <Text key={note} style={typography.caption}>
            {note}
          </Text>
        ))}
      </View>
    );
  }

  const { color, background } = tone(goalMatch.level);
  const reasons = shownReasons(goalMatch);
  const displayValue = formatGoalMatchValue(goalMatch);
  const approximate = isTenPointScale(goalMatch) && goalMatch.confidence === 'low' && goalMatch.portion?.basis === 'per_100';
  const sourceLabel = goalMatchSourceLabel(goalMatch);
  const summary = goalMatch.version === 'goal-match-v4' && goalMatch.source === 'ai' ? goalMatch.ai?.summary ?? null : null;

  return (
    <View style={styles.card} accessible accessibilityLabel={`Goal Match: ${approximate ? 'about ' : ''}${displayValue} out of 10, ${LEVEL_VERDICTS[goalMatch.level]}`}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: background }]}>
          <Text style={[styles.value, { color }]}>{displayValue}</Text>
          <Text style={[styles.outOf, { color }]}>/ 10</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Goal Match</Text>
          {goalMatch.goal === 'eat_healthier' ? <Text style={typography.caption}>How well it fits your goal to eat healthier</Text> : null}
          <Text style={[styles.verdict, { color }]}>{LEVEL_VERDICTS[goalMatch.level]}</Text>
          {approximate ? <Text style={typography.caption}>{approximateNote(goalMatch)}</Text> : null}
          {goal ? <Text style={typography.caption}>{goal}</Text> : null}
          {sourceLabel ? <Text style={typography.caption}>{sourceLabel}</Text> : null}
        </View>
      </View>

      {summary ? <Text style={styles.summary}>{summary}</Text> : null}

      {reasons.length > 0 ? (
        <View style={styles.reasons}>
          {reasons.map((reason) => (
            <Reason key={reason.key} impact={reason.impact} text={reason.text} detail={reason.detail} />
          ))}
        </View>
      ) : null}

      {notes(goalMatch).map((note) => (
        <Text key={note} style={typography.caption}>
          {note}
        </Text>
      ))}
      <Text style={typography.caption}>Compared with the daily goals in your profile. Not medical advice.</Text>
    </View>
  );
}

function Reason({ impact, text, detail }: { readonly impact: GoalMatchFactor['impact']; readonly text: string; readonly detail: string | null }) {
  const color = impact === 'positive' ? colors.accent : impact === 'negative' ? colors.danger : colors.textSecondary;
  const icon = impact === 'positive' ? '+' : impact === 'negative' ? '−' : '·';
  return (
    <View style={styles.reason}>
      <Text style={[styles.reasonIcon, { color }]}>{icon}</Text>
      <Text style={styles.reasonText}>
        {text}
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
  summary: { fontSize: 15, lineHeight: 20, color: colors.textPrimary },
  reasons: { gap: 4 },
  reason: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  reasonIcon: { width: 14, fontSize: 16, fontWeight: '800', lineHeight: 20, textAlign: 'center' },
  reasonText: { flex: 1, fontSize: 15, lineHeight: 20, color: colors.textPrimary },
  reasonDetail: { color: colors.textSecondary },
});
