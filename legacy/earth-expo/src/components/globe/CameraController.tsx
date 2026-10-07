/**
 * ============================================================================
 * CameraController.tsx — Spring-Based OrbitControls Wrapper
 * ============================================================================
 *
 * Manages camera transitions using the spring physics system from
 * `utils/math/camera.ts`. Wraps drei's OrbitControls to support:
 *
 *   1. Smooth fly-to animations on region/country tap.
 *   2. Input gating during animation (no user gestures while flying).
 *   3. Mid-flight retargeting (new taps redirect the spring).
 *   4. Frame-rate-independent spring stepping.
 *
 * This component lives inside the R3F <Canvas> and uses `useFrame` for
 * per-frame spring updates. It reads camera state from the store and
 * drives the Three.js camera + OrbitControls programmatically.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import {
  SpringValue,
  SPRING_PRESETS,
  geoToSpherical,
  sphericalToCartesian,
  normalizeLonDelta,
  computeZoomDistance,
} from '../../utils/math/camera';
import type { CameraState, RegionGeometry, RegionId } from '../../types';
import {
  GLOBE_RADIUS,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_CAMERA_DISTANCE,
  MAX_SPRING_DELTA,
} from '../../constants';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CameraControllerProps {
  /** Current camera state from the store. */
  cameraState: CameraState;

  /** Callback to update camera state in the store. */
  onAnimationEnd?: () => void;

  /** Whether user gestures (orbit/zoom) are enabled. */
  enableUserControl?: boolean;

  /**
   * Min/max polar angle in radians. Prevents the camera from flipping
   * over the poles.
   */
  minPolarAngle?: number;
  maxPolarAngle?: number;

  /** Min/max zoom distance. */
  minDistance?: number;
  maxDistance?: number;

  /** Enable/disable damping on manual orbit gestures. */
  enableDamping?: boolean;
  dampingFactor?: number;

  /** Auto-rotation speed in radians/sec. 0 = disabled. */
  autoRotateSpeed?: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const CameraController: React.FC<CameraControllerProps> = React.memo(
  function CameraController({
    cameraState,
    onAnimationEnd,
    enableUserControl = true,
    minPolarAngle = Math.PI * 0.05,
    maxPolarAngle = Math.PI * 0.95,
    minDistance = MIN_ZOOM,
    maxDistance = MAX_ZOOM,
    enableDamping = true,
    dampingFactor = 0.08,
    autoRotateSpeed = 0,
  }) {
    const { camera, gl } = useThree();
    const controlsRef = useRef<any>(null);

    // ── Spring instances (persist across renders) ───────────────────────

    const azimuthSpring = useRef(
      new SpringValue(0, SPRING_PRESETS.regionTap),
    ).current;
    const polarSpring = useRef(
      new SpringValue(Math.PI / 2, SPRING_PRESETS.regionTap),
    ).current;
    const distanceSpring = useRef(
      new SpringValue(DEFAULT_CAMERA_DISTANCE, SPRING_PRESETS.regionTap),
    ).current;

    const isAnimatingRef = useRef(false);
    const autoRotateRef = useRef(autoRotateSpeed);

    useEffect(() => {
      autoRotateRef.current = autoRotateSpeed;
    }, [autoRotateSpeed]);

    // ── React to camera state changes (fly-to triggers) ─────────────────

    useEffect(() => {
      if (!cameraState.isAnimating) return;

      const [targetLon, targetLat] = cameraState.target;
      const [targetAzimuth, targetPolar] = geoToSpherical(targetLon, targetLat);

      // Shortest-arc normalization for longitude
      const currentAzimuth = azimuthSpring.value;
      const delta = normalizeLonDelta(
        ((targetAzimuth - currentAzimuth) * 180) / Math.PI,
      );
      const normalizedTarget = currentAzimuth + (delta * Math.PI) / 180;

      azimuthSpring.setTarget(normalizedTarget);
      polarSpring.setTarget(targetPolar);
      distanceSpring.setTarget(cameraState.distance);

      isAnimatingRef.current = true;

      // Disable user controls during animation
      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }
    }, [cameraState.isAnimating, cameraState.target, cameraState.distance]);

    // ── Per-frame spring stepping ───────────────────────────────────────

    useFrame((_, rawDelta) => {
      const dt = Math.min(rawDelta, MAX_SPRING_DELTA);

      // Auto-rotation when idle
      if (!isAnimatingRef.current && autoRotateRef.current > 0) {
        azimuthSpring.snap(azimuthSpring.value + autoRotateRef.current * dt);
      }

      if (isAnimatingRef.current) {
        // Step all three springs
        azimuthSpring.step(dt);
        polarSpring.step(dt);
        distanceSpring.step(dt);

        // Convert spherical → Cartesian
        const [x, y, z] = sphericalToCartesian(
          azimuthSpring.value,
          polarSpring.value,
          distanceSpring.value,
        );

        camera.position.set(x, y, z);
        camera.lookAt(0, 0, 0);

        // Sync OrbitControls target
        if (controlsRef.current) {
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.update();
        }

        // Check convergence
        if (
          azimuthSpring.isSettled() &&
          polarSpring.isSettled() &&
          distanceSpring.isSettled()
        ) {
          isAnimatingRef.current = false;
          // Re-enable user controls
          if (controlsRef.current) {
            controlsRef.current.enabled = true;
          }
          onAnimationEnd?.();
        }
      }
    });

    // ── Set initial camera position ─────────────────────────────────────

    useEffect(() => {
      const [x, y, z] = sphericalToCartesian(
        azimuthSpring.value,
        polarSpring.value,
        distanceSpring.value,
      );
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── OrbitControls ────────────────────────────────────────────────────

    return (
      <OrbitControls
        ref={controlsRef}
        args={[camera, gl.domElement]}
        enabled={enableUserControl && !isAnimatingRef.current}
        enableDamping={enableDamping}
        dampingFactor={dampingFactor}
        minPolarAngle={minPolarAngle}
        maxPolarAngle={maxPolarAngle}
        minDistance={minDistance}
        maxDistance={maxDistance}
        target={[0, 0, 0]}
        enablePan={false}
        rotateSpeed={0.5}
        zoomSpeed={0.8}
      />
    );
  },
);
