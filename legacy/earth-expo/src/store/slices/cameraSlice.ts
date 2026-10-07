/**
 * ============================================================================
 * cameraSlice.ts — Camera State Actions
 * ============================================================================
 *
 * Manages the transient camera state used by CameraController.
 * Never persisted to MMKV.
 */

import type { StateCreator } from 'zustand';
import type { WorldStore, CameraState } from '../../types';
import { DEFAULT_CAMERA_DISTANCE } from '../../constants';

export interface CameraSlice {
  camera: CameraState;

  flyTo: (target: [number, number], distance: number) => void;
  setCameraImmediate: (patch: Partial<CameraState>) => void;
}

const DEFAULT_CAMERA: CameraState = {
  target: [0, 0],
  distance: DEFAULT_CAMERA_DISTANCE,
  isAnimating: false,
};

export const createCameraSlice: StateCreator<WorldStore, [], [], CameraSlice> = (
  set,
) => ({
  camera: { ...DEFAULT_CAMERA },

  flyTo: (target, distance) => {
    set({
      camera: {
        target,
        distance,
        isAnimating: true,
      },
    });
  },

  setCameraImmediate: (patch) => {
    set((state) => ({
      camera: { ...state.camera, ...patch },
    }));
  },
});
