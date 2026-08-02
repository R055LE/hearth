import { useState } from 'react';
import { FloorplanView } from './components/FloorplanView';
import { RoomEditor } from './components/RoomEditor';
import { PanelEditor } from './components/PanelEditor';
import './App.css';

type Tab = 'floorplan' | 'rooms' | 'panels';

function App() {
  const [tab, setTab] = useState<Tab>('floorplan');

  return (
    <div className="app">
      <nav className="tabs">
        <button className={tab === 'floorplan' ? 'active' : ''} onClick={() => setTab('floorplan')}>
          Floorplan
        </button>
        <button className={tab === 'rooms' ? 'active' : ''} onClick={() => setTab('rooms')}>
          Rooms
        </button>
        <button className={tab === 'panels' ? 'active' : ''} onClick={() => setTab('panels')}>
          Panels &amp; circuits
        </button>
      </nav>
      <main>
        {tab === 'floorplan' && <FloorplanView />}
        {tab === 'rooms' && <RoomEditor />}
        {tab === 'panels' && <PanelEditor />}
      </main>
    </div>
  );
}

export default App;
