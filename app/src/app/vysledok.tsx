import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Ikona } from '@/komponenty/ikona';
import { KartaSkvrny } from '@/komponenty/karta-skvrny';
import { Prepinac } from '@/komponenty/prepinac';
import { OVERENIE_KLUCA } from '@/vypocty/kluc';
import { nacitajVysledok, poziadajONovySken } from '@/vypocty/vysledok-skenu';
import { FARBY, MEDZERA } from '@/vzhlad';

type Pohlad = 'maska' | 'original' | 'vyrez';

const REZIMY = { obrazok: 'Obrázok', dokument: 'Dokument' };

const desatinne = (v: number) => v.toFixed(1).replace('.', ',');

export default function Vysledok() {
  const vysledok = nacitajVysledok();
  const [pohlad, setPohlad] = useState<Pohlad>('maska');

  if (!vysledok) {
    return (
      <View style={styles.stranka}>
        <SafeAreaView style={[styles.obsah, styles.stred]} edges={['top', 'bottom']}>
          <Text style={styles.prazdny}>Žiadny výsledok – najprv naskenuj vzorku.</Text>
          <NovySken />
        </SafeAreaView>
      </View>
    );
  }

  const naMaske = pohlad === 'maska' ? vysledok.maskaUri : pohlad === 'vyrez' ? vysledok.vyrezUri : null;
  const uri = naMaske ?? vysledok.obrazokUri;

  return (
    <View style={styles.stranka}>
      <SafeAreaView style={styles.obsah} edges={['top', 'bottom']}>
        <View style={styles.hlavicka}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.spat}>
            <Ikona ios="chevron.left" android="arrow_back" />
          </Pressable>
          <Text style={styles.nadpis}>Výsledok skenu</Text>
          <View style={styles.rezim}>
            <Text style={styles.popisRezimu}>{REZIMY[vysledok.rezim]}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.zoznam}>
          <View style={styles.ram}>{uri && <Image source={{ uri }} style={styles.fotka} resizeMode="contain" />}</View>
          <Prepinac
            moznosti={[
              ['maska', 'Maska'],
              ['original', 'Originál'],
              ['vyrez', 'Výrez'],
            ]}
            hodnota={pohlad}
            zmena={setPohlad}
          />

          {vysledok.skvrny.length === 0 ? (
            <View style={styles.karta}>
              <Text style={styles.prazdny}>Nenašla sa žiadna škvrna, ktorú by sa dalo zaradiť.</Text>
            </View>
          ) : (
            vysledok.skvrny.map((skvrna) => <KartaSkvrny key={skvrna.nazov} skvrna={skvrna} />)
          )}

          <Text style={styles.poznamka}>
            Overenie kľúča po kartičkách {Math.round(OVERENIE_KLUCA * 100)} % · spracovanie {desatinne(vysledok.trvanie / 1000)} s
          </Text>
          <Text style={styles.poznamka}>
            Farebný profil fotky: {vysledok.profil ?? 'neuvedený (berie sa ako sRGB)'}
            {vysledok.profil === 'Display P3' ? ' – prevedené do sRGB ako trénovacie dáta' : ''}
          </Text>
        </ScrollView>

        <NovySken />
      </SafeAreaView>
    </View>
  );
}

function NovySken() {
  const novy = () => {
    poziadajONovySken();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return (
    <Pressable onPress={novy} style={({ pressed }) => [styles.novySken, pressed && styles.stlacene]}>
      <Ikona ios="camera.fill" android="photo_camera" farba={FARBY.tmavomodra} velkost={18} />
      <Text style={styles.popisNovehoSkenu}>Nový sken</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stranka: { flex: 1, backgroundColor: FARBY.pozadie },
  obsah: { flex: 1 },
  stred: { alignItems: 'center', justifyContent: 'center', gap: MEDZERA[3] },
  hlavicka: { flexDirection: 'row', alignItems: 'center', gap: MEDZERA[2], paddingHorizontal: MEDZERA[3], paddingVertical: MEDZERA[2] },
  spat: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  nadpis: { flex: 1, color: FARBY.text, fontSize: 17, fontWeight: '700' },
  rezim: { paddingHorizontal: MEDZERA[2], paddingVertical: 4, borderRadius: MEDZERA[2], backgroundColor: FARBY.lista },
  popisRezimu: { color: FARBY.tlmeny, fontSize: 12, fontWeight: '600' },
  zoznam: { gap: MEDZERA[3], paddingHorizontal: MEDZERA[3], paddingBottom: MEDZERA[4] },
  ram: { height: 300, borderRadius: 20, overflow: 'hidden', backgroundColor: FARBY.cierna },
  fotka: { width: '100%', height: '100%' },
  karta: {
    padding: MEDZERA[3],
    borderRadius: MEDZERA[3],
    backgroundColor: FARBY.panel,
    borderWidth: 1,
    borderColor: FARBY.okrajPanela,
  },
  poznamka: { color: FARBY.tlmeny, fontSize: 11 },
  prazdny: { color: FARBY.tlmeny, fontSize: 13 },
  novySken: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: MEDZERA[2],
    marginHorizontal: MEDZERA[3],
    marginBottom: MEDZERA[2],
    paddingVertical: MEDZERA[3],
    borderRadius: MEDZERA[3],
    backgroundColor: FARBY.biela,
  },
  popisNovehoSkenu: { color: FARBY.tmavomodra, fontSize: 15, fontWeight: '700' },
  stlacene: { opacity: 0.75 },
});
