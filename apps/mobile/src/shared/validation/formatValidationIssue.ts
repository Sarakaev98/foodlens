import type { ValidationIssue } from '@foodlens/core';

/** Текст ошибки для пользователя по коду из общей validation (@foodlens/core). */
export function formatValidationIssue(issue: ValidationIssue): string {
  const params = issue.params ?? {};
  switch (issue.code) {
    case 'required':
      return 'Заполните поле';
    case 'invalid_type':
      return 'Некорректное значение';
    case 'not_integer':
      return 'Введите целое число';
    case 'out_of_range':
      return `Допустимо от ${params.min} до ${params.max}`;
    case 'unknown_value':
      return 'Выберите значение из списка';
    case 'too_long':
      return `Не длиннее ${params.max} символов`;
    case 'too_many':
      return `Не больше ${params.max} значений`;
    case 'exclusive_value':
      return 'Этот вариант нельзя сочетать с другими';
  }
}

export function findIssueMessage(issues: readonly ValidationIssue[], field: string): string | undefined {
  const issue = issues.find((item) => item.field === field);
  return issue ? formatValidationIssue(issue) : undefined;
}
