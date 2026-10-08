// Customises the Android project that `npx cap add android` generates (it is not
// committed): app icon and version. Run after `cap add` / `cap sync`.
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

// ── Icon: an adaptive icon (vector globe on the app's dark blue), plus PNGs for old Androids.
write(
  'values/ev_icon.xml',
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ev_icon_bg">#161D2B</color>\n</resources>\n`,
);
write(
  'drawable/ev_icon_fg.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
  <path android:fillColor="#3ECFB2" android:pathData="M54,22a32,32 0 1,0 0.01,0z" />
  <path android:fillColor="#3A86C8" android:pathData="M54,25.5a28.5,28.5 0 1,0 0.01,0z" />
  <path android:fillColor="#C1E599" android:pathData="M35,43.6L50.5,37.6L59.2,41.1L64.3,39.4L66.1,46.2L55.7,54L54.9,66.9L47.1,62.6L38.5,54Z" />
  <path android:fillColor="#EBCA8A" android:pathData="M61.8,63.5L64.8,58.3L70.8,58.3L73.8,63.5L70.8,68.7L64.8,68.7Z" />
</vector>
`,
);
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

// ── Version shown in Android settings, from package.json ("2.1.0" → name 2.1.0, code 20100).
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const [maj, min, pat] = version.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
const gradle = path.join(root, 'android/app/build.gradle');
let g = fs.readFileSync(gradle, 'utf8');
g = g.replace(/versionCode \d+/, `versionCode ${maj * 10000 + min * 100 + pat}`).replace(/versionName "[^"]*"/, `versionName "${version}"`);
fs.writeFileSync(gradle, g);

console.log(`Android project set up: icon, version ${version}`);
