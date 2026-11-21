import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { JAZYKY, jeJazyk, PREDVOLENY_JAZYK, type Jazyk, type Texty } from '@/preklady';

const KLUC_ULOZENIA = 'jazyk';

let aktualny: Jazyk = PREDVOLENY_JAZYK;

/** Jazyk a texty mimo komponentov (napr. chybové hlásenia vo výpočtoch). */
export const aktualnyJazyk = () => aktualny;
export const aktualneTexty = (): Texty => JAZYKY[aktualny];

type Kontext = { jazyk: Jazyk; t: Texty; nastavJazyk: (jazyk: Jazyk) => void };

const JazykKontext = createContext<Kontext>({ jazyk: PREDVOLENY_JAZYK, t: JAZYKY[PREDVOLENY_JAZYK], nastavJazyk: () => {} });

/** Zvolený jazyk pre celú aplikáciu; zapamätá sa aj po zatvorení aplikácie. */
export function JazykProvider({ children }: { children: ReactNode }) {
  const [jazyk, setJazyk] = useState<Jazyk>(aktualny);

  useEffect(() => {
    (async () => {
      try {
        const ulozeny = await SecureStore.getItemAsync(KLUC_ULOZENIA);
        if (!jeJazyk(ulozeny)) return;
        aktualny = ulozeny;
        setJazyk(ulozeny);
      } catch {}
    })();
  }, []);

  const nastavJazyk = (novy: Jazyk) => {
    aktualny = novy;
    setJazyk(novy);
    (async () => {
      try {
        await SecureStore.setItemAsync(KLUC_ULOZENIA, novy);
      } catch {}
    })();
  };

  return <JazykKontext.Provider value={{ jazyk, t: JAZYKY[jazyk], nastavJazyk }}>{children}</JazykKontext.Provider>;
}

/** Aktuálny jazyk, jeho texty (`t`) a zmena jazyka. */
export const useJazyk = () => useContext(JazykKontext);
