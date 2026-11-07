import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScanPalette } from '@/constants/scan-palette';
import { Spacing } from '@/constants/theme';
import { isStepActive, MANUAL_KEY, type ManualKeyGroup, type SpotGroup } from '@/mold-detection/manual-key';
import { getScanResult, requestNewScan } from '@/mold-detection/result-store';

type ImageView = 'mask' | 'original' | 'cutout';

const partLabel = (cast: SpotGroup['cast']) =>
  cast === 'cela_fotka' ? 'Škvrna' : `Škvrna ${cast.replace('skvrna_', '')}`;

const MODE_LABELS: Record<string, string> = { obrazok: 'Obrázok', dokument: 'Dokument' };

const GROUP_DOT: Record<ManualKeyGroup, string> = {
  tmave: '#8a5a2b',
  svetle: '#e2b93b',
  neiste: ScanPalette.textMuted,
};

const KROK2 = isStepActive('krok_2') ? MANUAL_KEY.krok_2 : null;
const RELIABILITY: Record<string, number> = KROK2 ? KROK2.po_druhoch : MANUAL_KEY.po_druhoch;
const TON = isStepActive('svetle_ton') ? MANUAL_KEY.svetle_ton : null;
const TON_RELIABILITY: Record<string, number> = TON ? TON.po_druhoch_karticky : {};

const num = (v: number, digits = 1) => v.toFixed(digits).replace('.', ',').replace('-', '−');
const pct = (v: number) => `${Math.round(v * 100)} %`;
/** „Alternaria_Alternata“ -> „Alternaria alternata“, „Arthrobacter_Sp“ -> „Arthrobacter sp.“. */
const speciesName = (s: string) => {
  const [genus, ...rest] = s.split('_');
  const epithet = rest.join(' ').toLowerCase();
  return `${genus} ${epithet === 'sp' ? 'sp.' : epithet}`.trim();
};

export default function Vysledok() {
  const result = getScanResult();
  const [view, setView] = useState<ImageView>('mask');

  if (!result) {
    return (
      <View style={styles.page}>
        <SafeAreaView style={[styles.safeArea, styles.centered]} edges={['top', 'bottom']}>
          <Text style={styles.emptyText}>Žiadny výsledok – najprv naskenuj vzorku.</Text>
          <NewScanButton />
        </SafeAreaView>
      </View>
    );
  }

  const uri =
    (view === 'mask' ? result.maskUri : view === 'cutout' ? result.cutoutUri : result.imageUri) ??
    result.imageUri;

  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              tintColor="#FFFFFF"
              size={16}
            />
          </Pressable>
          <Text style={styles.headerTitle}>Výsledok skenu</Text>
          <View style={styles.modeChip}>
            <Text style={styles.modeChipLabel}>{MODE_LABELS[result.mode]}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.imageFrame}>
            {uri && <Image source={{ uri }} style={styles.image} resizeMode="contain" />}
          </View>
          <ImageToggle view={view} onChange={setView} />

          {result.skupiny.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyText}>Nenašla sa žiadna škvrna, ktorú by sa dalo zaradiť.</Text>
            </View>
          ) : (
            result.skupiny.map((spot) => <SpotCard key={spot.cast} spot={spot} />)
          )}

          <Text style={styles.footnote}>
            Overenie kľúča po kartičkách{' '}
            {pct(KROK2 ? KROK2.overenie_po_karticakch : MANUAL_KEY.overenie_po_karticakch)} · spracovanie{' '}
            {num(result.durationMs / 1000)} s
          </Text>
          <Text style={styles.footnote}>
            Farebný profil fotky: {result.farebnyProfil ?? 'neuvedený (berie sa ako sRGB)'}
            {result.farebnyProfil === 'Display P3' ? ' – prevedené do sRGB ako trénovacie dáta' : ''}
          </Text>
        </ScrollView>

        <NewScanButton />
      </SafeAreaView>
    </View>
  );
}

function SpotCard({ spot }: { spot: SpotGroup }) {
  const { vysledok } = spot;
  const reliability = RELIABILITY;
  const pod = vysledok.podskupina;
  const druh = vysledok.druh;
  const d1 = (d: string) => (d in reliability ? pct(reliability[d]) : '–');
  const dTon = (d: string) => (d in TON_RELIABILITY ? pct(TON_RELIABILITY[d]) : '–');
  let detail = '';
  if (vysledok.hodnota !== null) {
    const h = vysledok.hodnota;
    const diff = h - vysledok.prah;
    detail =
      `dL ${num(h, 2)} – o ${num(Math.abs(h), 1)} ${h < 0 ? 'tmavšia' : 'svetlejšia'} ako papier · ` +
      `${num(Math.abs(diff), 2)} ${diff <= 0 ? 'pod prahom (smer tmavé)' : 'nad prahom (smer svetlé)'}`;
  }
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.dot,
            { backgroundColor: vysledok.skupina ? GROUP_DOT[vysledok.skupina] : ScanPalette.textMuted },
          ]}
        />
        <View style={styles.cardTitleBox}>
          <Text style={styles.cardPart}>{partLabel(spot.cast)}</Text>
          {druh ? (
            <>
              <Text style={styles.determinedLabel}>Určený druh</Text>
              <Text style={styles.determinedName}>{speciesName(druh)}</Text>
              <Text style={styles.cardDetail}>
                {vysledok.nazov}
                {pod ? ` → ${pod.nazov}` : ''}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.cardGroup}>{vysledok.nazov}</Text>
              {pod && <Text style={styles.cardSubgroup}>→ {pod.nazov}</Text>}
            </>
          )}
        </View>
      </View>
      {spot.obrazok && <SpotFigure base64={spot.obrazok} />}
      {vysledok.skupina === 'neiste' && (
        <Text style={styles.cardDetail}>Hodnota je blízko prahu – škvrna môže patriť do oboch skupín.</Text>
      )}
      {vysledok.cesta.length > 0 && (
        <View style={styles.path}>
          <Text style={styles.speciesHead}>Cesta kľúčom</Text>
          {vysledok.cesta.map((k, i) => (
            <View key={i} style={styles.pathRow}>
              <Text style={styles.pathQuestion}>{k.otazka}</Text>
              <Text style={styles.pathText}>
                {k.popis} → <Text style={styles.pathDecision}>{k.vysledok}</Text>
              </Text>
            </View>
          ))}
        </View>
      )}
      {!druh && vysledok.druhy.length > 0 && (
        <View style={styles.speciesList}>
          <Text style={styles.speciesHead}>Druh zatiaľ neurčený – možné druhy</Text>
          {vysledok.druhy.map((d) => (
            <Text key={d} style={styles.speciesName}>
              {speciesName(d)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const FIGURE_LEGEND: [string, string][] = [
  ['#9ec5f4', 'zóna 0 (okraj)'],
  ['#6da7ec', 'zóna 1'],
  ['#3987e5', 'zóna 2'],
  ['#184f95', 'zóna 3 (stred)'],
  ['#e8862a', 'lem'],
  ['#808080', 'vynechané okolie'],
];

/** Obrázok čŕt škvrny: z čoho kľúč počíta (zóny, lem, papier = nezafarbené okolie). */
function SpotFigure({ base64 }: { base64: string }) {
  return (
    <View style={styles.figure}>
      <Image source={{ uri: `data:image/png;base64,${base64}` }} style={styles.figureImage} resizeMode="contain" />
      <View style={styles.legend}>
        {FIGURE_LEGEND.map(([color, label]) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: color }]} />
            <Text style={styles.legendLabel}>{label}</Text>
          </View>
        ))}
        <Text style={styles.legendLabel}>papier = bez farby, obrys škvrny červený</Text>
      </View>
    </View>
  );
}

function ImageToggle({ view, onChange }: { view: ImageView; onChange: (v: ImageView) => void }) {
  const options: [ImageView, string][] = [
    ['mask', 'Maska'],
    ['original', 'Originál'],
    ['cutout', 'Výrez'],
  ];
  return (
    <View style={styles.toggle}>
      {options.map(([value, label]) => (
        <Pressable
          key={value}
          onPress={() => onChange(value)}
          style={[styles.toggleSegment, view === value && styles.toggleSegmentActive]}>
          <Text style={[styles.toggleLabel, view === value && styles.toggleLabelActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function NewScanButton() {
  return (
    <Pressable
      onPress={() => {
        requestNewScan();
        if (router.canGoBack()) router.back();
        else router.replace('/');
      }}
      style={({ pressed }) => [styles.newScanButton, pressed && styles.pressed]}>
      <SymbolView
        name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
        tintColor={ScanPalette.navy}
        size={18}
      />
      <Text style={styles.newScanLabel}>Nový sken</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: ScanPalette.screenBg,
  },
  safeArea: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  headerTitle: {
    flex: 1,
    color: ScanPalette.textLight,
    fontSize: 17,
    fontWeight: '700',
  },
  modeChip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.two,
    backgroundColor: ScanPalette.trackBg,
  },
  modeChipLabel: {
    color: ScanPalette.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
  },
  imageFrame: {
    height: 300,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  toggle: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: Spacing.three,
    backgroundColor: ScanPalette.trackBg,
  },
  toggleSegment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  toggleSegmentActive: {
    backgroundColor: '#FFFFFF',
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: ScanPalette.textMuted,
  },
  toggleLabelActive: {
    color: ScanPalette.navy,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: ScanPalette.panel,
    borderWidth: 1,
    borderColor: ScanPalette.panelBorder,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  cardTitleBox: {
    flex: 1,
  },
  cardPart: {
    color: ScanPalette.textMuted,
    fontSize: 12,
  },
  cardGroup: {
    color: ScanPalette.textLight,
    fontSize: 16,
    fontWeight: '700',
  },
  cardDetail: {
    color: ScanPalette.textMuted,
    fontSize: 12,
  },
  cardSubgroup: {
    color: ScanPalette.textLight,
    fontSize: 14,
    fontWeight: '600',
  },
  determinedLabel: {
    color: ScanPalette.accentAmber,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  determinedName: {
    color: ScanPalette.textLight,
    fontSize: 22,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  cardDecision: {
    color: ScanPalette.textLight,
    fontSize: 12,
  },
  speciesList: {
    gap: 4,
    marginTop: Spacing.one,
  },
  speciesHead: {
    color: ScanPalette.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  path: {
    gap: 6,
    marginTop: Spacing.one,
  },
  pathRow: {
    gap: 1,
  },
  pathQuestion: {
    color: ScanPalette.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  pathText: {
    color: ScanPalette.textLight,
    fontSize: 12,
  },
  pathDecision: {
    fontWeight: '700',
  },
  figure: {
    gap: 6,
    marginTop: Spacing.one,
  },
  figureImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: '#000000',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendLabel: {
    color: ScanPalette.textMuted,
    fontSize: 11,
  },
  speciesName: {
    color: ScanPalette.textLight,
    fontSize: 13,
    fontStyle: 'italic',
  },
  footnote: {
    color: ScanPalette.textMuted,
    fontSize: 11,
  },
  emptyText: {
    color: ScanPalette.textMuted,
    fontSize: 13,
  },
  newScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: '#FFFFFF',
  },
  newScanLabel: {
    color: ScanPalette.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
});
