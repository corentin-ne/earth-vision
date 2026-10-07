/**
 * ============================================================================
 * ToastNotification.tsx — Ephemeral Toast Messages
 * ============================================================================
 *
 * A simple toast notification system. Displays brief messages at the
 * bottom of the screen that auto-dismiss after a timeout.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';

// ─── Toast Event Bus ────────────────────────────────────────────────────────

type ToastListener = (message: string, variant?: ToastVariant) => void;
type ToastVariant = 'info' | 'success' | 'error';

const listeners = new Set<ToastListener>();

/**
 * Show a toast notification from anywhere in the app.
 *
 * @example
 * showToast('Country created!', 'success');
 */
export function showToast(message: string, variant: ToastVariant = 'info') {
  listeners.forEach((fn) => fn(message, variant));
}

// ─── Component ──────────────────────────────────────────────────────────────

const DURATION_MS = 2500;

const VARIANT_COLORS: Record<ToastVariant, string> = {
  info: '#4FC3F7',
  success: '#66BB6A',
  error: '#E53935',
};

export function ToastNotification() {
  const [toast, setToast] = useState<{
    message: string;
    variant: ToastVariant;
  } | null>(null);

  const opacity = useRef(new Animated.Value(0)).current;
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      // Cancel any existing timeout
      if (timeout.current) clearTimeout(timeout.current);

      setToast({ message, variant });

      // Animate in
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      // Schedule dismiss
      timeout.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setToast(null);
        });
      }, DURATION_MS);
    },
    [opacity],
  );

  useEffect(() => {
    listeners.add(show);
    return () => {
      listeners.delete(show);
    };
  }, [show]);

  if (!toast) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { opacity },
        { borderLeftColor: VARIANT_COLORS[toast.variant] },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.text}>{toast.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(13, 13, 30, 0.92)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#4FC3F7',
    maxWidth: '80%',
  },
  text: {
    fontSize: 14,
    color: '#ECEFF1',
    fontWeight: '500',
  },
});
