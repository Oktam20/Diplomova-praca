import { Image, StyleSheet, Text, View } from 'react-native';

import { nazovDruhu, type Skvrna } from '@/vypocty/kluc';
import { FARBY, MEDZERA } from '@/vzhlad';

const FARBA_SKUPINY: Record<string, string> = { tmave: '#8a5a2b', svetle: '#e2b93b' };

const LEGENDA: [string, string][] = [
  ['#9ec5f4', 'zóna 0 (okraj)'],
  ['#6da7ec', 'zóna 1'],
  ['#3987e5', 'zóna 2'],
  ['#184f95', 'zóna 3 (stred)'],
  ['#e8862a', 'lem'],
  ['#808080', 'vynechané okolie'],
];

/** Výsledok jednej škvrny: určený druh alebo skupina, obrázok čŕt a cesta kľúčom. */
export function KartaSkvrny({ skvrna }: { skvrna: Skvrna }) {
  const { nazov, skupina, podskupina, druh, druhy, cesta } = skvrna.urcenie;
  return (
    <View style={styles.karta}>
      <View style={styles.hlavicka}>
        <View style={[styles.bodka, { backgroundColor: FARBA_SKUPINY[skupina ?? ''] ?? FARBY.tlmeny }]} />
        <View style={styles.nazvy}>
          <Text style={styles.drobny}>{skvrna.nazov}</Text>
          {druh ? (
            <>
              <Text style={styles.urcenyNadpis}>Určený druh</Text>
              <Text style={styles.urcenyDruh}>{nazovDruhu(druh)}</Text>
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
                <Text style={styles.popisLegendy}>{popis}</Text>
              </View>
            ))}
            <Text style={styles.popisLegendy}>papier = bez farby, obrys škvrny červený</Text>
          </View>
        </View>
      )}

      {skupina === 'neiste' && <Text style={styles.drobny}>Hodnota je blízko prahu – škvrna môže patriť do oboch skupín.</Text>}

      {cesta.length > 0 && (
        <View style={styles.zoznam}>
          <Text style={styles.nadpisZoznamu}>Cesta kľúčom</Text>
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
          <Text style={styles.nadpisZoznamu}>Druh zatiaľ neurčený – možné druhy</Text>
          {druhy.map((d) => (
            <Text key={d} style={styles.mozny}>
              {nazovDruhu(d)}
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
