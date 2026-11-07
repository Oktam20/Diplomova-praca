/** Prestávka medzi fázami výpočtu, aby sa v aplikácii stihlo prekresliť UI (spinner). */
let useTimer = true;

export function setYieldToEventLoop(enabled: boolean): void {
  useTimer = enabled;
}

export function tick(): Promise<void> {
  return useTimer ? new Promise<void>((resolve) => setTimeout(resolve, 0)) : Promise.resolve();
}
