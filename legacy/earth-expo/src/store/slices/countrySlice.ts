/**
 * ============================================================================
 * countrySlice.ts — Country CRUD Actions
 * ============================================================================
 *
 * Manages the user-created Country entities and their relationships
 * to regions via `regionIds`.
 */

import { v4 as uuidv4 } from 'uuid';
import type { StateCreator } from 'zustand';
import type { WorldStore, CountryId, RegionId, Country } from '../../types';
import { countryId } from '../../types';

export interface CountrySlice {
  countries: Record<CountryId, Country>;

  createCountry: (name: string, color: string) => CountryId;
  updateCountry: (id: CountryId, patch: Partial<Omit<Country, 'id' | 'createdAt'>>) => void;
  deleteCountry: (id: CountryId) => void;
  assignRegion: (regionId: RegionId, countryId: CountryId) => void;
  unassignRegion: (regionId: RegionId) => void;
  fuseCountries: (sourceId: CountryId, targetId: CountryId) => void;
}

export const createCountrySlice: StateCreator<WorldStore, [], [], CountrySlice> = (
  set,
  get,
) => ({
  countries: {} as Record<CountryId, Country>,

  createCountry: (name, color) => {
    const id = countryId(uuidv4());
    const now = new Date().toISOString();

    const country: Country = {
      id,
      name,
      color,
      flag: null,
      regionIds: [],
      capitalRegionId: null,
      customData: {},
      createdAt: now,
      updatedAt: now,
    };

    set({
      countries: { ...get().countries, [id]: country },
    });

    return id;
  },

  updateCountry: (id, patch) => {
    const current = get().countries[id];
    if (!current) return;

    set({
      countries: {
        ...get().countries,
        [id]: {
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  },

  deleteCountry: (id) => {
    const { [id]: deleted, ...rest } = get().countries;
    set({ countries: rest });
  },

  assignRegion: (regionId, targetCountryId) => {
    const countries = { ...get().countries };

    // Remove from any current owner
    for (const country of Object.values(countries)) {
      const idx = country.regionIds.indexOf(regionId);
      if (idx !== -1) {
        countries[country.id] = {
          ...country,
          regionIds: country.regionIds.filter((r) => r !== regionId),
          updatedAt: new Date().toISOString(),
        };
      }
    }

    // Add to target country
    const target = countries[targetCountryId];
    if (target && !target.regionIds.includes(regionId)) {
      countries[targetCountryId] = {
        ...target,
        regionIds: [...target.regionIds, regionId],
        updatedAt: new Date().toISOString(),
      };
    }

    set({ countries });
  },

  unassignRegion: (regionId) => {
    const countries = { ...get().countries };

    for (const country of Object.values(countries)) {
      const idx = country.regionIds.indexOf(regionId);
      if (idx !== -1) {
        countries[country.id] = {
          ...country,
          regionIds: country.regionIds.filter((r) => r !== regionId),
          capitalRegionId:
            country.capitalRegionId === regionId ? null : country.capitalRegionId,
          updatedAt: new Date().toISOString(),
        };
        break; // A region can only belong to one country
      }
    }

    set({ countries });
  },

  fuseCountries: (sourceId, targetId) => {
    const source = get().countries[sourceId];
    const target = get().countries[targetId];
    if (!source || !target) return;

    const mergedRegionIds = [
      ...target.regionIds,
      ...source.regionIds.filter((r) => !target.regionIds.includes(r)),
    ];

    const countries = { ...get().countries };
    countries[targetId] = {
      ...target,
      regionIds: mergedRegionIds,
      updatedAt: new Date().toISOString(),
    };
    delete countries[sourceId];

    set({ countries });
  },
});
