import { scoreProduct } from '../../score-product';
import { BENCHMARK, benchmarkProduct, EXPECTED_ORDER, OFF_INCOMPLETE, OFF_REAL, OFF_REAL_STRICT, type BenchmarkItem } from './product-score-benchmark.data';
import { scoreVariant, type Variant } from './product-score-variants';

// Офлайн-отчёт: pnpm --filter @foodlens/scoring benchmark. Сети, целей, порций и AI здесь нет.
const VARIANTS: readonly Variant[] = ['previous', 'A', 'B', 'C', 'C8'];
const fmt = (value: number | null) => (value === null ? '—' : String(value));
const score = (item: BenchmarkItem, variant: Variant = 'C8') => scoreVariant(item, variant).value;
const byName = (name: string) => BENCHMARK.find((item) => item.name === name)!;

function rows() {
  return BENCHMARK.map((item) => {
    const result = scoreProduct(benchmarkProduct(item));
    const points = (kind: string) => result.factors.find((factor) => factor.kind === kind)!.points;
    const bonuses = ['protein', 'fiber'].filter((kind) => points(kind) > 0).map((kind) => `${kind} +${points(kind)}`);
    const penalties = ['sugars', 'saturatedFat', 'salt', 'energy', 'additives'].filter((kind) => points(kind) < 0).map((kind) => `${kind} ${points(kind)}`);
    const raw = Math.round((8 + result.factors.reduce((sum, factor) => sum + factor.points, 0)) * 100) / 100;
    return { item, value: result.value!, raw, bonuses, penalties, cap: result.ceiling ? `потолок ${result.ceiling.max}` : raw < 0 ? 'clamp 0' : raw > 10 ? 'clamp 10' : '' };
  }).sort((a, b) => b.value - a.value || b.raw - a.raw);
}

function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (values: readonly number[]) => values.map((value) => values.filter((other) => other < value).length + (values.filter((other) => other === value).length - 1) / 2);
  const [x, y] = [rank(a), rank(b)];
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const [mx, my] = [mean(x), mean(y)];
  const cov = x.reduce((sum, value, index) => sum + (value - mx) * (y[index]! - my), 0);
  return cov / Math.sqrt(x.reduce((sum, value) => sum + (value - mx) ** 2, 0) * y.reduce((sum, value) => sum + (value - my) ** 2, 0));
}

function distribution(variant: Variant, set: readonly BenchmarkItem[] = BENCHMARK) {
  const values = set.map((item) => score(item, variant));
  const count = (test: (value: number) => boolean) => values.filter(test).length;
  const below2 = values.filter((value) => value <= 2);
  return { zero: count((value) => value === 0), upTo1: count((value) => value <= 1), upTo2: count((value) => value <= 2), from9: count((value) => value >= 9), ten: count((value) => value === 10),
    mean: Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100, distinctBottom: new Set(below2).size, order: set.length > 2 ? Math.round(spearman(set.map((item) => score(item)), values) * 1000) / 1000 : 1 };
}

const out: string[] = [];
out.push('### Все продукты', '', '| Продукт | Категория | Ккал | Белок | Клетч. | Сахара | Нас. жиры | Соль | Доб. | Score | raw | Бонусы | Штрафы | Предел |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const { item, value, raw, bonuses, penalties, cap } of rows()) {
  out.push(`| ${item.name} | ${item.category} | ${item.kcal} | ${fmt(item.protein)} | ${fmt(item.fiber)} | ${fmt(item.sugars)} | ${fmt(item.saturatedFat)} | ${fmt(item.salt)} | ${fmt(item.additives)} | ${value.toFixed(1)} | ${raw} | ${bonuses.join(', ') || '—'} | ${penalties.join(', ') || '—'} | ${cap || '—'} |`);
}
const all = rows();
out.push('', '### Распределение', '', '| Вариант | =0 | ≤1 | ≤2 | ≥9 | =10 | Среднее | Разных значений ≤2 | Порядок к текущему |', '|---|---|---|---|---|---|---|---|---|');
for (const variant of VARIANTS) {
  const d = distribution(variant);
  out.push(`| ${variant} | ${d.zero} | ${d.upTo1} | ${d.upTo2} | ${d.from9} | ${d.ten} | ${d.mean} | ${d.distinctBottom} | ${d.order} |`);
}
const offSet = BENCHMARK.filter((item) => item.source === 'off-fixture');
out.push('', '### Подмножество OFF', '', '| Вариант | =0 | ≤1 | ≤2 | ≥9 | =10 | Среднее |', '|---|---|---|---|---|---|---|');
for (const variant of VARIANTS) {
  const d = distribution(variant, offSet);
  out.push(`| ${variant} | ${d.zero} | ${d.upTo1} | ${d.upTo2} | ${d.from9} | ${d.ten} | ${d.mean} |`);
}
out.push('', '| Штрихкод | Продукт | Категория | Текущая | C(−8) | C(−12.5) | Причина без оценки |', '|---|---|---|---|---|---|---|');
for (const item of offSet) out.push(`| ${item.barcode} | ${item.name} | ${item.category} | ${score(item).toFixed(1)} | ${score(item, 'C8').toFixed(1)} | ${score(item, 'C').toFixed(1)} | — |`);
for (const item of OFF_INCOMPLETE) out.push(`| ${item.barcode} | ${item.name} | ${item.category} | нет | нет | нет | ${scoreProduct(benchmarkProduct(item)).unscoredReason} |`);
function histogram(set: readonly BenchmarkItem[], variant: Variant): string {
  const bins = [0, 0, 0, 0, 0];
  for (const item of set) bins[Math.min(4, Math.floor(score(item, variant) / 2))]!++;
  return bins.join(' / ');
}
out.push('', '### 13 реальных продуктов OFF', '', '| Вариант | =0 | ≤1 | ≤2 | ≥9 | =10 | Среднее | 0–2 / 2–4 / 4–6 / 6–8 / 8–10 |', '|---|---|---|---|---|---|---|---|');
for (const variant of ['previous', 'C8', 'C'] as const) {
  const d = distribution(variant, OFF_REAL);
  out.push(`| ${variant} | ${d.zero} | ${d.upTo1} | ${d.upTo2} | ${d.from9} | ${d.ten} | ${d.mean} | ${histogram(OFF_REAL, variant)} |`);
}
out.push('', '| Категория | Продукт | Штрихкод | Ккал | Сахара | Нас. жиры | Соль | Белок | Клетч. | Доб. | Текущая | raw | C(−8) | Замечания |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const item of OFF_REAL) out.push(`| ${item.category} | ${item.name} | ${item.barcode} | ${item.kcal} | ${item.sugars} | ${item.saturatedFat} | ${item.salt} | ${fmt(item.protein)} | ${fmt(item.fiber)} | ${fmt(item.additives)} | ${score(item).toFixed(1)} | ${scoreVariant(item, 'previous').raw} | ${score(item, 'C8').toFixed(1)} | ${item.warnings?.join('; ') || '—'} |`);
out.push('', '### Гистограмма всего набора', '', '| Вариант | 0–2 / 2–4 / 4–6 / 6–8 / 8–10 |', '|---|---|');
for (const variant of ['previous', 'C8', 'C'] as const) out.push(`| ${variant} | ${histogram(BENCHMARK, variant)} |`);
const roshen = byName('Шоколад Roshen (скан)');
const lower = BENCHMARK.filter((item) => score(item) < score(roshen)).length;
const same = BENCHMARK.filter((item) => score(item) === score(roshen)).length;
out.push('', '### Верх шкалы', '', '| Продукт | raw | v2 | v3 |', '|---|---|---|---|');
for (const row of all.filter((entry) => entry.raw >= 4)) out.push(`| ${row.item.name} | ${row.raw} | ${score(row.item, 'previous').toFixed(1)} | ${row.value.toFixed(1)} |`);
out.push('', `Продуктов: ${BENCHMARK.length}. Roshen: score ${score(roshen)}, ниже него ${lower}, с той же оценкой ${same}, процентиль ${Math.round(((lower + same / 2) / BENCHMARK.length) * 100)}.`);
out.push(`Ноль: ${all.filter((row) => row.value === 0).map((row) => `${row.item.name} (${row.raw})`).join(', ')}.`);
out.push(`Срезано нижней границей: ${all.filter((row) => row.raw < 0).length}. Сработал потолок 4: ${all.filter((row) => row.cap.startsWith('потолок')).map((row) => `${row.item.name} (raw ${row.raw})`).join(', ') || 'нет'}.`);

const broken = EXPECTED_ORDER.filter(([better, worse]) => score(byName(better)) <= score(byName(worse)));
out.push('', `### Порядок`, '', `Проверено пар: ${EXPECTED_ORDER.length}, нарушено: ${broken.length}.`);
for (const [better, worse] of broken) out.push(`- ${better} ${score(byName(better))} не выше ${worse} ${score(byName(worse))}`);

out.push('', '### Варианты', '', '| Продукт | Текущая | A | B | C(−12.5) | C(−8) |', '|---|---|---|---|---|---|');
for (const name of ['Шоколад Roshen (скан)', 'Nutella', 'Choco Pie', 'Чипсы', 'Чипсы (наш кейс)', 'Творожный продукт (наш кейс)', 'Йогурт натуральный', 'Яблоко', 'Cola', 'Молочный шоколад', 'Тёмный шоколад 70%', 'Протеиновый батончик', 'Snickers', 'Сливочное масло']) {
  out.push(`| ${name} | ${VARIANTS.map((variant) => score(byName(name), variant).toFixed(1)).join(' | ')} |`);
}
for (const variant of VARIANTS) {
  const wrong = EXPECTED_ORDER.filter(([better, worse]) => score(byName(better), variant) <= score(byName(worse), variant));
  out.push(`Вариант ${variant}: нарушено пар ${wrong.length}${wrong.length ? `: ${wrong.map(([better, worse]) => `${better} / ${worse}`).join('; ')}` : ''}.`);
}

const pts = (item: BenchmarkItem, kind: string) => scoreProduct(benchmarkProduct(item)).factors.find((factor) => factor.kind === kind)!.points;
const noEnergy = BENCHMARK.map((item) => Math.max(0, Math.min(10, all.find((row) => row.item === item)!.raw - pts(item, 'energy'))));
const foods = BENCHMARK.filter((item) => item.unit === 'g');
const energyOverlap = foods.filter((item) => pts(item, 'energy') < 0 && (pts(item, 'sugars') < 0 || pts(item, 'saturatedFat') < 0));
out.push('', '### Двойной счёт', '', `Штраф за калории у ${foods.filter((item) => pts(item, 'energy') < 0).length} из ${foods.length} продуктов еды, из них вместе со штрафом за сахар или насыщенные жиры у ${energyOverlap.length}.`);
out.push(`Порядок без штрафа за калории к текущему: ${Math.round(spearman(BENCHMARK.map((item) => score(item)), noEnergy) * 1000) / 1000}. Снятие штрафа выводит из нуля: ${BENCHMARK.filter((item, index) => score(item) === 0 && noEnergy[index]! > 0).map((item) => item.name).join(', ') || 'никого'}.`);
const hits = (kind: string, value: number) => BENCHMARK.filter((item) => pts(item, kind) === value).length;
out.push(`Сахара на пределе −6: ${hits('sugars', -6)}. Насыщенные жиры на пределе −5: ${hits('saturatedFat', -5)}. Оба сразу: ${BENCHMARK.filter((item) => pts(item, 'sugars') === -6 && pts(item, 'saturatedFat') === -5).length}. Соль на пределе −5: ${hits('salt', -5)}.`);
out.push(`Самый большой штраф за добавки: ${Math.min(...BENCHMARK.map((item) => pts(item, 'additives')))}. Самая большая сумма бонусов: ${Math.max(...BENCHMARK.map((item) => pts(item, 'protein') + pts(item, 'fiber')))}.`);
const scored = (item: BenchmarkItem) => scoreProduct(benchmarkProduct(item)).value !== null;
const strictAll = [...BENCHMARK.filter((item) => item.source !== 'off-real'), ...OFF_REAL_STRICT];
const strictByName = (name: string) => strictAll.find((item) => item.name === name)!;
const modeRow = (label: string, set: readonly BenchmarkItem[], variant: Variant) => {
  const usable = set.filter(scored);
  const values = usable.map((item) => score(item, variant));
  const mean = Math.round((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)) * 100) / 100;
  return `| ${label} | ${variant} | ${set.length - usable.length} | ${usable.length} | ${values.filter((value) => value === 0).length} | ${values.filter((value) => value <= 1).length} | ${values.filter((value) => value <= 2).length} | ${values.filter((value) => value >= 9).length} | ${mean} |`;
};
out.push('', '### Режимы нулей', '', '| Набор | Вариант | Без оценки | С оценкой | =0 | ≤1 | ≤2 | ≥9 | Среднее |', '|---|---|---|---|---|---|---|---|---|');
for (const [label, set] of [['Все 72, снимок v2', BENCHMARK], ['Все 72, нормализовано', strictAll], ['13 OFF, снимок v2', OFF_REAL], ['13 OFF, нормализовано', OFF_REAL_STRICT]] as const) for (const variant of ['previous', 'C8'] as const) out.push(modeRow(label, set, variant));
const broke = (variant: Variant, lookup: (name: string) => BenchmarkItem) => {
  const pairs = EXPECTED_ORDER.filter(([better, worse]) => scored(lookup(better)) && scored(lookup(worse)));
  return `${pairs.filter(([better, worse]) => score(lookup(better), variant) <= score(lookup(worse), variant)).length} из ${pairs.length}`;
};
out.push('', `Пары, снимок v2: current ${broke('previous', byName)}, C8 ${broke('C8', byName)}. Нормализовано: current ${broke('previous', strictByName)}, C8 ${broke('C8', strictByName)}.`);
out.push('', `Нормализовано, нарушены: ${EXPECTED_ORDER.filter(([better, worse]) => scored(strictByName(better)) && scored(strictByName(worse)) && score(strictByName(better), 'C8') <= score(strictByName(worse), 'C8')).map(([better, worse]) => `${better} / ${worse}`).join('; ') || 'нет'}.`);
out.push(`Без оценки: ${strictAll.filter((item) => !scored(item)).map((item) => item.name).join(', ') || 'нет'}. Нормализовано, ноль: ${strictAll.filter((item) => scored(item) && score(item) === 0).map((item) => item.name).join(', ')}.`);
out.push('', '| Штрихкод | Продукт | Снимок v2 | C(−8) | Нормализовано | Нормализовано C(−8) | sugars / нас. жиры / соль / белок / клетч. |', '|---|---|---|---|---|---|---|');
for (const item of OFF_REAL) {
  const strict = OFF_REAL_STRICT.find((entry) => entry.barcode === item.barcode)!;
  const show = (entry: BenchmarkItem, variant: Variant) => (scored(entry) ? score(entry, variant).toFixed(1) : 'нет');
  out.push(`| ${item.barcode} | ${item.name} | ${show(item, 'previous')} | ${show(item, 'C8')} | ${show(strict, 'previous')} | ${show(strict, 'C8')} | ${[strict.sugars, strict.saturatedFat, strict.salt, strict.protein, strict.fiber].map(fmt).join(' / ')} |`);
}
console.log(out.join('\n'));
