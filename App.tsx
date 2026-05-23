
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ChatInterface from './components/ChatInterface';
import Contacts from './components/Contacts';
import Settings from './components/Settings';
import Team from './components/Team';
import Scheduling from './components/Scheduling';
import Kanban from './components/Kanban';
import MeetingRoom from './components/MeetingRoom';
import Functions from './components/Functions';

// Componente de Layout que envolve a aplicação principal
const AppLayout: React.FC = () => {
  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-50 overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-cyan-900/20 rounded-full blur-[128px] pointer-events-none -translate-x-1/2 -translate-y-1/2 z-0"></div>
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-violet-900/10 rounded-full blur-[128px] pointer-events-none translate-x-1/2 translate-y-1/2 z-0"></div>
      
      <Sidebar />
      
      <main className="flex-1 h-full overflow-hidden relative z-10 flex flex-col">
        {/* Top Border Gradient */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent opacity-50 z-20"></div>
        
        <div className="flex-1 w-full h-full relative">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rota Externa: Sala de Reunião (Sem Sidebar) */}
        <Route path="/meeting/:id" element={<MeetingRoom />} />

        {/* Rotas Internas (Com Sidebar) */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/kanban" element={<Kanban />} />
          <Route path="/chat" element={<ChatInterface />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/scheduling" element={<Scheduling />} />
          <Route path="/team" element={<Team />} />
          <Route path="/functions" element={<Functions />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
