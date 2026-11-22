export const OPEN_MARK: string;
export const CLOSE_MARK: string;
export const EXPANSION: number;
export class PseudoLocaleError extends Error {}
export function isPseudoLocalized(message: unknown): boolean;
export function pseudoLocalize(message: string): string;
export interface MessageCatalogue {
  [key: string]: string | MessageCatalogue;
}
export function pseudoLocalizeCatalogue(catalogue: MessageCatalogue, path?: string): MessageCatalogue;
