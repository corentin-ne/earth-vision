"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as turf from "@turf/turf";

interface MapProps {
  mode: "pointer" | "paint" | "surgeon";
  onSelectTerritory?: (feature: any) => void;
}

export default function Map({ mode, onSelectTerritory }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const geoDataRef = useRef<GeoJSON.FeatureCollection<any> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Surgeon state
  const surgeonLineRef = useRef<number[][]>([]);
  const surgeonTargetId = useRef<string | null>(null);

  useEffect(() => {
    if (mapRef.current) return;

    if (mapContainer.current) {
      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8,
          sources: {
            "raster-tiles": {
              type: "raster",
              tiles: ["https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "&copy; OpenStreetMap &copy; CARTO",
            }
          },
          layers: [{ id: "simple-tiles", type: "raster", source: "raster-tiles", minzoom: 0, maxzoom: 22 }]
        },
        center: [15, 45],
        zoom: 3,
      });

      map.on("load", async () => {
        const res = await fetch("/countries.geojson");
        const data = await res.json() as GeoJSON.FeatureCollection<any>;
        
        data.features.forEach((f, i) => {
          f.id = f.properties?.ISO_A3 || `country-${i}`;
        });
        
        geoDataRef.current = data;

        map.addSource("countries", {
          type: "geojson",
          data: geoDataRef.current,
          generateId: true
        });
        
        // Surgeon line source
        map.addSource("surgeon-line", {
          type: "geojson",
          data: turf.featureCollection([])
        });

        map.addLayer({
          id: "countries-fill",
          type: "fill",
          source: "countries",
          paint: {
            "fill-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              "rgba(255, 100, 100, 0.5)",
              ["boolean", ["feature-state", "surgeon-target"], false],
              "rgba(255, 200, 0, 0.5)",
              "rgba(66, 135, 245, 0.15)"
            ],
            "fill-outline-color": "rgba(255, 255, 255, 0.4)"
          }
        });

        map.addLayer({
          id: "countries-line",
          type: "line",
          source: "countries",
          paint: {
            "line-color": "rgba(255, 255, 255, 0.5)",
            "line-width": 1
          }
        });
        
        map.addLayer({
          id: "surgeon-line-draw",
          type: "line",
          source: "surgeon-line",
          paint: {
            "line-color": "#ffc800",
            "line-width": 3,
            "line-dasharray": [2, 2]
          }
        });

        mapRef.current = map;
      });
    }
  }, []);

  // Mode interactions
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Reset states on mode switch
    surgeonLineRef.current = [];
    if (surgeonTargetId.current) {
      map.setFeatureState({ source: 'countries', id: surgeonTargetId.current }, { 'surgeon-target': false });
      surgeonTargetId.current = null;
    }
    (map.getSource("surgeon-line") as maplibregl.GeoJSONSource)?.setData(turf.featureCollection([]));

    const clickHandler = (e: any) => {
      if (mode === "pointer") {
        const feature = e.features[0];
        
        if (onSelectTerritory) {
          onSelectTerritory(feature);
        }

        const countryName = feature.properties?.ADMIN || "Unknown";
        new maplibregl.Popup({ className: 'glass-popup' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding: 8px;">
              <h3 style="margin: 0 0 5px 0; color: #fff; font-size: 16px;">${countryName}</h3>
              <p style="margin: 0; color: #aaa; font-size: 12px;">Area: ${Math.round(turf.area(feature) / 1000000).toLocaleString()} km²</p>
            </div>
          `)
          .addTo(map);
      } else if (mode === "paint") {
        const feature = e.features[0];
        const fid = feature.id as string;
        
        setSelectedIds(prev => {
          const isSelected = prev.includes(fid);
          const next = isSelected ? prev.filter(id => id !== fid) : [...prev, fid];
          map.setFeatureState({ source: 'countries', id: feature.id }, { selected: !isSelected });
          return next;
        });
      } else if (mode === "surgeon") {
        // If we haven't selected a target country to cut yet, select it
        if (!surgeonTargetId.current) {
          surgeonTargetId.current = e.features[0].id as string;
          map.setFeatureState({ source: 'countries', id: surgeonTargetId.current }, { 'surgeon-target': true });
        } else {
          // If a target is selected, add points to the surgeon line
          surgeonLineRef.current.push([e.lngLat.lng, e.lngLat.lat]);
          
          if (surgeonLineRef.current.length > 1) {
            const line = turf.lineString(surgeonLineRef.current);
            (map.getSource("surgeon-line") as maplibregl.GeoJSONSource).setData(turf.featureCollection([line]));
          }
        }
      }
    };

    map.on('click', 'countries-fill', clickHandler);
    
    // Also allow clicking outside a country to draw the line points
    const mapClickHandler = (e: any) => {
      if (mode === "surgeon" && surgeonTargetId.current) {
        // Only if we didn't hit a country fill (prevents double triggers)
        const features = map.queryRenderedFeatures(e.point, { layers: ['countries-fill'] });
        if (features.length === 0) {
          surgeonLineRef.current.push([e.lngLat.lng, e.lngLat.lat]);
          if (surgeonLineRef.current.length > 1) {
            const line = turf.lineString(surgeonLineRef.current);
            (map.getSource("surgeon-line") as maplibregl.GeoJSONSource).setData(turf.featureCollection([line]));
          }
        }
      }
    };
    map.on('click', mapClickHandler);
    
    return () => {
      map.off('click', 'countries-fill', clickHandler);
      map.off('click', mapClickHandler);
    }
  }, [mode]);

  // Execute Actions (Enter key)
  useEffect(() => {
    const handleAction = (e: KeyboardEvent) => {
      if (e.key === "Enter" && geoDataRef.current && mapRef.current) {
        // --- PAINT (MERGE) ACTION ---
        if (mode === "paint" && selectedIds.length > 1) {
          const featuresToMerge = geoDataRef.current.features.filter(f => selectedIds.includes(f.id as string));
          try {
            let merged = featuresToMerge[0] as any;
            for (let i = 1; i < featuresToMerge.length; i++) {
              merged = turf.union(turf.featureCollection([merged, featuresToMerge[i]]));
            }
            
            merged.id = `merged-${Date.now()}`;
            merged.properties = { ...featuresToMerge[0].properties, ADMIN: "New United Territory" };

            const nextFeatures = geoDataRef.current.features.filter(f => !selectedIds.includes(f.id as string));
            nextFeatures.push(merged);
            
            geoDataRef.current.features = nextFeatures;
            (mapRef.current.getSource("countries") as maplibregl.GeoJSONSource).setData(geoDataRef.current);
            
            selectedIds.forEach(id => mapRef.current?.setFeatureState({ source: 'countries', id }, { selected: false }));
            setSelectedIds([]);
          } catch (err) {
            console.error("Merge failed", err);
          }
        }
        
        // --- SURGEON (CUT) ACTION ---
        if (mode === "surgeon" && surgeonTargetId.current && surgeonLineRef.current.length > 1) {
          try {
            const targetFeature = geoDataRef.current.features.find(f => f.id === surgeonTargetId.current) as turf.Feature<turf.Polygon | turf.MultiPolygon>;
            
            if (targetFeature) {
              const line = turf.lineString(surgeonLineRef.current);
              
              // Brilliant GIS trick: buffer the line very slightly to make a polygon, then subtract it!
              const bufferedLine = turf.buffer(line, 0.1, { units: 'kilometers' });
              
              if (bufferedLine) {
                const diff = turf.difference(turf.featureCollection([targetFeature, bufferedLine]));
                
                if (diff) {
                  // diff might be a MultiPolygon or Polygon. Let's flatten it to distinct Polygons/MultiPolygons if possible.
                  // For a true split, difference creates a MultiPolygon. We can break it down.
                  // Let's just replace it with whatever difference gives us, but let's try to flatten it to separate features.
                  
                  const newFeatures: turf.Feature<any>[] = [];
                  if (diff.geometry.type === 'MultiPolygon') {
                     diff.geometry.coordinates.forEach((polygonCoords, i) => {
                       const newPoly = turf.polygon(polygonCoords, { ...targetFeature.properties, ADMIN: `${targetFeature.properties?.ADMIN} (Part ${i+1})` });
                       newPoly.id = `cut-${Date.now()}-${i}`;
                       newFeatures.push(newPoly);
                     });
                  } else {
                     diff.id = `cut-${Date.now()}`;
                     newFeatures.push(diff);
                  }

                  // Remove old target, add new pieces
                  const nextFeatures = geoDataRef.current.features.filter(f => f.id !== surgeonTargetId.current);
                  nextFeatures.push(...newFeatures);
                  
                  geoDataRef.current.features = nextFeatures;
                  (mapRef.current.getSource("countries") as maplibregl.GeoJSONSource).setData(geoDataRef.current);
                }
              }
            }
          } catch (err) {
            console.error("Cut failed", err);
          }
          
          // Reset surgeon
          mapRef.current.setFeatureState({ source: 'countries', id: surgeonTargetId.current }, { 'surgeon-target': false });
          surgeonTargetId.current = null;
          surgeonLineRef.current = [];
          (mapRef.current.getSource("surgeon-line") as maplibregl.GeoJSONSource).setData(turf.featureCollection([]));
        }
      }
      
      // Escape to cancel surgeon
      if (e.key === "Escape" && mode === "surgeon" && surgeonTargetId.current) {
        mapRef.current?.setFeatureState({ source: 'countries', id: surgeonTargetId.current }, { 'surgeon-target': false });
        surgeonTargetId.current = null;
        surgeonLineRef.current = [];
        (mapRef.current?.getSource("surgeon-line") as maplibregl.GeoJSONSource)?.setData(turf.featureCollection([]));
      }
    };

    window.addEventListener('keydown', handleAction);
    return () => window.removeEventListener('keydown', handleAction);
  }, [mode, selectedIds]);

  return (
    <div
      ref={mapContainer}
      style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
    />
  );
}
