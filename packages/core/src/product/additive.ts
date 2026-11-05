import type { ExternalProvenance } from '../common';

export interface Additive {
  /** E-код в нормализованном виде, например "E330" или "E150d". null, если указано только название. */
  readonly code: string | null;
  readonly name: string | null;
  /** Есть только у добавки из базы; без него добавка прочитана с этикетки. */
  readonly provenance?: ExternalProvenance;
  /** Original declarations retained when a code and its name are combined; never a score input. */
  readonly sourceMentions?: readonly { readonly code: string | null; readonly name: string | null; readonly provenance?: ExternalProvenance }[];
}
