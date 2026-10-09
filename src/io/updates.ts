// Is there a newer release on GitHub? Checked when the Android app opens (at most every few
// hours) and on demand from the Advanced panel or the home screen. The web version updates
// itself through its service worker, so there it only reports the version.
import { create } from 'zustand';
import { isNative } from '../native';

export const APP_VERSION = __APP_VERSION__;
const REPO = 'corentin-ne/earth-vision';
const LAST_CHECK = 'ev.updateCheck';
const DISMISSED = 'ev.updateDismissed';
const EVERY = 6 * 3600_000;

export interface Release {
  version: string;
  /** The release page. */
  page: string;
  /** The Android package, when the release has one. */
  apk: string | null;
  published: string;
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current'; latest: Release }
  | { status: 'available'; latest: Release }
  | { status: 'error'; message: string };

/** The last check's outcome, and whether its banner should show. */
export const useUpdates = create<UpdateState & { banner: boolean }>(() => ({ status: 'idle', banner: false }));

/** -1, 0 or 1 comparing "2.10.0" with "2.9.3" numerically, part by part. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

async function latestRelease(): Promise<Release> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!r.ok) throw new Error(r.status === 403 ? 'GitHub is busy, try again in a while' : `GitHub answered ${r.status}`);
  const d = (await r.json()) as { tag_name: string; html_url: string; published_at: string; assets: { name: string; browser_download_url: string }[] };
  return {
    version: d.tag_name.replace(/^v/, ''),
    page: d.html_url,
    apk: d.assets.find((a) => a.name.endsWith('.apk'))?.browser_download_url ?? null,
    published: d.published_at,
  };
}

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

/**
 * Asks GitHub for the latest release. `quiet` (the check on opening) only shows the banner for a
 * version the user hasn't dismissed and never reports errors.
 */
export async function checkForUpdates(quiet = false): Promise<UpdateState> {
  useUpdates.setState({ status: 'checking' });
  try {
    const latest = await latestRelease();
    store.set(LAST_CHECK, String(Date.now()));
    const newer = compareVersions(latest.version, APP_VERSION) > 0;
    const state: UpdateState = newer ? { status: 'available', latest } : { status: 'current', latest };
    useUpdates.setState({ ...state, banner: newer && isNative && (!quiet || store.get(DISMISSED) !== latest.version) });
    return state;
  } catch (e) {
    const state: UpdateState = { status: 'error', message: navigator.onLine === false ? 'You are offline' : String((e as Error)?.message ?? e) };
    useUpdates.setState({ ...(quiet ? { status: 'idle' } : state), banner: false });
    return state;
  }
}

/** On opening the Android app: a quiet check, at most every few hours. */
export function checkOnLaunch() {
  if (!isNative) return;
  const last = Number(store.get(LAST_CHECK) ?? 0);
  if (Date.now() - last < EVERY) return;
  void checkForUpdates(true);
}

/** Hides the banner and stops offering this version on launch. */
export function dismissUpdate() {
  const s = useUpdates.getState();
  if (s.status === 'available') store.set(DISMISSED, s.latest.version);
  useUpdates.setState({ banner: false });
}

/**
 * Opens the release's APK (or its page) outside the app: the system browser downloads it and
 * Android offers to install it over this version.
 */
export function openRelease(r: Release) {
  const url = (isNative && r.apk) || r.page;
  if (isNative) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
}
