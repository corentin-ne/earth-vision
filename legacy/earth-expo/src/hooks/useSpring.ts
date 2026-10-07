/**
 * ============================================================================
 * useSpring.ts — Reusable Spring Animation Hook
 * ============================================================================
 *
 * Wraps the custom SpringValue class in a React hook for use in any
 * component that needs spring-physics animations (camera, UI, etc.).
 */

import { useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { SpringValue, type SpringConfig, SPRING_PRESETS } from '../utils/math/camera';

export interface UseSpringOptions {
  /** Initial value. */
  from: number;
  /** Spring config or preset name. */
  config?: SpringConfig | keyof typeof SPRING_PRESETS;
  /** Called every frame with the current spring value. */
  onChange?: (value: number) => void;
  /** Called once when the spring settles. */
  onSettled?: (value: number) => void;
}

/**
 * Hook providing a SpringValue driven by R3F's useFrame loop.
 *
 * @returns Object with `value`, `setTarget`, `snap`, and `isSettled`.
 */
export function useSpring(options: UseSpringOptions) {
  const { from, config, onChange, onSettled } = options;

  const springConfig: SpringConfig =
    typeof config === 'string'
      ? SPRING_PRESETS[config]
      : config ?? SPRING_PRESETS.regionTap;

  const springRef = useRef<SpringValue>(
    new SpringValue(from, springConfig),
  );

  const settledRef = useRef(true);

  useFrame((_, delta) => {
    const spring = springRef.current;
    if (spring.isSettled()) {
      if (!settledRef.current) {
        settledRef.current = true;
        onSettled?.(spring.value);
      }
      return;
    }

    settledRef.current = false;
    spring.step(delta);
    onChange?.(spring.value);
  });

  const setTarget = useCallback((target: number) => {
    springRef.current.setTarget(target);
    settledRef.current = false;
  }, []);

  const snap = useCallback((value: number) => {
    springRef.current.snap(value);
    settledRef.current = true;
  }, []);

  return {
    get value() {
      return springRef.current.value;
    },
    setTarget,
    snap,
    get isSettled() {
      return springRef.current.isSettled();
    },
  };
}
