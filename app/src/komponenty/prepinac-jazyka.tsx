import { Pressable, StyleSheet, Text } from 'react-native';

import { useJazyk } from '@/jazyk';
import { JAZYKY, type Jazyk } from '@/preklady';
import { FARBY } from '@/vzhlad';

const PORADIE = Object.keys(JAZYKY) as Jazyk[];

/** Okrúhle tlačidlo s kódom jazyka (SK / EN); ťuknutie prepne na ďalší jazyk. */
export function PrepinacJazyka() {
  const { jazyk, t, nastavJazyk } = useJazyk();
  const dalsi = PORADIE[(PORADIE.indexOf(jazyk) + 1) % PORADIE.length];
  return (
    <Pressable
      onPress={() => nastavJazyk(dalsi)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t.jazyk.prepnut}
      style={({ pressed }) => [styles.tlacidlo, pressed && styles.stlacene]}>
      <Text style={styles.kod}>{t.kod}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tlacidlo: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  stlacene: { opacity: 0.7 },
  kod: { color: FARBY.biela, fontSize: 11, fontWeight: '700' },
});
