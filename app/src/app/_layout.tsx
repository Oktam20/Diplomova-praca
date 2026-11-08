import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { VypoctovyWebView } from '@/vypocty/webview';

export default function Rozlozenie() {
  const schema = useColorScheme();
  return (
    <ThemeProvider value={schema === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="vysledok" />
      </Stack>
      <VypoctovyWebView />
    </ThemeProvider>
  );
}
