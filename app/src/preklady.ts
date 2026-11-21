import { en } from './lang/en';
import { sk, type Texty } from './lang/sk';

/** Jazyky aplikácie – texty sú v src/lang/ (sk.ts, en.ts). Bez Reactu, aby ich mohol použiť aj kód vo WebView. */
export const JAZYKY = { sk, en } satisfies Record<string, Texty>;

export type Jazyk = keyof typeof JAZYKY;
export type { Texty };

export const PREDVOLENY_JAZYK: Jazyk = 'sk';

export const jeJazyk = (hodnota: unknown): hodnota is Jazyk => typeof hodnota === 'string' && hodnota in JAZYKY;
