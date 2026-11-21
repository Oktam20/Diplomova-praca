import { Image, StyleSheet, Text, View } from 'react-native';

import { useJazyk } from '@/jazyk';
import type { Texty } from '@/preklady';
import type { Skvrna } from '@/vypocty/vysledok-skenu';
import { FARBY, MEDZERA } from '@/vzhlad';

const FARBA_SKUPINY: Record<string, string> = { tmave: '#8a5a2b', svetle: '#e2b93b' };

const LEGENDA: [string, keyof Texty['skvrna']['legenda']][] = [
  ['#9ec5f4', 'zona0'],
  ['#6da7ec', 'zona1'],
  ['#3987e5', 'zona2'],
  ['#184f95', 'zona3'],
  ['#e8862a', 'lem'],
  ['#808080', 'vynechane'],
];

/** Výsledok jednej škvrny: určený druh alebo skupina, obrázok čŕt a cesta kľúčom. */
export function KartaSkvrny({ skvrna }: { skvrna: Skvrna }) {
  const { jazyk, t } = useJazyk();
  const { nazov, skupina, podskupina, druh, druhy, cesta } = skvrna.urcenie[jazyk];
  return (
    <View style={styles.karta}>
      <View style={styles.hlavicka}>
        <View style={[styles.bodka, { backgroundColor: FARBA_SKUPINY[skupina ?? ''] ?? FARBY.tlmeny }]} />
        <View style={styles.nazvy}>
          <Text style={styles.drobny}>{t.skvrna.nazov(skvrna.cislo)}</Text>
          {druh ? (
            <>
              <Text style={styles.urcenyNadpis}>{t.skvrna.urcenyDruh}</Text>
              <Text style={styles.urcenyDruh}>{druh}</Text>
              <Text style={styles.drobny}>
                {nazov}
                {podskupina ? ` → ${podskupina}` : ''}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.skupina}>{nazov}</Text>
              {podskupina && <Text style={styles.podskupina}>→ {podskupina}</Text>}
            </>
          )}
        </View>
      </View>

      {skvrna.obrazok && (
        <View style={styles.zoznam}>
          <Image source={{ uri: `data:image/png;base64,${skvrna.obrazok}` }} style={styles.obrazok} resizeMode="contain" />
          <View style={styles.legenda}>
            {LEGENDA.map(([farba, popis]) => (
              <View key={popis} style={styles.polozkaLegendy}>
                <View style={[styles.stvorcek, { backgroundColor: farba }]} />
                <Text style={styles.popisLegendy}>{t.skvrna.legenda[popis]}</Text>
              </View>
            ))}
            <Text style={styles.popisLegendy}>{t.skvrna.legendaPapier}</Text>
          </View>
        </View>
      )}

      {skupina === 'neiste' && <Text style={styles.drobny}>{t.skvrna.blizkoPrahu}</Text>}

      {cesta.length > 0 && (
        <View style={styles.zoznam}>
          <Text style={styles.nadpisZoznamu}>{t.skvrna.cestaKlucom}</Text>
          {cesta.map((krok, i) => (
            <View key={i}>
              <Text style={styles.otazka}>{krok.otazka}</Text>
              <Text style={styles.krok}>
                {krok.popis} → <Text style={styles.tucne}>{krok.vysledok}</Text>
              </Text>
            </View>
          ))}
        </View>
      )}

      {!druh && druhy.length > 0 && (
        <View style={styles.zoznam}>
          <Text style={styles.nadpisZoznamu}>{t.skvrna.mozneDruhy}</Text>
          {druhy.map((d) => (
            <Text key={d} style={styles.mozny}>
              {d}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  karta: {
    gap: MEDZERA[2],
    padding: MEDZERA[3],
    borderRadius: MEDZERA[3],
    backgroundColor: FARBY.panel,
    borderWidth: 1,
    borderColor: FARBY.okrajPanela,
  },
  hlavicka: { flexDirection: 'row', alignItems: 'center', gap: MEDZERA[2] },
  bodka: { width: 12, height: 12, borderRadius: 6 },
  nazvy: { flex: 1 },
  drobny: { color: FARBY.tlmeny, fontSize: 12 },
  skupina: { color: FARBY.text, fontSize: 16, fontWeight: '700' },
  podskupina: { color: FARBY.text, fontSize: 14, fontWeight: '600' },
  urcenyNadpis: { color: FARBY.jantarova, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  urcenyDruh: { color: FARBY.text, fontSize: 22, fontWeight: '700', fontStyle: 'italic' },
  zoznam: { gap: 6, marginTop: MEDZERA[1] },
  nadpisZoznamu: { color: FARBY.tlmeny, fontSize: 11, textTransform: 'uppercase' },
  otazka: { color: FARBY.tlmeny, fontSize: 11, fontWeight: '600' },
  krok: { color: FARBY.text, fontSize: 12 },
  tucne: { fontWeight: '700' },
  mozny: { color: FARBY.text, fontSize: 13, fontStyle: 'italic' },
  obrazok: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: FARBY.cierna },
  legenda: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  polozkaLegendy: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stvorcek: { width: 10, height: 10, borderRadius: 2 },
  popisLegendy: { color: FARBY.tlmeny, fontSize: 11 },
});
