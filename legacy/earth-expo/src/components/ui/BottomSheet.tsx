/**
 * ============================================================================
 * BottomSheet.tsx — Reanimated Info / Editor Panel
 * ============================================================================
 *
 * A premium slide-up bottom sheet powered by @gorhom/bottom-sheet and
 * react-native-reanimated. Displays region & country details with
 * action buttons (Edit, Conquer, Fuse) and buttery-smooth animations.
 *
 * Architecture:
 * - Reads interaction state from Zustand to decide when to open/close.
 * - Strictly typed props for the selected entity data.
 * - Haptic feedback on open/close for tactile "game feel".
 * - GestureHandlerRootView expected to wrap the app (provided by expo-router).
 */

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import GorhomBottomSheet, {
  BottomSheetScrollView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useWorldStore, getCountryForRegion } from '../../store/useWorldStore';
import { showToast } from '../hud/ToastNotification';
import type { Country, RegionMeta, RegionId, CountryId } from '../../types';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Strictly typed data passed into the sheet's content renderer. */
export interface BottomSheetRegionData {
  /** The selected region's metadata. */
  region: RegionMeta;
  /** The owning country, or null if unowned. */
  country: Country | null;
}

/** Action button descriptors. */
interface ActionButton {
  id: string;
  label: string;
  icon: string;
  color: string;
  onPress: () => void;
}

// ─── Haptics (soft import — gracefully degrades) ────────────────────────────

let triggerHaptic: () => void = () => {};

try {
  // expo-haptics is optional; degrade silently on web
  const Haptics = require('expo-haptics');
  triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };
} catch {
  // expo-haptics not installed — no-op
}

// ─── Snap Points ────────────────────────────────────────────────────────────

const SNAP_POINTS = ['32%', '60%'];

// ─── Component ──────────────────────────────────────────────────────────────

export function BottomSheet() {
  const sheetRef = useRef<GorhomBottomSheet>(null);
  const animatedIndex = useSharedValue(-1);

  // ── Store subscriptions ──────────────────────────────────────────────

  const isOpen = useWorldStore((s) => s.interaction.isBottomSheetOpen);
  const toggle = useWorldStore((s) => s.toggleBottomSheet);
  const selectedRegionId = useWorldStore((s) => s.interaction.selectedRegionId);
  const selectedCountryId = useWorldStore((s) => s.interaction.selectedCountryId);
  const regions = useWorldStore((s) => s.regions);
  const countries = useWorldStore((s) => s.countries);
  const selectRegion = useWorldStore((s) => s.selectRegion);
  const selectCountry = useWorldStore((s) => s.selectCountry);
  const createCountry = useWorldStore((s) => s.createCountry);
  const assignRegion = useWorldStore((s) => s.assignRegion);
  const fuseCountries = useWorldStore((s) => s.fuseCountries);
  const deleteCountry = useWorldStore((s) => s.deleteCountry);

  // ── Resolve selected data ───────────────────────────────────────────

  const region: RegionMeta | null = selectedRegionId
    ? regions[selectedRegionId] ?? null
    : null;

  const country: Country | null = selectedCountryId
    ? countries[selectedCountryId] ?? null
    : selectedRegionId
      ? getCountryForRegion(useWorldStore.getState(), selectedRegionId)
      : null;

  // ── Open / close the sheet ──────────────────────────────────────────

  useEffect(() => {
    if (isOpen && region) {
      sheetRef.current?.snapToIndex(0);
      triggerHaptic();
    } else {
      sheetRef.current?.close();
    }
  }, [isOpen, region]);

  const handleSheetChange = useCallback(
    (index: number) => {
      animatedIndex.value = index;
      if (index === -1) {
        // Sheet was fully closed by user gesture
        toggle(false);
        selectRegion(null);
        selectCountry(null);
      }
    },
    [toggle, selectRegion, selectCountry, animatedIndex],
  );

  // ── Action handlers ──────────────────────────────────────────────────

  const handleConquer = useCallback(() => {
    if (!selectedRegionId) return;

    // If no country owns this region, create a new one and assign
    if (!country) {
      const regionName = region?.label ?? selectedRegionId;
      const newId = createCountry(regionName, '#4A90D9');
      assignRegion(selectedRegionId, newId);
      showToast(`Conquered ${regionName}!`, 'success');
      triggerHaptic();
    } else {
      showToast(`${region?.label ?? selectedRegionId} already belongs to ${country.name}`, 'info');
    }
  }, [selectedRegionId, country, region, createCountry, assignRegion]);

  const handleEdit = useCallback(() => {
    showToast('Edit mode — coming soon!', 'info');
    triggerHaptic();
  }, []);

  const handleFuse = useCallback(() => {
    if (!country) {
      showToast('Select a country-owned region first', 'error');
      return;
    }
    showToast('Fuse mode — tap another country to merge', 'info');
    triggerHaptic();
  }, [country]);

  // ── Action buttons config ─────────────────────────────────────────────

  const actions: ActionButton[] = useMemo(
    () => [
      {
        id: 'edit',
        label: 'Edit',
        icon: '✏️',
        color: '#4FC3F7',
        onPress: handleEdit,
      },
      {
        id: 'conquer',
        label: country ? 'Reconquer' : 'Conquer',
        icon: '⚔️',
        color: '#66BB6A',
        onPress: handleConquer,
      },
      {
        id: 'fuse',
        label: 'Fuse',
        icon: '🔗',
        color: '#FFA726',
        onPress: handleFuse,
      },
    ],
    [country, handleEdit, handleConquer, handleFuse],
  );

  // ── Backdrop ───────────────────────────────────────────────────────────

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.4}
        pressBehavior="close"
      />
    ),
    [],
  );

  // ── Animated content styles ────────────────────────────────────────────

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      animatedIndex.value,
      [-1, 0],
      [0, 1],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        translateY: interpolate(
          animatedIndex.value,
          [-1, 0],
          [20, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <GorhomBottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={SNAP_POINTS}
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      animateOnMount={false}
      style={styles.shadow}
    >
      <BottomSheetScrollView
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={headerAnimatedStyle}>
          {region ? (
            <>
              {/* ── Header: Region name + country badge ────────────── */}
              <View style={styles.header}>
                <Text style={styles.title}>
                  {region.label ?? region.id}
                </Text>
                {country && (
                  <View style={styles.countryBadge}>
                    {country.flag && (
                      <Text style={styles.flag}>{country.flag}</Text>
                    )}
                    <View
                      style={[
                        styles.colorDot,
                        { backgroundColor: country.color },
                      ]}
                    />
                    <Text style={styles.countryName}>{country.name}</Text>
                  </View>
                )}
                {!country && (
                  <View style={styles.unownedBadge}>
                    <Text style={styles.unownedText}>Unowned Territory</Text>
                  </View>
                )}
              </View>

              {/* ── Separator ────────────────────────────────────── */}
              <View style={styles.separator} />

              {/* ── Stats row ─────────────────────────────────────── */}
              <View style={styles.statsRow}>
                <StatPill
                  label="Elevation"
                  value={`${region.elevation.toFixed(2)}×`}
                />
                {country && (
                  <StatPill
                    label="Regions"
                    value={String(country.regionIds.length)}
                  />
                )}
                {Object.keys(region.customData).length > 0 && (
                  <StatPill
                    label="Data"
                    value={`${Object.keys(region.customData).length} fields`}
                  />
                )}
              </View>

              {/* ── Custom data ────────────────────────────────────── */}
              {Object.entries(region.customData).map(([key, value]) => (
                <View key={key} style={styles.dataRow}>
                  <Text style={styles.dataKey}>{key}</Text>
                  <Text style={styles.dataValue}>{value}</Text>
                </View>
              ))}

              {/* ── Action buttons ─────────────────────────────────── */}
              <View style={styles.actionsRow}>
                {actions.map((action) => (
                  <TouchableOpacity
                    key={action.id}
                    style={[
                      styles.actionButton,
                      { borderColor: action.color },
                    ]}
                    onPress={action.onPress}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.actionIcon}>{action.icon}</Text>
                    <Text
                      style={[styles.actionLabel, { color: action.color }]}
                    >
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.empty}>Tap a region to inspect it</Text>
          )}
        </Animated.View>
      </BottomSheetScrollView>
    </GorhomBottomSheet>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 24,
  },
  background: {
    backgroundColor: 'rgba(13, 13, 30, 0.97)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#546E7A',
  },
  contentInner: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  header: {
    marginTop: 4,
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ECEFF1',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  countryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  flag: {
    fontSize: 18,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  countryName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#CFD8DC',
  },
  unownedBadge: {
    backgroundColor: 'rgba(176, 190, 197, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  unownedText: {
    fontSize: 13,
    color: '#78909C',
    fontWeight: '500',
  },
  separator: {
    height: 1,
    backgroundColor: '#1E293B',
    marginVertical: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statPill: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ECEFF1',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: '#78909C',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E293B',
  },
  dataKey: {
    fontSize: 14,
    color: '#90A4AE',
    fontWeight: '500',
  },
  dataValue: {
    fontSize: 14,
    color: '#CFD8DC',
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  actionIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  empty: {
    fontSize: 16,
    color: '#546E7A',
    textAlign: 'center',
    marginTop: 40,
  },
});
