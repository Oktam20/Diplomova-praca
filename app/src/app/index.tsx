import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScanPalette } from '@/constants/scan-palette';
import { Spacing } from '@/constants/theme';
import {
  classifyDetection,
  detectMoldOnDeviceDocument,
  detectMoldOnDeviceImage,
  type DetectionData,
} from '@/mold-detection/device';
import { consumeNewScanRequest, setScanResult } from '@/mold-detection/result-store';

type Mode = 'obrazok' | 'dokument';
type Status = 'idle' | 'processing' | 'done' | 'classifying' | 'warning' | 'error';
type CaptureMode = 'camera' | 'upload';
type ResultView = 'result' | 'original' | 'cutout';

const GUIDE_INSET = { top: 108, left: 20, right: 20, bottom: 20 } as const;

/** Oreže fotku na oblasť vyznačenú rohmi v náhľade. */
async function cropToGuide(uri: string, frame: { width: number; height: number }): Promise<string> {
  const photo = await ImageManipulator.manipulate(uri).renderAsync();
  const imgW = photo.width;
  const imgH = photo.height;
  const scale = Math.max(frame.width / imgW, frame.height / imgH);
  const offX = (frame.width - imgW * scale) / 2;
  const offY = (frame.height - imgH * scale) / 2;
  const toX = (vx: number) => Math.min(imgW, Math.max(0, Math.round((vx - offX) / scale)));
  const toY = (vy: number) => Math.min(imgH, Math.max(0, Math.round((vy - offY) / scale)));
  const x0 = toX(GUIDE_INSET.left);
  const x1 = toX(frame.width - GUIDE_INSET.right);
  const y0 = toY(GUIDE_INSET.top);
  const y1 = toY(frame.height - GUIDE_INSET.bottom);
  if (x1 - x0 < 16 || y1 - y0 < 16) return uri;

  const cropped = await ImageManipulator.manipulate(uri)
    .crop({ originX: x0, originY: y0, width: x1 - x0, height: y1 - y0 })
    .renderAsync();
  const saved = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: 1 });
  return saved.uri;
}

export default function Scan() {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('camera');
  const [mode, setMode] = useState<Mode>('obrazok');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const cameraFrame = useRef<{ width: number; height: number } | null>(null);

  const [originalUri, setOriginalUri] = useState<string | null>(null);
  const [preprocessedUri, setPreprocessedUri] = useState<string | null>(null);
  const [maskUri, setMaskUri] = useState<string | null>(null);
  const [cutoutUri, setCutoutUri] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [resultView, setResultView] = useState<ResultView>('result');
  const detection = useRef<{
    data: DetectionData;
    mode: Mode;
    durationMs: number;
    farebnyProfil: string | null;
  } | null>(null);

  const hasMask = (status === 'done' || status === 'classifying') && !!preprocessedUri;
  const displayUri = hasMask
    ? resultView === 'result'
      ? (maskUri ?? preprocessedUri)
      : resultView === 'cutout'
        ? (cutoutUri ?? preprocessedUri)
        : preprocessedUri
    : (preprocessedUri ?? originalUri);

  useFocusEffect(
    useCallback(() => {
      if (consumeNewScanRequest()) reset();
    }, [])
  );

  async function processImage(uri: string, selectedMode: Mode) {
    setStatus('processing');
    setMessage(null);
    clearResults();

    try {
      const result =
        selectedMode === 'dokument' ? await detectMoldOnDeviceDocument(uri) : await detectMoldOnDeviceImage(uri);
      setPreprocessedUri(result.imageUri);
      setMaskUri(result.maskUri);
      setCutoutUri(result.cutoutUri);
      if (!result.data) {
        setMessage(result.message ?? 'Maska sa nevytvorila.');
        setStatus('warning');
        return;
      }
      if (result.message) {
        if (selectedMode !== 'dokument') {
          setMessage(result.message);
          setStatus('warning');
          return;
        }
        setMessage(result.message);
      }
      detection.current = {
        data: result.data,
        mode: selectedMode,
        durationMs: result.durationMs,
        farebnyProfil: result.farebnyProfil,
      };
      setStatus('done');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Spracovanie v zariadení zlyhalo.');
      setStatus('error');
    }
  }

  async function classify() {
    const d = detection.current;
    if (!d) return;
    setStatus('classifying');
    setMessage(null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      const skupiny = await classifyDetection(d.data);
      setScanResult({
        mode: d.mode,
        imageUri: preprocessedUri,
        maskUri,
        cutoutUri,
        skupiny,
        durationMs: d.durationMs,
        farebnyProfil: d.farebnyProfil,
      });
      router.push('/vysledok');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Klasifikácia zlyhala.');
    }
    setStatus('done');
  }

  function clearResults() {
    setPreprocessedUri(null);
    setMaskUri(null);
    setCutoutUri(null);
    detection.current = null;
  }

  function handleNewImage(uri: string) {
    setOriginalUri(uri);
    setResultView('result');
    processImage(uri, mode);
  }

  function reset() {
    setOriginalUri(null);
    clearResults();
    setStatus('idle');
    setMessage(null);
    setResultView('result');
  }

  function switchCaptureMode(next: CaptureMode) {
    setCaptureMode(next);
    reset();
  }

  async function handleShutterPress() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
    if (!photo) return;
    let uri = photo.uri;
    if (mode === 'obrazok' && cameraFrame.current) {
      try {
        uri = await cropToGuide(photo.uri, cameraFrame.current);
      } catch {
      }
    }
    handleNewImage(uri);
  }

  async function openLibrary() {
    const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!libraryPermission.granted) {
      setMessage('Bez povolenia do galérie nie je možné vybrať obrázok.');
      setStatus('error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      handleNewImage(result.assets[0].uri);
    }
  }

  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.frameWrapper}>
          {displayUri ? (
            <View style={styles.frame}>
              <Image source={{ uri: displayUri }} style={styles.frameImage} resizeMode="contain" />
              <FrameTopBar
                title={
                  status === 'processing' ? 'Spracúva sa' : hasMask ? 'Skontroluj masku' : 'Skús to znova'
                }
                onClose={reset}
              />
              {hasMask && <ResultViewToggle view={resultView} onChange={setResultView} />}
              {(status === 'processing' || status === 'classifying') && (
                <View style={[StyleSheet.absoluteFill, styles.processingOverlay]}>
                  <ActivityIndicator color="#FFFFFF" size="large" />
                  <Text style={styles.processingText}>
                    {status === 'classifying' ? 'Klasifikuje sa…' : 'Spracúva sa…'}
                  </Text>
                </View>
              )}
            </View>
          ) : captureMode === 'camera' ? (
            permission?.granted ? (
              <View
                style={styles.frame}
                onLayout={(e) => {
                  cameraFrame.current = e.nativeEvent.layout;
                }}>
                <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
                <FrameTopBar title="Zarovnaj vzorku na stred" onClose={reset} />
                <ModeToggle mode={mode} onChange={setMode} />
                <ScanGuide />
              </View>
            ) : (
              <View style={[styles.frame, styles.centeredPrompt]}>
                <SymbolView
                  name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                  tintColor="#FFFFFF"
                  size={32}
                />
                <Text style={styles.promptText}>Potrebujeme prístup ku kamere.</Text>
                <Pressable onPress={requestPermission} style={styles.promptButton}>
                  <Text style={styles.promptButtonLabel}>Povoliť kameru</Text>
                </Pressable>
              </View>
            )
          ) : (
            <View style={styles.frame}>
              <View style={[StyleSheet.absoluteFill, styles.centeredPrompt]}>
                <SymbolView
                  name={{ ios: 'square.and.arrow.up', android: 'upload_file', web: 'upload_file' }}
                  tintColor="#FFFFFF"
                  size={32}
                />
                <Text style={styles.promptText}>Nahraj fotku vzorky zo súboru.</Text>
              </View>
              <FrameTopBar title="Nahraj obrázok" onClose={() => switchCaptureMode('camera')} />
              <ModeToggle mode={mode} onChange={setMode} />
            </View>
          )}
        </View>

        {message && status !== 'processing' && (
          <View style={[styles.messageBox, status === 'error' && styles.messageBoxError]}>
            <SymbolView
              name={{
                ios: status === 'error' ? 'xmark.circle.fill' : 'exclamationmark.triangle.fill',
                android: status === 'error' ? 'error' : 'warning',
                web: status === 'error' ? 'error' : 'warning',
              }}
              tintColor={status === 'error' ? ScanPalette.danger : ScanPalette.accentAmber}
              size={16}
            />
            <Text style={styles.messageText}>{message}</Text>
          </View>
        )}

        {hasMask ? (
          <Pressable
            onPress={classify}
            disabled={status === 'classifying'}
            style={({ pressed }) => [styles.classifyButton, pressed && styles.pressed]}>
            <SymbolView
              name={{ ios: 'list.bullet.rectangle', android: 'fact_check', web: 'fact_check' }}
              tintColor="#FFFFFF"
              size={18}
            />
            <Text style={styles.classifyLabel}>Klasifikovať</Text>
          </Pressable>
        ) : (
          <View style={styles.tipBanner}>
            <View style={styles.tipIcon}>
              <SymbolView
                name={{ ios: 'lightbulb.fill', android: 'lightbulb', web: 'lightbulb' }}
                tintColor={ScanPalette.accentAmber}
                size={16}
              />
            </View>
            <Text style={styles.tipText}>
              {mode === 'dokument'
                ? 'Odfoť celú stránku – text sa odstráni a škvrny sa nájdu samy.'
                : 'Obrázok s plesňou by mal byť v strede a celý viditeľný.'}
            </Text>
          </View>
        )}

        <View style={styles.segmentedTrack}>
          <Pressable
            onPress={() => switchCaptureMode('camera')}
            style={[styles.segment, captureMode === 'camera' && styles.segmentActive]}>
            <Text
              style={[styles.segmentLabel, captureMode === 'camera' && styles.segmentLabelActive]}>
              Skenovanie
            </Text>
          </Pressable>
          <Pressable
            onPress={() => switchCaptureMode('upload')}
            style={[styles.segment, captureMode === 'upload' && styles.segmentActive]}>
            <Text
              style={[styles.segmentLabel, captureMode === 'upload' && styles.segmentLabelActive]}>
              Nahraj súbor
            </Text>
          </Pressable>
        </View>

        <View style={styles.bottomRow}>
          {displayUri ? (
            <Pressable
              onPress={reset}
              style={({ pressed }) => [styles.retakeButton, pressed && styles.pressed]}>
              <SymbolView
                name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
                tintColor={ScanPalette.navy}
                size={18}
              />
              <Text style={styles.retakeLabel}>Skenovať znova</Text>
            </Pressable>
          ) : captureMode === 'camera' ? (
            <>
              <Pressable
                onPress={openLibrary}
                style={({ pressed }) => [styles.sideIconButton, pressed && styles.pressed]}>
                <SymbolView
                  name={{ ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' }}
                  tintColor="#FFFFFF"
                  size={20}
                />
              </Pressable>
              <Pressable
                onPress={handleShutterPress}
                disabled={!permission?.granted}
                style={({ pressed }) => [styles.shutterButton, pressed && styles.pressed]}>
                <View style={styles.shutterInner} />
              </Pressable>
              <View style={[styles.sideIconButton, styles.sideIconButtonHidden]} />
            </>
          ) : (
            <Pressable
              onPress={openLibrary}
              style={({ pressed }) => [styles.uploadButton, pressed && styles.pressed]}>
              <SymbolView
                name={{ ios: 'square.and.arrow.up', android: 'upload_file', web: 'upload_file' }}
                tintColor="#FFFFFF"
                size={18}
              />
              <Text style={styles.uploadButtonLabel}>Nahrať súbor</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function FrameTopBar({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={onClose} hitSlop={8} style={styles.topBarIcon}>
        <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} tintColor="#FFFFFF" size={16} />
      </Pressable>

      <Text style={styles.topBarTitle} numberOfLines={1}>
        {title}
      </Text>

      <View style={styles.topBarSpacer} />
    </View>
  );
}

function ScanGuide() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />
      <View style={styles.focusRing}>
        <View style={styles.focusDot} />
      </View>
    </View>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const options: [Mode, string][] = [
    ['obrazok', 'Obrázok'],
    ['dokument', 'Dokument'],
  ];
  return (
    <View style={styles.modeToggleWrapper} pointerEvents="box-none">
      <View style={styles.modeToggle}>
        {options.map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => onChange(value)}
            style={[styles.modeToggleSegment, mode === value && styles.modeToggleSegmentActive]}>
            <Text style={[styles.modeToggleLabel, mode === value && styles.modeToggleLabelActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ResultViewToggle({ view, onChange }: { view: ResultView; onChange: (view: ResultView) => void }) {
  const options: [ResultView, string][] = [
    ['result', 'Maska'],
    ['original', 'Originál'],
    ['cutout', 'Výrez'],
  ];
  return (
    <View style={styles.modeToggleWrapper} pointerEvents="box-none">
      <View style={styles.modeToggle}>
        {options.map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => onChange(value)}
            style={[styles.modeToggleSegment, view === value && styles.modeToggleSegmentActive]}>
            <Text style={[styles.modeToggleLabel, view === value && styles.modeToggleLabelActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: ScanPalette.screenBg,
  },
  safeArea: {
    flex: 1,
    gap: Spacing.two,
  },
  frameWrapper: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  frame: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  frameImage: {
    width: '100%',
    height: '100%',
  },
  centeredPrompt: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  promptText: {
    color: ScanPalette.textLight,
    fontSize: 13,
    textAlign: 'center',
  },
  promptButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  promptButtonLabel: {
    color: ScanPalette.navy,
    fontWeight: '700',
    fontSize: 14,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  topBarIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  topBarSpacer: {
    width: 30,
  },
  topBarTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: Spacing.two,
  },
  modeToggleWrapper: {
    position: 'absolute',
    top: 58,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: Spacing.three,
    padding: 3,
    gap: 2,
  },
  modeToggleSegment: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Spacing.two,
  },
  modeToggleSegmentActive: {
    backgroundColor: '#FFFFFF',
  },
  modeToggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modeToggleLabelActive: {
    color: ScanPalette.navy,
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#FFFFFF',
  },
  cornerTL: {
    top: GUIDE_INSET.top,
    left: GUIDE_INSET.left,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    top: GUIDE_INSET.top,
    right: GUIDE_INSET.right,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    bottom: GUIDE_INSET.bottom,
    left: GUIDE_INSET.left,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    bottom: GUIDE_INSET.bottom,
    right: GUIDE_INSET.right,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
  focusRing: {
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
  focusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  processingOverlay: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  processingText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  messageBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    backgroundColor: 'rgba(245,165,36,0.15)',
  },
  messageBoxError: {
    backgroundColor: 'rgba(229,72,77,0.15)',
  },
  messageText: {
    flex: 1,
    color: ScanPalette.textLight,
    fontSize: 13,
  },
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: ScanPalette.panel,
    borderWidth: 1,
    borderColor: ScanPalette.panelBorder,
  },
  classifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: ScanPalette.navy,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  classifyLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  tipIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245,165,36,0.18)',
  },
  tipText: {
    flex: 1,
    color: ScanPalette.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  segmentedTrack: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    padding: 4,
    borderRadius: Spacing.three,
    backgroundColor: ScanPalette.trackBg,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: ScanPalette.textMuted,
  },
  segmentLabelActive: {
    color: ScanPalette.navy,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  sideIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  sideIconButtonHidden: {
    opacity: 0,
  },
  shutterButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFFFFF',
  },
  pressed: {
    opacity: 0.75,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  retakeLabel: {
    color: ScanPalette.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: ScanPalette.navy,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  uploadButtonLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
