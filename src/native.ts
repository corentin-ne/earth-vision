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

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A readable name for a file the system handed over ("content://…/primary%3ADownload%2FEurope.map" → "Europe.map"). */
function nameOf(uri: string): string {
  const last = decodeURIComponent(uri.split(/[?#]/)[0]).split(/[/:]/).pop() || 'world';
  return /\.\w{2,6}$/.test(last) ? last : `${last}.map`;
}

/**
 * "Open with Earth Vision": a .map tapped in a file manager (Android VIEW intent, see
 * scripts/android-setup.mjs) — both when it starts the app and while the app is running.
 */
export function onOpenFile(handler: (file: File) => void) {
  if (!isNative) return () => {};
  let dead = false;
  let remove: (() => void) | null = null;
  const read = async (uri: string) => {
    if (!/^(content|file):/i.test(uri)) return;
    let bytes: Uint8Array;
    try {
      // The WebView's local server streams content:// and file:// URIs.
      const res = await fetch(Capacitor.convertFileSrc(uri));
      if (!res.ok) throw new Error(String(res.status));
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch {
      const { Filesystem } = await import('@capacitor/filesystem');
      const { data } = await Filesystem.readFile({ path: uri });
      bytes = typeof data === 'string' ? fromBase64(data) : new Uint8Array(await data.arrayBuffer());
    }
    if (!dead) handler(new File([bytes as BlobPart], nameOf(uri)));
  };
  import('@capacitor/app').then(async ({ App }) => {
    const launch = await App.getLaunchUrl();
    if (launch?.url) void read(launch.url);
    const h = await App.addListener('appUrlOpen', (e) => void read(e.url));
    if (dead) h.remove();
    else remove = () => h.remove();
  });
  return () => {
    dead = true;
    remove?.();
  };
}
