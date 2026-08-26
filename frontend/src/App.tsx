import { useState } from 'react';
import { FloorplanView } from './components/FloorplanView';
import { MaintenanceView } from './components/MaintenanceView';
import { RoomEditor } from './components/RoomEditor';
import { PanelEditor } from './components/PanelEditor';
import './App.css';

type Tab = 'floorplan' | 'rooms' | 'panels' | 'maintenance';

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
          <button
            className={tab === 'maintenance' ? 'active' : ''}
            onClick={() => setTab('maintenance')}
          >
            Maintenance
          </button>
        </nav>
      </header>
      <main>
        {tab === 'floorplan' && (
          <FloorplanView
            initialCircuitId={floorplanTarget?.circuitId}
            initialFloor={floorplanTarget?.floor}
            onOpenRooms={() => setTab('rooms')}
          />
        )}
        {tab === 'rooms' && <RoomEditor />}
        {tab === 'panels' && <PanelEditor onViewCircuit={openFloorplan} />}
        {tab === 'maintenance' && <MaintenanceView />}
      </main>
    </div>
  );
}

export default App;
