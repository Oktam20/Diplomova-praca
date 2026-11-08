import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Ikona } from '@/komponenty/ikona';
import { Prepinac } from '@/komponenty/prepinac';
import { orezNaVodidlo, Vodidlo } from '@/komponenty/vodidlo';
import { prevezmiNovySken, ulozVysledok } from '@/vypocty/vysledok-skenu';
import { najdiNaDokumente, najdiNaObrazku, urciDruh, type Detekcia } from '@/vypocty/zariadenie';
import { FARBY, MEDZERA } from '@/vzhlad';

type Rezim = 'obrazok' | 'dokument';
type Zdroj = 'kamera' | 'subor';
type Pohlad = 'maska' | 'original' | 'vyrez';
type Stav = 'nic' | 'pocita' | 'hotovo' | 'urcuje' | 'varovanie' | 'chyba';

export default function Skenovanie() {
  const [zdroj, setZdroj] = useState<Zdroj>('kamera');
  const [rezim, setRezim] = useState<Rezim>('obrazok');
  const [povolenie, poziadajOPovolenie] = useCameraPermissions();
  const kamera = useRef<CameraView>(null);
  const ramKamery = useRef<{ width: number; height: number } | null>(null);

  const [fotka, setFotka] = useState<string | null>(null);
  const [detekcia, setDetekcia] = useState<Detekcia | null>(null);
  const [stav, setStav] = useState<Stav>('nic');
  const [sprava, setSprava] = useState<string | null>(null);
  const [pohlad, setPohlad] = useState<Pohlad>('maska');

  const maMasku = (stav === 'hotovo' || stav === 'urcuje') && !!detekcia?.obrazokUri;
  const naMaske = pohlad === 'maska' ? detekcia?.maskaUri : pohlad === 'vyrez' ? detekcia?.vyrezUri : null;
  const zobrazena = maMasku ? (naMaske ?? detekcia!.obrazokUri) : (detekcia?.obrazokUri ?? fotka);

  useFocusEffect(
    useCallback(() => {
      if (prevezmiNovySken()) zacniZnova();
    }, [])
  );

  function zacniZnova() {
    setFotka(null);
    setDetekcia(null);
    setStav('nic');
    setSprava(null);
    setPohlad('maska');
  }

  function zmenZdroj(novy: Zdroj) {
    setZdroj(novy);
    zacniZnova();
  }

  async function spracuj(uri: string) {
    setFotka(uri);
    setPohlad('maska');
    setDetekcia(null);
    setStav('pocita');
    setSprava(null);
    try {
      const d = rezim === 'dokument' ? await najdiNaDokumente(uri) : await najdiNaObrazku(uri);
      setDetekcia(d);
      setSprava(d.podklad ? d.sprava : (d.sprava ?? 'Maska sa nevytvorila.'));
      setStav(!d.podklad || (d.sprava && rezim === 'obrazok') ? 'varovanie' : 'hotovo');
    } catch (chyba) {
      setSprava(chyba instanceof Error ? chyba.message : 'Spracovanie v zariadení zlyhalo.');
      setStav('chyba');
    }
  }

  async function urci() {
    if (!detekcia?.podklad) return;
    setStav('urcuje');
    setSprava(null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      const skvrny = await urciDruh(detekcia.podklad);
      ulozVysledok({ ...detekcia, rezim, skvrny });
      router.push('/vysledok');
    } catch (chyba) {
      setSprava(chyba instanceof Error ? chyba.message : 'Klasifikácia zlyhala.');
    }
    setStav('hotovo');
  }

  async function odfot() {
    const snimka = await kamera.current?.takePictureAsync({ quality: 0.9 });
    if (!snimka) return;
    let uri = snimka.uri;
    if (rezim === 'obrazok' && ramKamery.current) {
      try {
        uri = await orezNaVodidlo(snimka.uri, ramKamery.current);
      } catch {}
    }
    spracuj(uri);
  }

  async function vyberZGalerie() {
    if (!(await ImagePicker.requestMediaLibraryPermissionsAsync()).granted) {
      setSprava('Bez povolenia do galérie nie je možné vybrať obrázok.');
      setStav('chyba');
      return;
    }
    const vyber = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!vyber.canceled && vyber.assets[0]) spracuj(vyber.assets[0].uri);
  }

  const prepinacRezimu = (
    <Prepinac
      naFotke
      moznosti={[
        ['obrazok', 'Obrázok'],
        ['dokument', 'Dokument'],
      ]}
      hodnota={rezim}
      zmena={setRezim}
    />
  );

  return (
    <View style={styles.stranka}>
      <SafeAreaView style={styles.obsah} edges={['top', 'bottom']}>
        <View style={styles.obalRamu}>
          {zobrazena ? (
            <View style={styles.ram}>
              <Image source={{ uri: zobrazena }} style={styles.fotka} resizeMode="contain" />
              <HornaLista nadpis={stav === 'pocita' ? 'Spracúva sa' : maMasku ? 'Skontroluj masku' : 'Skús to znova'} zavriet={zacniZnova} />
              {maMasku && (
                <Prepinac
                  naFotke
                  moznosti={[
                    ['maska', 'Maska'],
                    ['original', 'Originál'],
                    ['vyrez', 'Výrez'],
                  ]}
                  hodnota={pohlad}
                  zmena={setPohlad}
                />
              )}
              {(stav === 'pocita' || stav === 'urcuje') && (
                <View style={[StyleSheet.absoluteFill, styles.pocitanie]}>
                  <ActivityIndicator color={FARBY.biela} size="large" />
                  <Text style={styles.textPocitania}>{stav === 'urcuje' ? 'Klasifikuje sa…' : 'Spracúva sa…'}</Text>
                </View>
              )}
            </View>
          ) : zdroj === 'subor' ? (
            <View style={styles.ram}>
              <View style={[StyleSheet.absoluteFill, styles.vyzva]}>
                <Ikona ios="square.and.arrow.up" android="upload_file" velkost={32} />
                <Text style={styles.textVyzvy}>Nahraj fotku vzorky zo súboru.</Text>
              </View>
              <HornaLista nadpis="Nahraj obrázok" zavriet={() => zmenZdroj('kamera')} />
              {prepinacRezimu}
            </View>
          ) : povolenie?.granted ? (
            <View
              style={styles.ram}
              onLayout={(e) => {
                ramKamery.current = e.nativeEvent.layout;
              }}>
              <CameraView ref={kamera} style={StyleSheet.absoluteFill} facing="back" />
              <HornaLista nadpis="Zarovnaj vzorku na stred" zavriet={zacniZnova} />
              {prepinacRezimu}
              <Vodidlo />
            </View>
          ) : (
            <View style={[styles.ram, styles.vyzva]}>
              <Ikona ios="camera.fill" android="photo_camera" velkost={32} />
              <Text style={styles.textVyzvy}>Potrebujeme prístup ku kamere.</Text>
              <Pressable onPress={poziadajOPovolenie} style={styles.tlacidloVyzvy}>
                <Text style={styles.popisVyzvy}>Povoliť kameru</Text>
              </Pressable>
            </View>
          )}
        </View>

        {sprava && stav !== 'pocita' && (
          <View style={[styles.sprava, stav === 'chyba' && styles.chyba]}>
            {stav === 'chyba' ? (
              <Ikona ios="xmark.circle.fill" android="error" farba={FARBY.cervena} />
            ) : (
              <Ikona ios="exclamationmark.triangle.fill" android="warning" farba={FARBY.jantarova} />
            )}
            <Text style={styles.textSpravy}>{sprava}</Text>
          </View>
        )}

        {maMasku ? (
          <Pressable onPress={urci} disabled={stav === 'urcuje'} style={({ pressed }) => [styles.urcit, pressed && styles.stlacene]}>
            <Ikona ios="list.bullet.rectangle" android="fact_check" velkost={18} />
            <Text style={styles.popisUrcit}>Klasifikovať</Text>
          </Pressable>
        ) : (
          <View style={styles.tip}>
            <View style={styles.ikonaTipu}>
              <Ikona ios="lightbulb.fill" android="lightbulb" farba={FARBY.jantarova} />
            </View>
            <Text style={styles.textTipu}>
              {rezim === 'dokument'
                ? 'Odfoť celú stránku – text sa odstráni a škvrny sa nájdu samy.'
                : 'Obrázok s plesňou by mal byť v strede a celý viditeľný.'}
            </Text>
          </View>
        )}

        <View style={styles.okraje}>
          <Prepinac
            moznosti={[
              ['kamera', 'Skenovanie'],
              ['subor', 'Nahraj súbor'],
            ]}
            hodnota={zdroj}
            zmena={zmenZdroj}
          />
        </View>

        <View style={styles.spodok}>
          {zobrazena ? (
            <Pressable onPress={zacniZnova} style={({ pressed }) => [styles.velkeTlacidlo, styles.biele, pressed && styles.stlacene]}>
              <Ikona ios="arrow.clockwise" android="refresh" farba={FARBY.tmavomodra} velkost={18} />
              <Text style={[styles.popisTlacidla, styles.tmavyPopis]}>Skenovať znova</Text>
            </Pressable>
          ) : zdroj === 'kamera' ? (
            <>
              <Pressable onPress={vyberZGalerie} style={({ pressed }) => [styles.bocne, pressed && styles.stlacene]}>
                <Ikona ios="photo.on.rectangle" android="photo_library" velkost={20} />
              </Pressable>
              <Pressable onPress={odfot} disabled={!povolenie?.granted} style={({ pressed }) => [styles.spust, pressed && styles.stlacene]}>
                <View style={styles.spustVnutri} />
              </Pressable>
              <View style={[styles.bocne, styles.skryte]} />
            </>
          ) : (
            <Pressable onPress={vyberZGalerie} style={({ pressed }) => [styles.velkeTlacidlo, styles.modre, pressed && styles.stlacene]}>
              <Ikona ios="square.and.arrow.up" android="upload_file" velkost={18} />
              <Text style={styles.popisTlacidla}>Nahrať súbor</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function HornaLista({ nadpis, zavriet }: { nadpis: string; zavriet: () => void }) {
  return (
    <View style={styles.horna}>
      <Pressable onPress={zavriet} hitSlop={8} style={styles.zavriet}>
        <Ikona ios="xmark" android="close" />
      </Pressable>
      <Text style={styles.nadpis} numberOfLines={1}>
        {nadpis}
      </Text>
      <View style={styles.medzera} />
    </View>
  );
}

const styles = StyleSheet.create({
  stranka: { flex: 1, backgroundColor: FARBY.pozadie },
  obsah: { flex: 1, gap: MEDZERA[2] },
  obalRamu: { flex: 1, paddingHorizontal: MEDZERA[3], paddingTop: MEDZERA[2] },
  ram: { flex: 1, borderRadius: 28, overflow: 'hidden', backgroundColor: FARBY.cierna },
  fotka: { width: '100%', height: '100%' },
  vyzva: { alignItems: 'center', justifyContent: 'center', gap: MEDZERA[2], padding: MEDZERA[4] },
  textVyzvy: { color: FARBY.text, fontSize: 13, textAlign: 'center' },
  tlacidloVyzvy: { backgroundColor: FARBY.biela, borderRadius: MEDZERA[2], paddingHorizontal: MEDZERA[4], paddingVertical: MEDZERA[2] },
  popisVyzvy: { color: FARBY.tmavomodra, fontWeight: '700', fontSize: 14 },
  horna: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: MEDZERA[3],
    paddingVertical: MEDZERA[2],
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  zavriet: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  medzera: { width: 30 },
  nadpis: { flex: 1, color: FARBY.biela, fontSize: 13, fontWeight: '600', textAlign: 'center', marginHorizontal: MEDZERA[2] },
  pocitanie: { backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: MEDZERA[2] },
  textPocitania: { color: FARBY.biela, fontSize: 14, fontWeight: '600' },
  sprava: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: MEDZERA[2],
    marginHorizontal: MEDZERA[3],
    borderRadius: MEDZERA[2],
    padding: MEDZERA[3],
    backgroundColor: 'rgba(245,165,36,0.15)',
  },
  chyba: { backgroundColor: 'rgba(229,72,77,0.15)' },
  textSpravy: { flex: 1, color: FARBY.text, fontSize: 13 },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: MEDZERA[2],
    marginHorizontal: MEDZERA[3],
    padding: MEDZERA[3],
    borderRadius: MEDZERA[3],
    backgroundColor: FARBY.panel,
    borderWidth: 1,
    borderColor: FARBY.okrajPanela,
  },
  ikonaTipu: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(245,165,36,0.18)' },
  textTipu: { flex: 1, color: FARBY.tlmeny, fontSize: 12, lineHeight: 17 },
  urcit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: MEDZERA[2],
    marginHorizontal: MEDZERA[3],
    paddingVertical: MEDZERA[3],
    borderRadius: MEDZERA[3],
    backgroundColor: FARBY.tmavomodra,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  popisUrcit: { color: FARBY.biela, fontSize: 15, fontWeight: '700' },
  okraje: { marginHorizontal: MEDZERA[3] },
  spodok: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: MEDZERA[5], paddingHorizontal: MEDZERA[4], paddingBottom: MEDZERA[2] },
  bocne: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  skryte: { opacity: 0 },
  spust: { width: 68, height: 68, borderRadius: 34, borderWidth: 3, borderColor: FARBY.biela, alignItems: 'center', justifyContent: 'center' },
  spustVnutri: { width: 54, height: 54, borderRadius: 27, backgroundColor: FARBY.biela },
  velkeTlacidlo: { flexDirection: 'row', alignItems: 'center', gap: MEDZERA[2], paddingHorizontal: MEDZERA[5], paddingVertical: MEDZERA[3], borderRadius: MEDZERA[3] },
  biele: { backgroundColor: FARBY.biela },
  modre: { backgroundColor: FARBY.tmavomodra },
  popisTlacidla: { color: FARBY.biela, fontSize: 15, fontWeight: '700' },
  tmavyPopis: { color: FARBY.tmavomodra },
  stlacene: { opacity: 0.75 },
});
