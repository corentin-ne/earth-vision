// Customises the Android project that `npx cap add android` generates (it is not
// committed): app icon, version and — when ANDROID_KEYSTORE_PATH is set — a permanent
// release signing key. Run after `cap add` / `cap sync`.
//
// The key matters: Android only installs an update over an existing app when both are
// signed with the same key. CI used to sign with a throwaway debug key, so every APK
// looked like a different app and could not replace the installed one.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const res = path.join(root, 'android/app/src/main/res');
if (!fs.existsSync(res)) {
  console.error('No android/ project: run `npx cap add android` first.');
  process.exit(1);
}
const write = (rel, text) => {
  const p = path.join(res, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

// ── Icon: an adaptive icon (the loading screen's glowing ball, public/icon-fg.png from
// scripts/make-icons.py, on the app's dark blue), plus PNGs for old Androids.
write(
  'values/ev_icon.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ev_icon_bg">#0D1322</color>
</resources>
`,
);
fs.rmSync(path.join(res, 'drawable/ev_icon_fg.xml'), { force: true });
fs.copyFileSync(path.join(root, 'public/icon-fg.png'), path.join(res, 'drawable/ev_icon_fg.png'));
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ev_icon_bg" />
  <foreground android:drawable="@drawable/ev_icon_fg" />
  <monochrome android:drawable="@drawable/ev_icon_fg" />
</adaptive-icon>
`;
write('mipmap-anydpi-v26/ic_launcher.xml', adaptive);
write('mipmap-anydpi-v26/ic_launcher_round.xml', adaptive);
const png = fs.readFileSync(path.join(root, 'public/icon-192.png'));
for (const dir of fs.readdirSync(res).filter((d) => /^mipmap-[a-z]*dpi$/.test(d))) {
  fs.writeFileSync(path.join(res, dir, 'ic_launcher.png'), png);
  fs.writeFileSync(path.join(res, dir, 'ic_launcher_round.png'), png);
}

// ── "Open with Earth Vision" for .map files in file managers (and attachments). Android knows no
// MIME type for .map, so they come as application/octet-stream (or zip, which a .map is inside).
const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('ev-open-map')) {
  const filter = `
            <!-- ev-open-map: open .map worlds from the file manager -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/zip" />
                <data android:mimeType="application/x-zip-compressed" />
            </intent-filter>
`;
  const launcher = manifest.indexOf('android.intent.category.LAUNCHER');
  const end = launcher < 0 ? -1 : manifest.indexOf('</intent-filter>', launcher);
  if (end < 0) throw new Error('Could not find the launcher activity in AndroidManifest.xml');
  const at = end + '</intent-filter>'.length;
  manifest = manifest.slice(0, at) + '\n' + filter + manifest.slice(at);
  fs.writeFileSync(manifestPath, manifest);
}

// ── Version shown in Android settings, from package.json ("2.1.0" → name 2.1.0, code 20100).
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const [maj, min, pat] = version.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
const gradle = path.join(root, 'android/app/build.gradle');
let g = fs.readFileSync(gradle, 'utf8');
g = g.replace(/versionCode \d+/, `versionCode ${maj * 10000 + min * 100 + pat}`).replace(/versionName "[^"]*"/, `versionName "${version}"`);

// ── Signing: the same key for every release (passwords stay in the environment).
const keystore = process.env.ANDROID_KEYSTORE_PATH;
if (keystore && !g.includes('signingConfigs')) {
  const ks = path.resolve(keystore).replace(/\\/g, '/');
  g = g.replace(
    /\n    buildTypes \{/,
    `
    signingConfigs {
        release {
            storeFile file("${ks}")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS") ?: "earthvision"
            keyPassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
        }
    }
    buildTypes {`,
  );
  g = g.replace(/(\n    buildTypes \{\n        release \{\n)/, `$1            signingConfig signingConfigs.release\n`);
  if (!g.includes('signingConfig signingConfigs.release')) throw new Error('Could not add the signing config to build.gradle');
}
fs.writeFileSync(gradle, g);

console.log(`Android project set up: icon, .map files, version ${version}${keystore ? ', release signing' : ''}`);
