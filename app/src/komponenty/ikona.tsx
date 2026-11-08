import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';

import { FARBY } from '@/vzhlad';

type Props = { ios: SFSymbol; android: AndroidSymbol; farba?: string; velkost?: number };

/** Systémová ikona – na webe sa použije ikona z Androidu. */
export function Ikona({ ios, android, farba = FARBY.biela, velkost = 16 }: Props) {
  return <SymbolView name={{ ios, android, web: android }} tintColor={farba} size={velkost} />;
}
