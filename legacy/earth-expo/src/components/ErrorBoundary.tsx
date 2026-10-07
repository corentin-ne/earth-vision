/**
 * ============================================================================
 * ErrorBoundary.tsx — Global Error Boundary (Production-Grade)
 * ============================================================================
 *
 * Catches unhandled errors in the React tree, including:
 *   • WebGL context loss (expo-gl / Three.js crashes)
 *   • Turf.js geospatial math failures (degenerate polygons, NaN coords)
 *   • Store corruption / hydration failures
 *   • Unexpected runtime exceptions in R3F components
 *
 * Recovery strategies:
 *   1. Display a user-friendly error screen with retry option.
 *   2. Classify errors (WebGL vs geo vs unknown) for targeted recovery.
 *   3. Offer "Reset World" as a nuclear option for unrecoverable state.
 *
 * Architecture:
 *   - Class component (Error Boundaries require getDerivedStateFromError).
 *   - Zero dependency on R3F or Three.js — safe to wrap the entire tree.
 *   - Children are unmounted on error and remounted on retry, providing
 *     a clean slate for WebGL context re-creation.
 */

import React, { type ReactNode } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';

// ─── Error Classification ───────────────────────────────────────────────────

type ErrorCategory = 'webgl' | 'geospatial' | 'storage' | 'unknown';

interface ErrorInfo {
  category: ErrorCategory;
  title: string;
  message: string;
  canRetry: boolean;
}

/**
 * Classify a caught error into a category for targeted recovery messaging.
 */
function classifyError(error: Error): ErrorInfo {
  const msg = error.message?.toLowerCase() ?? '';
  const name = error.name?.toLowerCase() ?? '';

  // WebGL / GPU context loss
  if (
    msg.includes('context lost') ||
    msg.includes('webgl') ||
    msg.includes('gl_') ||
    msg.includes('expo-gl') ||
    msg.includes('renderer') ||
    name.includes('webgl')
  ) {
    return {
      category: 'webgl',
      title: 'Graphics Error',
      message:
        'The 3D rendering engine encountered an error. This usually resolves by reloading the globe.',
      canRetry: true,
    };
  }

  // Turf.js / geospatial math failures
  if (
    msg.includes('turf') ||
    msg.includes('polygon') ||
    msg.includes('coordinates') ||
    msg.includes('topology') ||
    msg.includes('nan') ||
    msg.includes('intersection') ||
    msg.includes('geojson') ||
    msg.includes('earcut')
  ) {
    return {
      category: 'geospatial',
      title: 'Geospatial Error',
      message:
        'A map calculation failed due to invalid geometry. The operation has been cancelled safely.',
      canRetry: true,
    };
  }

  // MMKV / storage / hydration failures
  if (
    msg.includes('mmkv') ||
    msg.includes('storage') ||
    msg.includes('persist') ||
    msg.includes('hydrat') ||
    msg.includes('serialize') ||
    msg.includes('json')
  ) {
    return {
      category: 'storage',
      title: 'Storage Error',
      message:
        'Your saved world data could not be loaded. You can retry or reset to start fresh.',
      canRetry: true,
    };
  }

  return {
    category: 'unknown',
    title: 'Unexpected Error',
    message:
      'Something went wrong. You can try reloading, or reset your world if the problem persists.',
    canRetry: true,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional callback when a world reset is triggered. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: ErrorInfo | null;
  rawError: Error | null;
  /** Monotonic key to force remount of children on retry. */
  retryKey: number;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorInfo: null,
      rawError: null,
      retryKey: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorInfo: classifyError(error),
      rawError: error,
    };
  }

  componentDidCatch(error: Error, reactErrorInfo: React.ErrorInfo) {
    // In production, this would send to a crash reporting service.
    // Console statements are stripped in production by babel plugin.
    if (__DEV__) {
      console.error('[ErrorBoundary] Caught:', error);
      console.error('[ErrorBoundary] Component stack:', reactErrorInfo.componentStack);
    }
  }

  /** Retry: increment key to force full remount of children. */
  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      errorInfo: null,
      rawError: null,
      retryKey: prev.retryKey + 1,
    }));
  };

  /** Nuclear option: reset all world state and retry. */
  handleReset = () => {
    this.props.onReset?.();
    this.handleRetry();
  };

  render() {
    if (this.state.hasError && this.state.errorInfo) {
      return <ErrorFallback
        info={this.state.errorInfo}
        rawError={this.state.rawError}
        onRetry={this.handleRetry}
        onReset={this.handleReset}
      />;
    }

    // Key change forces complete unmount/remount — fresh WebGL context
    return (
      <React.Fragment key={this.state.retryKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

// ─── Fallback UI ────────────────────────────────────────────────────────────

interface ErrorFallbackProps {
  info: ErrorInfo;
  rawError: Error | null;
  onRetry: () => void;
  onReset: () => void;
}

function ErrorFallback({ info, rawError, onRetry, onReset }: ErrorFallbackProps) {
  const iconMap: Record<ErrorCategory, string> = {
    webgl: '🖥️',
    geospatial: '🗺️',
    storage: '💾',
    unknown: '⚠️',
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {/* Icon */}
        <Text style={styles.icon}>{iconMap[info.category]}</Text>

        {/* Title */}
        <Text style={styles.title}>{info.title}</Text>

        {/* Message */}
        <Text style={styles.message}>{info.message}</Text>

        {/* Retry Button */}
        {info.canRetry && (
          <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        )}

        {/* Reset Button (last resort) */}
        <TouchableOpacity style={styles.resetButton} onPress={onReset}>
          <Text style={styles.resetText}>Reset World</Text>
        </TouchableOpacity>

        {/* Dev-only error details */}
        {__DEV__ && rawError && (
          <ScrollView style={styles.debugScroll}>
            <Text style={styles.debugText}>
              {rawError.name}: {rawError.message}
              {'\n\n'}
              {rawError.stack?.slice(0, 500)}
            </Text>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1117',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#161B22',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#E6EDF3',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#8B949E',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  retryButton: {
    backgroundColor: '#238636',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  resetButton: {
    backgroundColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DA3633',
    width: '100%',
    alignItems: 'center',
  },
  resetText: {
    color: '#DA3633',
    fontSize: 14,
    fontWeight: '500',
  },
  debugScroll: {
    marginTop: 20,
    maxHeight: 120,
    width: '100%',
    backgroundColor: '#0D1117',
    borderRadius: 8,
    padding: 12,
  },
  debugText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#F97583',
    lineHeight: 16,
  },
});

// ─── Environment Polyfill ───────────────────────────────────────────────────

declare const __DEV__: boolean;
