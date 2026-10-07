"use client";

import { useEffect, useState } from "react";
import * as turf from "@turf/turf";
import { getDb } from "@/database/db";

interface SidebarProps {
  feature: any | null;
}

export default function Sidebar({ feature }: SidebarProps) {
  const [data, setData] = useState<any>(null);
  const [db, setDb] = useState<any>(null);

  useEffect(() => {
    getDb()?.then(setDb);
  }, []);

  useEffect(() => {
    if (!feature || !db) return;

    const id = feature.id as string;
    const name = feature.properties?.ADMIN || "Unknown Territory";
    const area_km2 = Math.round(turf.area(feature) / 1000000);
    
    // Default values if not in DB
    const defaultDensity = 50; // 50 people per km2 default
    
    // Subscribe to changes in RxDB for this territory
    const sub = db.territories.findOne(id).$.subscribe((doc: any) => {
      if (!doc) {
        // Create initial record
        db.territories.insert({
          id,
          name,
          area_km2,
          density: defaultDensity,
          population: area_km2 * defaultDensity,
          color: "#4287f5",
          flag_url: ""
        }).catch(console.error);
      } else {
        // If area changed (due to merge/cut), we update it and recalculate population
        if (doc.area_km2 !== area_km2) {
          doc.incrementalPatch({
            area_km2,
            population: area_km2 * doc.density
          });
        }
        setData(doc.toJSON());
      }
    });

    return () => sub.unsubscribe();
  }, [feature, db]);

  if (!feature || !data) return null;

  return (
    <div style={{
      position: 'absolute',
      top: 24,
      right: 24,
      background: 'rgba(20, 20, 25, 0.85)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      padding: '24px',
      borderRadius: '16px',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      color: '#fff',
      zIndex: 10,
      width: '340px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    }}>
      <div>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: 700 }}>{data.name}</h2>
        <span style={{ fontSize: '12px', color: '#4287f5', fontWeight: 600, background: 'rgba(66, 135, 245, 0.15)', padding: '4px 8px', borderRadius: '4px' }}>
          Entity ID: {data.id}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
          <span style={{ color: '#aaa', fontSize: '14px' }}>Area</span>
          <span style={{ fontWeight: 500 }}>{data.area_km2.toLocaleString()} km²</span>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
          <span style={{ color: '#aaa', fontSize: '14px' }}>Population</span>
          <span style={{ fontWeight: 500, color: '#4287f5' }}>{data.population.toLocaleString()}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label style={{ fontSize: '12px', color: '#aaa' }}>Density (people / km²)</label>
        <input 
          type="range" 
          min="1" 
          max="1000" 
          value={data.density}
          onChange={async (e) => {
            const newDensity = Number(e.target.value);
            const doc = await db.territories.findOne(data.id).exec();
            if (doc) {
              await doc.incrementalPatch({
                density: newDensity,
                population: data.area_km2 * newDensity
              });
            }
          }}
          style={{ width: '100%', accentColor: '#4287f5' }}
        />
        <div style={{ textAlign: 'right', fontSize: '12px', color: '#fff' }}>{data.density} / km²</div>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label style={{ fontSize: '12px', color: '#aaa' }}>Territory Name</label>
        <input 
          type="text" 
          value={data.name}
          onChange={async (e) => {
            const doc = await db.territories.findOne(data.id).exec();
            if (doc) await doc.incrementalPatch({ name: e.target.value });
          }}
          style={{ 
            background: 'rgba(0,0,0,0.3)', 
            border: '1px solid rgba(255,255,255,0.2)', 
            color: '#fff', 
            padding: '8px 12px', 
            borderRadius: '8px',
            outline: 'none'
          }}
        />
      </div>
    </div>
  );
}
