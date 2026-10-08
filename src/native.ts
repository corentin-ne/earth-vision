// Bits that behave differently inside the Android app (Capacitor) than in a browser.
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/**
 * WebView downloads go nowhere on Android: write the file to the app cache and open the
 * system share sheet instead, from where it can be saved to Files / Drive or sent.
 */
export async function saveFileNative(data: Blob | Uint8Array | string, filename: string): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  const { uri } = await Filesystem.writeFile({ path: filename, data: toBase64(bytes), directory: Directory.Cache });
  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: `Save or send ${filename}` });
  } catch (e) {
    // Closing the share sheet rejects; that's not an error for the user.
    if (!/cancel/i.test(String((e as Error)?.message ?? e))) throw e;
  }
}

/** Android back button. The handler returns false when there is nothing left to go back from. */
export function onBackButton(handler: () => boolean) {
  if (!isNative) return () => {};
  let remove: (() => void) | null = null;
  let dead = false;
  import('@capacitor/app').then(({ App }) =>
    App.addListener('backButton', () => {
      if (!handler()) App.minimizeApp();
    }).then((h) => {
      if (dead) h.remove();
      else remove = () => h.remove();
    }),
  );
  return () => {
    dead = true;
    remove?.();
  };
}
