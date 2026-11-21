import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { JazykProvider } from '@/jazyk';
import { VypoctovyWebView } from '@/vypocty/webview';

export default function Rozlozenie() {
  const schema = useColorScheme();
  return (
    <JazykProvider>
      <ThemeProvider value={schema === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="vysledok" />
        </Stack>
        <VypoctovyWebView />
      </ThemeProvider>
    </JazykProvider>
  );
}
