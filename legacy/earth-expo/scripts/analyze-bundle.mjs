/**
 * ============================================================================
 * analyze-bundle.mjs — Bundle Size Analysis Script
 * ============================================================================
 *
 * Analyzes the Expo export output to identify large dependencies,
 * verify Turf.js tree-shaking, and ensure the bundle stays under budget.
 *
 * Usage:
 *   npx expo export --platform ios
 *   node scripts/analyze-bundle.mjs
 *
 * Or use the npm script:
 *   npm run bundle:stats
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, extname } from 'path';

// ─── Configuration ──────────────────────────────────────────────────────────

const DIST_DIR = './dist';
const BUNDLE_BUDGET_MB = 5;
const WARN_FILE_KB = 200;

// Known heavy dependencies to track
const TRACKED_DEPS = [
  '@turf',
  'three',
  'earcut',
  'zod',
  'zustand',
  'react-native-reanimated',
  'react-native-gesture-handler',
  '@react-three',
  'topojson',
  'react-native-mmkv',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function walkDir(dir) {
  const entries = [];
  try {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        entries.push(...(await walkDir(fullPath)));
      } else {
        const info = await stat(fullPath);
        entries.push({ path: fullPath, size: info.size });
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return entries;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📦 Bundle Analysis Report');
  console.log('═'.repeat(60));

  // 1. Scan dist directory
  const files = await walkDir(DIST_DIR);
  if (files.length === 0) {
    console.error(`\n❌ No files found in ${DIST_DIR}.`);
    console.error('   Run: npx expo export --platform ios\n');
    process.exit(1);
  }

  // 2. Categorize files
  const jsFiles = files.filter((f) => ['.js', '.hbc'].includes(extname(f.path)));
  const mapFiles = files.filter((f) => extname(f.path) === '.map');
  const assetFiles = files.filter(
    (f) => !['.js', '.hbc', '.map', '.html'].includes(extname(f.path)),
  );

  const totalJsSize = jsFiles.reduce((sum, f) => sum + f.size, 0);
  const totalAssetSize = assetFiles.reduce((sum, f) => sum + f.size, 0);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  // 3. Summary
  console.log(`\n📊 Size Summary:`);
  console.log(`   JavaScript:  ${formatBytes(totalJsSize)}`);
  console.log(`   Assets:      ${formatBytes(totalAssetSize)}`);
  console.log(`   Source Maps:  ${formatBytes(mapFiles.reduce((s, f) => s + f.size, 0))}`);
  console.log(`   Total:       ${formatBytes(totalSize)}`);

  // 4. Budget check
  const budgetBytes = BUNDLE_BUDGET_MB * 1024 * 1024;
  if (totalJsSize > budgetBytes) {
    console.log(`\n🔴 OVER BUDGET: JS bundle (${formatBytes(totalJsSize)}) exceeds ${BUNDLE_BUDGET_MB}MB limit!`);
  } else {
    const pct = ((totalJsSize / budgetBytes) * 100).toFixed(1);
    console.log(`\n🟢 UNDER BUDGET: JS bundle uses ${pct}% of ${BUNDLE_BUDGET_MB}MB limit.`);
  }

  // 5. Largest JS files
  const sortedJs = [...jsFiles].sort((a, b) => b.size - a.size);
  console.log(`\n📁 Largest JS Chunks (top 10):`);
  for (const f of sortedJs.slice(0, 10)) {
    const sizeKb = f.size / 1024;
    const indicator = sizeKb > WARN_FILE_KB ? '⚠️ ' : '   ';
    console.log(`${indicator}${formatBytes(f.size).padStart(10)}  ${f.path}`);
  }

  // 6. Check for Turf.js tree-shaking
  console.log(`\n🌿 Turf.js Tree-Shaking Check:`);
  for (const jsFile of jsFiles) {
    try {
      const content = await readFile(jsFile.path, 'utf-8');

      // Check if the monolithic @turf/turf is included (bad)
      if (content.includes('@turf/turf') || content.includes('turf/turf')) {
        console.log(`   ⚠️  WARN: Found @turf/turf monolith reference in ${jsFile.path}`);
        console.log(`          → Replace with individual @turf/* packages for tree-shaking.`);
      }

      // Check for individual turf modules (good)
      const turfModules = [
        'turf/union',
        'turf/centroid',
        'turf/bbox',
        'turf/area',
        'turf/buffer',
        'turf/difference',
        'turf/boolean-intersects',
        'turf/simplify',
      ];
      const found = turfModules.filter((m) => content.includes(m));
      if (found.length > 0) {
        console.log(`   ✅ Individual turf modules found: ${found.length}`);
        for (const m of found) {
          console.log(`      • ${m}`);
        }
      }
    } catch {
      // Can't read file
    }
  }

  // 7. Dependency size tracking
  console.log(`\n📦 Tracked Dependency Presence:`);
  for (const jsFile of jsFiles.slice(0, 3)) {
    try {
      const content = await readFile(jsFile.path, 'utf-8');
      for (const dep of TRACKED_DEPS) {
        if (content.includes(dep)) {
          console.log(`   ✓ ${dep} — present in bundle`);
        }
      }
    } catch {
      // Can't read file
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('💡 For detailed analysis, run:');
  console.log('   npm run bundle:analyze');
  console.log('   (generates an interactive HTML report via source-map-explorer)\n');
}

main().catch(console.error);
