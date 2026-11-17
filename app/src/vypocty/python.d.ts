/** Python súbory sa do WebView vkladajú ako text (scripts/build-worker.mjs). */
declare module '*.py' {
  const kod: string;
  export default kod;
}
