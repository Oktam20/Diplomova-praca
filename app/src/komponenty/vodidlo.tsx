import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { StyleSheet, View } from 'react-native';

import { FARBY } from '@/vzhlad';

/** Odstup rohov vodidla od okrajov náhľadu kamery. */
const ODSTUP = { top: 108, left: 20, right: 20, bottom: 20 } as const;

/** Rohy a stredový krúžok, podľa ktorých sa vzorka zarovná v náhľade kamery. */
export function Vodidlo() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.roh, styles.vlavoHore]} />
      <View style={[styles.roh, styles.vpravoHore]} />
      <View style={[styles.roh, styles.vlavoDole]} />
      <View style={[styles.roh, styles.vpravoDole]} />
      <View style={styles.kruzok}>
        <View style={styles.bodka} />
      </View>
    </View>
  );
}

/** Oreže fotku na oblasť medzi rohmi vodidla (náhľad je fotka zväčšená tak, aby vyplnila rám). */
export async function orezNaVodidlo(uri: string, ram: { width: number; height: number }): Promise<string> {
  const fotka = await ImageManipulator.manipulate(uri).renderAsync();
  const mierka = Math.max(ram.width / fotka.width, ram.height / fotka.height);
  const posunX = (ram.width - fotka.width * mierka) / 2;
  const posunY = (ram.height - fotka.height * mierka) / 2;
  const naX = (x: number) => Math.min(fotka.width, Math.max(0, Math.round((x - posunX) / mierka)));
  const naY = (y: number) => Math.min(fotka.height, Math.max(0, Math.round((y - posunY) / mierka)));
  const x0 = naX(ODSTUP.left);
  const x1 = naX(ram.width - ODSTUP.right);
  const y0 = naY(ODSTUP.top);
  const y1 = naY(ram.height - ODSTUP.bottom);
  if (x1 - x0 < 16 || y1 - y0 < 16) return uri;

  const orezana = await ImageManipulator.manipulate(uri)
    .crop({ originX: x0, originY: y0, width: x1 - x0, height: y1 - y0 })
    .renderAsync();
  return (await orezana.saveAsync({ format: SaveFormat.JPEG, compress: 1 })).uri;
}

const styles = StyleSheet.create({
  roh: { position: 'absolute', width: 28, height: 28, borderColor: FARBY.biela },
  vlavoHore: { top: ODSTUP.top, left: ODSTUP.left, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  vpravoHore: { top: ODSTUP.top, right: ODSTUP.right, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  vlavoDole: { bottom: ODSTUP.bottom, left: ODSTUP.left, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  vpravoDole: { bottom: ODSTUP.bottom, right: ODSTUP.right, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  kruzok: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 32,
    height: 32,
    marginLeft: -16,
    marginTop: -16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(239,68,68,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodka: { width: 6, height: 6, borderRadius: 3, backgroundColor: FARBY.biela },
});
