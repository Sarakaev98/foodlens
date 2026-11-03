import type { ValidationIssue } from '@foodlens/core';

/** Текст ошибки для пользователя по коду из общей validation (@foodlens/core). */
export function formatValidationIssue(issue: ValidationIssue): string {
  const params = issue.params ?? {};
  switch (issue.code) {
    case 'required':
      return 'This field is required';
    case 'invalid_type':
      return 'Invalid value';
    case 'not_integer':
      return 'Enter a whole number';
    case 'out_of_range':
      return `Must be between ${params.min} and ${params.max}`;
    case 'unknown_value':
      return 'Choose an option from the list';
    case 'too_long':
      return `Up to ${params.max} characters`;
    case 'too_many':
      return `Up to ${params.max} items`;
    case 'exclusive_value':
      return 'This option can’t be combined with others';
  }
}

export function findIssueMessage(issues: readonly ValidationIssue[], field: string): string | undefined {
  const issue = issues.find((item) => item.field === field);
  return issue ? formatValidationIssue(issue) : undefined;
}
