import { useState } from 'react';
import { FloorplanView } from './components/FloorplanView';
import { RoomEditor } from './components/RoomEditor';
import { PanelEditor } from './components/PanelEditor';
import './App.css';

type Tab = 'floorplan' | 'rooms' | 'panels';

function App() {
  const [tab, setTab] = useState<Tab>('floorplan');
  const [floorplanTarget, setFloorplanTarget] = useState<{
    circuitId: number;
    floor: string;
  } | null>(null);

  function openFloorplan(circuitId?: number, floor?: string) {
    setFloorplanTarget(circuitId != null && floor ? { circuitId, floor } : null);
    setTab('floorplan');
  }

  return (
    <div className="app">
      <header>
        <h1>Hearth</h1>
        <nav className="tabs">
          <button className={tab === 'floorplan' ? 'active' : ''} onClick={() => openFloorplan()}>
            Floorplan
          </button>
          <button className={tab === 'rooms' ? 'active' : ''} onClick={() => setTab('rooms')}>
            Rooms
          </button>
          <button className={tab === 'panels' ? 'active' : ''} onClick={() => setTab('panels')}>
            Panels &amp; circuits
          </button>
        </nav>
      </header>
      <main>
        {tab === 'floorplan' && (
          <FloorplanView
            initialCircuitId={floorplanTarget?.circuitId}
            initialFloor={floorplanTarget?.floor}
          />
        )}
        {tab === 'rooms' && <RoomEditor />}
        {tab === 'panels' && <PanelEditor onViewCircuit={openFloorplan} />}
      </main>
    </div>
  );
}

export default App;
