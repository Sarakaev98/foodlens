import type { AnalyzeProductInput, ProductImageInput } from './ai-provider.types';

/** Подсказка о содержимом фото. Не влияет на проверки и никогда не роняет скан. */
export const PRODUCT_IMAGE_ROLES = ['product', 'nutrition', 'ingredients'] as const;
/** Фото одного продукта на один запрос к AI. */
export const MAX_PRODUCT_IMAGES = 3;

/** Все фото запроса: старый вход с одним image и новый с images дают один и тот же список. */
export function productImages(input: Extract<AnalyzeProductInput, { readonly kind: 'image' }>): readonly ProductImageInput[] {
  return 'images' in input ? input.images : [input.image];
}
