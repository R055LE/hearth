import { useEffect, useState } from 'react';
import { FloorplanView } from './components/FloorplanView';
import { MaintenanceView } from './components/MaintenanceView';
import { RoomEditor } from './components/RoomEditor';
import { PanelEditor } from './components/PanelEditor';
import './App.css';

type Tab = 'floorplan' | 'rooms' | 'panels' | 'maintenance';

function tabFromLocation(): Tab {
  switch (window.location.hash) {
    case '#rooms': return 'rooms';
    case '#panels': return 'panels';
    case '#maintenance': return 'maintenance';
    default: return 'floorplan';
  }
}

function App() {
  const [tab, setTab] = useState<Tab>(tabFromLocation);
  const [floorplanTarget, setFloorplanTarget] = useState<{
    circuitId: number;
    floor: string;
  } | null>(null);

  useEffect(() => {
    const onHashChange = () => setTab(tabFromLocation());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function openTab(nextTab: Tab) {
    window.location.hash = nextTab;
  }

  function openFloorplan(circuitId?: number, floor?: string) {
    setFloorplanTarget(circuitId != null && floor ? { circuitId, floor } : null);
    openTab('floorplan');
  }

  return (
    <div className="app">
      <header>
        <h1>Hearth</h1>
        <nav className="tabs">
          <button
            className={tab === 'floorplan' ? 'active' : ''}
            aria-current={tab === 'floorplan' ? 'page' : undefined}
            onClick={() => openFloorplan()}
          >
            Floorplan
          </button>
          <button
            className={tab === 'rooms' ? 'active' : ''}
            aria-current={tab === 'rooms' ? 'page' : undefined}
            onClick={() => openTab('rooms')}
          >
            Rooms
          </button>
          <button
            className={tab === 'panels' ? 'active' : ''}
            aria-current={tab === 'panels' ? 'page' : undefined}
            onClick={() => openTab('panels')}
          >
            Panels &amp; circuits
          </button>
          <button
            className={tab === 'maintenance' ? 'active' : ''}
            aria-current={tab === 'maintenance' ? 'page' : undefined}
            onClick={() => openTab('maintenance')}
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
            onOpenRooms={() => openTab('rooms')}
          />
        )}
        {tab === 'rooms' && <RoomEditor />}
        {tab === 'panels' && <PanelEditor onViewCircuit={openFloorplan} />}
        <MaintenanceView active={tab === 'maintenance'} />
      </main>
    </div>
  );
}

export default App;
