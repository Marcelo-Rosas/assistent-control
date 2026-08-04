import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Settings from './components/Settings';
import Team from './components/Team';
import Scheduling from './components/Scheduling';
import MeetingRoom from './components/MeetingRoom';
import Functions from './components/Functions';
import { RoleProvider, useRoles, UserRole } from './context/RoleContext';
import { Shield, UserCheck } from 'lucide-react';
import {
  ErosChat,
  ErosContacts,
  ErosContentQueue,
  ErosDashboard,
  ErosKanban,
  ErosProspection,
} from './components/eros';
import { FuguPlayground } from './components/playground/FuguPlayground';
import { KnowledgeBase } from './components/knowledge/KnowledgeBase';
import { RagPlayground } from './components/RagPlayground';
import { PipelineLlmBar } from './components/PipelineLlmBar';
import ReceitaMercadoDashboard from './components/ReceitaMercadoDashboard';

const AppLayout: React.FC = () => {
  const { currentRole, setCurrentRole } = useRoles();

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-50 overflow-hidden">
      <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-cyan-900/20 rounded-full blur-[128px] pointer-events-none -translate-x-1/2 -translate-y-1/2 z-0"></div>
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-violet-900/10 rounded-full blur-[128px] pointer-events-none translate-x-1/2 translate-y-1/2 z-0"></div>

      <Sidebar />

      <main className="flex-1 h-full overflow-hidden relative z-10 flex flex-col">
        <div className="bg-slate-900 border-b border-slate-800/80 px-6 py-3 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 relative z-30 shadow-lg">
          <div className="flex items-center gap-3 min-w-0">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">
                  Simulador de Papéis
                </span>
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 truncate">
                Rotas canônicas GymSite — sem prefixo /eros
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <PipelineLlmBar />
            <div className="flex items-center gap-2 bg-slate-950/90 p-1 rounded-xl border border-slate-800/80">
              {(['admin', 'creator', 'basic'] as UserRole[]).map((role) => {
                const isActive = currentRole === role;
                return (
                  <button
                    key={role}
                    type="button"
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
                    {role === 'admin'
                      ? 'Admin'
                      : role === 'creator'
                        ? 'Criador'
                        : 'Básico'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

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
          <Route path="/meeting/:id" element={<MeetingRoom />} />

          <Route element={<AppLayout />}>
            {/* Canônico (Fase 1–2) */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<ErosDashboard />} />
            <Route path="/kanban" element={<ErosKanban />} />
            <Route path="/chat" element={<ErosChat />} />
            <Route path="/contacts" element={<ErosContacts />} />
            <Route path="/prospection" element={<ErosProspection />} />
            <Route path="/content" element={<ErosContentQueue />} />
            <Route path="/knowledge" element={<KnowledgeBase />} />
            <Route path="/rag" element={<RagPlayground />} />
            <Route path="/receita" element={<ReceitaMercadoDashboard />} />
            <Route path="/scheduling" element={<Scheduling />} />
            <Route path="/playground" element={<FuguPlayground />} />
            <Route path="/team" element={<Team />} />
            <Route path="/functions" element={<Functions />} />
            <Route path="/settings" element={<Settings />} />

            {/* Fase 4 — aliases /eros/* → canônico */}
            <Route path="/eros" element={<Navigate to="/dashboard" replace />} />
            <Route path="/eros/chat" element={<Navigate to="/chat" replace />} />
            <Route path="/eros/kanban" element={<Navigate to="/kanban" replace />} />
            <Route path="/eros/contacts" element={<Navigate to="/contacts" replace />} />
            <Route path="/eros/prospection" element={<Navigate to="/prospection" replace />} />
            <Route path="/eros/content" element={<Navigate to="/content" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </RoleProvider>
  );
};

export default App;
