/**
 * ============================================================================
 * app.config.ts — Expo SDK 54 Configuration (New Architecture)
 * ============================================================================
 *
 * Migrated from app.json → app.config.ts for programmatic control.
 * Explicitly enables React Native New Architecture:
 *   • Fabric (new rendering system)
 *   • TurboModules (native module interop)
 *   • Bridgeless mode (no legacy bridge)
 *
 * Key SDK 54 changes:
 *   - `newArchEnabled: true` is now default but made explicit.
 *   - `jsEngine: "hermes"` is the only supported engine.
 *   - `expo-router` v6 with typed routes support.
 */

import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,

  name: 'My World',
  slug: 'my-world',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/textures/icon.png',
  scheme: 'myworld',
  userInterfaceStyle: 'dark',

  // ── New Architecture ──────────────────────────────────────────────────
  newArchEnabled: true,

  // ── Splash Screen ─────────────────────────────────────────────────────
  splash: {
    backgroundColor: '#1A237E',
    resizeMode: 'contain',
  },

  // ── iOS ───────────────────────────────────────────────────────────────
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.myworld.app',
  },

  // ── Android ───────────────────────────────────────────────────────────
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/textures/adaptive-icon.png',
      backgroundColor: '#1A237E',
    },
    package: 'com.myworld.app',
  },

  // ── Web ───────────────────────────────────────────────────────────────
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/textures/favicon.png',
  },

  // ── Plugins ───────────────────────────────────────────────────────────
  plugins: [
    'expo-router',
    'expo-font',
    'expo-dev-client',
  ],

  // ── Experiments ───────────────────────────────────────────────────────
  experiments: {
    typedRoutes: true,
  },

  // ── Extra ─────────────────────────────────────────────────────────────
  extra: {
    /**
     * Storage encryption key identifier. In production, replace with
     * a key derived from expo-secure-store or platform keychain.
     */
    storageEncryptionKeyId: 'my-world-v1',
  },
});
