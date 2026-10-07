import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';

// Add plugins
addRxPlugin(RxDBUpdatePlugin);

const territorySchema = {
  title: 'territory schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: {
      type: 'string',
      maxLength: 100
    },
    name: {
      type: 'string'
    },
    population: {
      type: 'number'
    },
    density: {
      type: 'number' // people per km2
    },
    area_km2: {
      type: 'number'
    },
    color: {
      type: 'string'
    },
    flag_url: {
      type: 'string'
    }
  },
  required: ['id', 'name', 'area_km2', 'density', 'population']
};

let dbPromise: Promise<any> | null = null;

export const getDb = () => {
  if (typeof window === 'undefined') return null; // Avoid SSR errors
  
  if (!dbPromise) {
    dbPromise = createRxDatabase({
      name: 'cmaps_world_db',
      storage: getRxStorageDexie()
    }).then(async (db) => {
      await db.addCollections({
        territories: {
          schema: territorySchema
        }
      });
      return db;
    });
  }
  return dbPromise;
};
