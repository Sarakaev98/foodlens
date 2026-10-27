import { createParamDecorator } from '@nestjs/common';

/** Пока авторизации нет, все запросы выполняются от имени одного локального пользователя. */
export const DEMO_USER_ID = 'local-demo-user';

/**
 * Идентификатор текущего пользователя. Когда появится auth, здесь будет
 * чтение userId из запроса, а контроллеры и сервисы останутся без изменений.
 */
export const CurrentUserId = createParamDecorator((): string => DEMO_USER_ID);
