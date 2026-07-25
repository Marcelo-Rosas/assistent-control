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
import { RoleProvider, useRoles, UserRole } from './context/RoleContext';
import { Shield, Sparkles, UserCheck } from 'lucide-react';
import {
  ErosChat,
  ErosContacts,
  ErosContentQueue,
  ErosDashboard,
  ErosKanban,
  ErosLayout,
  ErosProspection,
} from './components/eros';
import { FuguPlayground } from './components/playground/FuguPlayground';
import { KnowledgeBase } from './components/knowledge/KnowledgeBase';

// Componente de Layout que envolve a aplicação principal
const AppLayout: React.FC = () => {
  const { currentRole, setCurrentRole, getRoleName } = useRoles();

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-50 overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-cyan-900/20 rounded-full blur-[128px] pointer-events-none -translate-x-1/2 -translate-y-1/2 z-0"></div>
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-violet-900/10 rounded-full blur-[128px] pointer-events-none translate-x-1/2 translate-y-1/2 z-0"></div>
      
      <Sidebar />
      
      <main className="flex-1 h-full overflow-hidden relative z-10 flex flex-col">
        {/* Role Simulator Header */}
        <div className="bg-slate-900 border-b border-slate-800/80 px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-4 relative z-30 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">
                  Simulador de Papéis & Permissões
                </span>
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5">
                Alterne os níveis de acesso para testar as restrições comportamentais da plataforma.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-950/90 p-1 rounded-xl border border-slate-800/80">
            {(['admin', 'creator', 'basic'] as UserRole[]).map((role) => {
              const isActive = currentRole === role;
              return (
                <button
                  key={role}
                  onClick={() => setCurrentRole(role)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1 ${
                    isActive
                      ? role === 'admin'
                        ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20 font-bold'
                        : role === 'creator'
                        ? 'bg-violet-600 text-white shadow-md shadow-violet-600/20 font-bold'
                        : 'bg-slate-800 text-slate-100 border border-slate-700 font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  {isActive && <UserCheck className="w-3 h-3" />}
                  {role === 'admin' ? 'Administrador' : role === 'creator' ? 'Criador de Conteúdo' : 'Usuário Básico'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Top Border Gradient */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent opacity-50 z-20"></div>
        
        <div className="flex-1 w-full h-full relative overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <RoleProvider>
      <BrowserRouter>
        <Routes>
          {/* Rota Externa: Sala de Reunião (Sem Sidebar) */}
          <Route path="/meeting/:id" element={<MeetingRoom />} />

          {/* Rotas Internas (Com Sidebar) */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/eros" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/kanban" element={<Kanban />} />
            <Route path="/chat" element={<ChatInterface />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/scheduling" element={<Scheduling />} />
            <Route path="/team" element={<Team />} />
            <Route path="/functions" element={<Functions />} />
            <Route path="/playground" element={<FuguPlayground />} />
            <Route path="/knowledge" element={<KnowledgeBase />} />
            <Route path="/settings" element={<Settings />} />

            <Route path="/eros" element={<ErosLayout />}>
              <Route index element={<ErosDashboard />} />
              <Route path="kanban" element={<ErosKanban />} />
              <Route path="chat" element={<ErosChat />} />
              <Route path="contacts" element={<ErosContacts />} />
              <Route path="prospection" element={<ErosProspection />} />
              <Route path="content" element={<ErosContentQueue />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </RoleProvider>
  );
};

export default App;