import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Ikona } from '@/komponenty/ikona';
import type { Skvrna } from '@/vypocty/vysledok-skenu';
import { FARBY, MEDZERA } from '@/vzhlad';

type Props = { skvrny: Skvrna[]; aktivna: number; vyber: (index: number) => void };

/** Krátky zoznam všetkých škvŕn: náhľad výrezu, názov a určenie; ťuknutie otvorí škvrnu v prepínači. */
export function ZoznamSkvrn({ skvrny, aktivna, vyber }: Props) {
  return (
    <View style={styles.zoznam}>
      {skvrny.map((skvrna, i) => (
        <Pressable
          key={skvrna.nazov}
          onPress={() => vyber(i)}
          style={({ pressed }) => [
            styles.riadok,
            i < skvrny.length - 1 && styles.oddelovac,
            i === aktivna && styles.aktivny,
            pressed && styles.stlaceny,
          ]}>
          {skvrna.nahlad ? (
            <Image source={{ uri: `data:image/png;base64,${skvrna.nahlad}` }} style={styles.nahlad} />
          ) : (
            <View style={styles.nahlad} />
          )}
          <View style={styles.texty}>
            <Text style={styles.nazov}>{skvrna.nazov}</Text>
            <Text style={skvrna.urcenie.druh ? styles.druh : styles.skupina} numberOfLines={1}>
              {skvrna.urcenie.druh ?? skvrna.urcenie.nazov}
            </Text>
          </View>
          <Ikona ios="chevron.right" android="chevron_right" farba={FARBY.tlmeny} velkost={14} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  zoznam: {
    borderRadius: MEDZERA[3],
    backgroundColor: FARBY.panel,
    borderWidth: 1,
    borderColor: FARBY.okrajPanela,
    overflow: 'hidden',
  },
  riadok: { flexDirection: 'row', alignItems: 'center', gap: MEDZERA[3], paddingHorizontal: MEDZERA[3], paddingVertical: MEDZERA[2] },
  oddelovac: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: FARBY.okrajPanela },
  aktivny: { backgroundColor: FARBY.lista },
  stlaceny: { opacity: 0.7 },
  nahlad: { width: 48, height: 48, borderRadius: MEDZERA[2], backgroundColor: FARBY.cierna },
  texty: { flex: 1 },
  nazov: { color: FARBY.text, fontSize: 14, fontWeight: '700' },
  druh: { color: FARBY.text, fontSize: 13, fontStyle: 'italic' },
  skupina: { color: FARBY.tlmeny, fontSize: 12 },
});
