/**
 * ============================================================================
 * _layout.tsx — Root Layout (Expo Router)
 * ============================================================================
 *
 * Provides the global provider tree:
 *   • Global Error Boundary (catches WebGL, Turf.js, and store errors)
 *   • Font loading (via expo-font)
 *   • Splash screen management
 *   • Safe-area context
 *   • Store rehydration
 *   • GestureHandlerRootView for @gorhom/bottom-sheet
 *
 * SDK 54 / New Architecture Notes:
 *   - Error Boundary wraps the entire tree to catch R3F/WebGL crashes.
 *   - Suspense at root level handles lazy-loaded Globe chunk.
 *   - usePersistence initializes encrypted MMKV before rendering.
 */

import React, { useEffect, useCallback } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Slot, SplashScreen } from 'expo-router';
import { usePersistence } from '../hooks/usePersistence';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { useWorldStore } from '../store/useWorldStore';

// Prevent the splash screen from auto-hiding until we're ready
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { isReady } = usePersistence();
  const resetWorld = useWorldStore((s) => s.resetWorld);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync();
    }
  }, [isReady]);

  /** Error Boundary reset: wipe corrupted state and restart clean. */
  const handleErrorReset = useCallback(() => {
    try {
      resetWorld();
    } catch {
      // If even reset fails, the Error Boundary retry will
      // remount with a fresh default store anyway.
    }
  }, [resetWorld]);

  if (!isReady) {
    return <LoadingScreen message="Initializing storage…" />;
  }

  return (
    <ErrorBoundary onReset={handleErrorReset}>
      <GestureHandlerRootView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <React.Suspense fallback={<LoadingScreen message="Loading world…" />}>
          <Slot />
        </React.Suspense>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});
