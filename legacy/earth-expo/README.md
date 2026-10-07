# 🌍 My World — 3D Map Editor Sandbox

An interactive 3D globe app built with **Expo SDK 54**, **React Native 0.81**, and **React Three Fiber 9**. Paint countries, create custom regions, fuse & split territories, and save your worlds — all running offline with encrypted local storage.

## ✨ Highlights

- **Real-time 3D Globe** — Three.js sphere with 180+ selectable regions, custom shaders, and atmospheric glow
- **New Architecture** — Fabric renderer, TurboModules, Bridgeless mode (SDK 54 defaults)
- **Offline-first** — Encrypted MMKV persistence with keychain-derived keys (expo-secure-store)
- **Resilient** — Global Error Boundary, Zod-validated state, backup saves, salvage recovery
- **Fast** — `React.lazy` code-splitting, deferred TopoJSON parsing, tree-shaken Turf.js, single draw call for all regions

## 🚀 Quick Start

```bash
npm install
npx expo start
```

Press **i** for iOS Simulator, **a** for Android Emulator, or **w** for web.

## 📦 Key Scripts

| Script | What it does |
|---|---|
| `npm start` | Expo dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run bundle:stats` | Bundle size analysis + Turf tree-shake check |
| `npm run bundle:analyze` | Source-map-explorer HTML report |

## 🏗️ Architecture

See [docs/BLUEPRINT.md](docs/BLUEPRINT.md) for the full architecture guide — store schema, component hierarchy, geospatial pipeline, shaders, and performance checklist.

## 🛠️ Tech Stack

| Layer | Tech |
|---|---|
| Framework | Expo SDK 54, React 19.1, React Native 0.81 |
| 3D Engine | Three.js 0.170, @react-three/fiber 9, @react-three/drei 10 |
| State | Zustand 5 (sliced store + MMKV persist middleware) |
| Geospatial | @turf/* (tree-shaken), earcut, topojson-client |
| Navigation | expo-router 6 (file-based, typed routes) |
| Storage | react-native-mmkv + expo-secure-store |
| Animation | react-native-reanimated 4, custom spring physics |