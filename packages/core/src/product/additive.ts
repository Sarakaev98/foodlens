export interface Additive {
  /** E-код в нормализованном виде, например "E330" или "E150d". null, если указано только название. */
  readonly code: string | null;
  readonly name: string | null;
}
