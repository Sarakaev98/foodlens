import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { validateUserNutritionProfileInput, type UserNutritionProfileInput } from '@foodlens/core';

/** Проверяет тело запроса теми же правилами из @foodlens/core, что и форма в mobile. */
@Injectable()
export class UserNutritionProfileInputPipe implements PipeTransform<unknown, UserNutritionProfileInput> {
  transform(value: unknown): UserNutritionProfileInput {
    const result = validateUserNutritionProfileInput(value);
    if (!result.ok) {
      throw new BadRequestException({ statusCode: 400, message: 'Validation failed', issues: result.issues });
    }
    return result.value;
  }
}
