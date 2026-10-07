"use client";

import { useState } from "react";
import Map from "@/components/Map";
import Sidebar from "@/components/Sidebar";

export default function Home() {
  const [mode, setMode] = useState<"pointer" | "paint" | "surgeon">("pointer");
  const [selectedTerritory, setSelectedTerritory] = useState<any | null>(null);

  return (
    <main style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Map mode={mode} onSelectTerritory={(f) => { if (mode === "pointer") setSelectedTerritory(f); }} />
      <Sidebar feature={selectedTerritory} />
      
      {/* Premium Glassmorphism UI Overlay */}
      <div style={{
        position: 'absolute',
        top: 24,
        left: 24,
        background: 'rgba(20, 20, 25, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        padding: '24px',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#fff',
        zIndex: 10,
        width: '320px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: 700, letterSpacing: '-0.5px' }}>CMaps Engine</h1>
        <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#a0a0a5', lineHeight: '1.5' }}>
          Select a tool to modify borders dynamically.
        </p>
        
        <div style={{
          background: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '12px',
          padding: '16px',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div>
            <span style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '8px' }}>Active Mode</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(["pointer", "paint", "surgeon"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    flex: 1,
                    background: mode === m ? '#4287f5' : 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    padding: '8px 0',
                    borderRadius: '8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          
          {mode === 'paint' && (
            <div style={{ fontSize: '12px', color: '#4287f5', background: 'rgba(66, 135, 245, 0.1)', padding: '8px', borderRadius: '8px' }}>
              <strong>Paint Mode:</strong> Click multiple countries to select them. Press <strong>Enter</strong> to merge them.
            </div>
          )}
          {mode === 'surgeon' && (
            <div style={{ fontSize: '12px', color: '#ffc800', background: 'rgba(255, 200, 0, 0.1)', padding: '8px', borderRadius: '8px' }}>
              <strong>Surgeon Mode:</strong> Click a territory to target it. Click around to draw a cut line across it. Press <strong>Enter</strong> to slice, or <strong>Escape</strong> to cancel.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
