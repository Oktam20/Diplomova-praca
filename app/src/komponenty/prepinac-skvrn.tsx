import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { useJazyk } from '@/jazyk';
import { Ikona } from '@/komponenty/ikona';
import { KartaSkvrny } from '@/komponenty/karta-skvrny';
import type { Skvrna } from '@/vypocty/vysledok-skenu';
import { FARBY, MEDZERA } from '@/vzhlad';

type Props = { skvrny: Skvrna[]; aktivna: number; zmena: (index: number) => void };

/** Podrobný výsledok škvŕn po jednej: šípky alebo potiahnutie do strany prepnú na susednú škvrnu. */
export function PrepinacSkvrn({ skvrny, aktivna, zmena }: Props) {
  const { t } = useJazyk();
  const zoznam = useRef<FlatList<Skvrna>>(null);
  const [sirka, setSirka] = useState(0);

  useEffect(() => {
    zoznam.current?.scrollToIndex({ index: aktivna, animated: true });
  }, [aktivna]);

  const prejdi = (index: number) => zmena(Math.max(0, Math.min(skvrny.length - 1, index)));
  const poPotiahnuti = (e: NativeSyntheticEvent<NativeScrollEvent>) => prejdi(Math.round(e.nativeEvent.contentOffset.x / sirka));

  return (
    <View style={styles.obal} onLayout={(e) => setSirka(e.nativeEvent.layout.width)}>
      <View style={styles.lista}>
        <Sipka smer="vlavo" povolena={aktivna > 0} stlac={() => prejdi(aktivna - 1)} />
        <View style={styles.stred}>
          <Text style={styles.nazov}>{t.skvrna.nazov(skvrny[aktivna].cislo)}</Text>
          <Text style={styles.poradie}>{t.skvrna.poradie(aktivna + 1, skvrny.length)}</Text>
        </View>
        <Sipka smer="vpravo" povolena={aktivna < skvrny.length - 1} stlac={() => prejdi(aktivna + 1)} />
      </View>
      {sirka > 0 && (
        <FlatList
          ref={zoznam}
          data={skvrny}
          keyExtractor={(skvrna, index) => String(skvrna.cislo ?? index)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={aktivna}
          onMomentumScrollEnd={poPotiahnuti}
          getItemLayout={(_, index) => ({ length: sirka, offset: sirka * index, index })}
          renderItem={({ item }) => (
            <View style={{ width: sirka }}>
              <KartaSkvrny skvrna={item} />
            </View>
          )}
        />
      )}
    </View>
  );
}

function Sipka({ smer, povolena, stlac }: { smer: 'vlavo' | 'vpravo'; povolena: boolean; stlac: () => void }) {
  return (
    <Pressable
      onPress={stlac}
      disabled={!povolena}
      hitSlop={8}
      style={({ pressed }) => [styles.sipka, !povolena && styles.zakazana, pressed && styles.stlacena]}>
      <Ikona
        ios={smer === 'vlavo' ? 'chevron.left' : 'chevron.right'}
        android={smer === 'vlavo' ? 'chevron_left' : 'chevron_right'}
        velkost={18}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  obal: { gap: MEDZERA[2] },
  lista: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: MEDZERA[2],
    padding: 4,
    borderRadius: MEDZERA[3],
    backgroundColor: FARBY.lista,
  },
  stred: { flex: 1, alignItems: 'center' },
  nazov: { color: FARBY.text, fontSize: 14, fontWeight: '700' },
  poradie: { color: FARBY.tlmeny, fontSize: 11 },
  sipka: {
    width: 40,
    height: 40,
    borderRadius: MEDZERA[2],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  zakazana: { opacity: 0.3 },
  stlacena: { opacity: 0.6 },
});
