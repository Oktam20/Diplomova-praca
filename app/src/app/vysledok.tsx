import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useJazyk } from '@/jazyk';
import { Ikona } from '@/komponenty/ikona';
import { KartaSkvrny } from '@/komponenty/karta-skvrny';
import { Prepinac } from '@/komponenty/prepinac';
import { PrepinacJazyka } from '@/komponenty/prepinac-jazyka';
import { PrepinacSkvrn } from '@/komponenty/prepinac-skvrn';
import { ZoznamSkvrn } from '@/komponenty/zoznam-skvrn';
import { nacitajVysledok, poziadajONovySken } from '@/vypocty/vysledok-skenu';
import { FARBY, MEDZERA } from '@/vzhlad';

type Pohlad = 'maska' | 'original' | 'vyrez';

export default function Vysledok() {
  const { t } = useJazyk();
  const desatinne = (v: number) => v.toFixed(1).replace('.', t.oddelovacDesatin);
  const vysledok = nacitajVysledok();
  const [pohlad, setPohlad] = useState<Pohlad>('maska');
  const [aktivna, setAktivna] = useState(0);
  const [polohaPrepinaca, setPolohaPrepinaca] = useState(0);
  const stranka = useRef<ScrollView>(null);

  const otvorSkvrnu = (index: number) => {
    setAktivna(index);
    stranka.current?.scrollTo({ y: polohaPrepinaca, animated: true });
  };

  if (!vysledok) {
    return (
      <View style={styles.stranka}>
        <SafeAreaView style={[styles.obsah, styles.stred]} edges={['top', 'bottom']}>
          <Text style={styles.prazdny}>{t.vysledok.ziadnyVysledok}</Text>
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
          <Text style={styles.nadpis}>{t.vysledok.nadpis}</Text>
          <View style={styles.rezim}>
            <Text style={styles.popisRezimu}>{t.rezimy[vysledok.rezim]}</Text>
          </View>
          <PrepinacJazyka />
        </View>

        <ScrollView ref={stranka} contentContainerStyle={styles.zoznam}>
          <View style={styles.ram}>{uri && <Image source={{ uri }} style={styles.fotka} resizeMode="contain" />}</View>
          <Prepinac
            moznosti={[
              ['maska', t.pohlady.maska],
              ['original', t.pohlady.original],
              ['vyrez', t.pohlady.vyrez],
            ]}
            hodnota={pohlad}
            zmena={setPohlad}
          />

          {vysledok.skvrny.length === 0 ? (
            <View style={styles.karta}>
              <Text style={styles.prazdny}>{t.vysledok.ziadnaSkvrna}</Text>
            </View>
          ) : vysledok.skvrny.length === 1 ? (
            <KartaSkvrny skvrna={vysledok.skvrny[0]} />
          ) : (
            <>
              <ZoznamSkvrn skvrny={vysledok.skvrny} aktivna={aktivna} vyber={otvorSkvrnu} />
              <View onLayout={(e) => setPolohaPrepinaca(e.nativeEvent.layout.y)}>
                <PrepinacSkvrn skvrny={vysledok.skvrny} aktivna={aktivna} zmena={setAktivna} />
              </View>
            </>
          )}

          <Text style={styles.poznamka}>
            {t.vysledok.overenieKluca(Math.round(vysledok.overenieKluca * 100))} · {t.vysledok.spracovanie(desatinne(vysledok.trvanie / 1000))}
          </Text>
          <Text style={styles.poznamka}>
            {t.vysledok.profil} {vysledok.profil ?? t.vysledok.profilNeuvedeny}
            {vysledok.profil === 'Display P3' ? t.vysledok.prevedeneP3 : ''}
          </Text>
        </ScrollView>

        <NovySken />
      </SafeAreaView>
    </View>
  );
}

function NovySken() {
  const { t } = useJazyk();
  const novy = () => {
    poziadajONovySken();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return (
    <Pressable onPress={novy} style={({ pressed }) => [styles.novySken, pressed && styles.stlacene]}>
      <Ikona ios="camera.fill" android="photo_camera" farba={FARBY.tmavomodra} velkost={18} />
      <Text style={styles.popisNovehoSkenu}>{t.vysledok.novySken}</Text>
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
