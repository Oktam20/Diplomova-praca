import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FARBY, MEDZERA } from '@/vzhlad';

type Props<T extends string> = {
  moznosti: [T, string][];
  hodnota: T;
  zmena: (hodnota: T) => void;
  naFotke?: boolean;
};

/** Prepínač medzi niekoľkými možnosťami – na lište alebo priesvitný nad fotkou. */
export function Prepinac<T extends string>({ moznosti, hodnota, zmena, naFotke = false }: Props<T>) {
  const s = naFotke ? fotka : lista;
  const prepinac = (
    <View style={s.drazka}>
      {moznosti.map(([moznost, popis]) => (
        <Pressable key={moznost} onPress={() => zmena(moznost)} style={[s.cast, hodnota === moznost && s.vybrana]}>
          <Text style={[s.popis, hodnota === moznost && s.vybranyPopis]}>{popis}</Text>
        </Pressable>
      ))}
    </View>
  );
  if (!naFotke) return prepinac;
  return (
    <View style={fotka.obal} pointerEvents="box-none">
      {prepinac}
    </View>
  );
}

const lista = StyleSheet.create({
  drazka: { flexDirection: 'row', padding: 4, borderRadius: MEDZERA[3], backgroundColor: FARBY.lista },
  cast: { flex: 1, alignItems: 'center', paddingVertical: MEDZERA[2], borderRadius: MEDZERA[2] },
  vybrana: { backgroundColor: FARBY.biela },
  popis: { fontSize: 13, fontWeight: '600', color: FARBY.tlmeny },
  vybranyPopis: { color: FARBY.tmavomodra },
});

const fotka = StyleSheet.create({
  obal: { position: 'absolute', top: 58, left: 0, right: 0, alignItems: 'center' },
  drazka: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: MEDZERA[3], padding: 3, gap: 2 },
  cast: { paddingHorizontal: MEDZERA[3], paddingVertical: 6, borderRadius: MEDZERA[2] },
  vybrana: { backgroundColor: FARBY.biela },
  popis: { fontSize: 12, fontWeight: '600', color: FARBY.biela },
  vybranyPopis: { color: FARBY.tmavomodra },
});
