
import React, { useState } from 'react';
import { LayoutDashboard, MessageSquare, Users, Settings as SettingsIcon, LogOut, Command, ChevronLeft, ChevronRight, Zap, ShieldCheck, Calendar, Kanban, Code2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

const Sidebar: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  
  // Extrai a rota atual (ex: /chat -> chat)
  const currentPath = location.pathname.substring(1) || 'dashboard';

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'kanban', label: 'Pipeline', icon: Kanban },
    { id: 'chat', label: 'Chat Ao Vivo', icon: MessageSquare },
    { id: 'contacts', label: 'Contatos', icon: Users },
    { id: 'scheduling', label: 'Agendamentos', icon: Calendar },
    { id: 'team', label: 'Equipe', icon: ShieldCheck },
    { id: 'functions', label: 'Funções', icon: Code2 },
    { id: 'settings', label: 'Configurações', icon: SettingsIcon },
  ];

  return (
    <div 
      className={`flex flex-col bg-slate-950/50 backdrop-blur-xl h-full transition-all duration-300 ease-cubic-bezier(0.4, 0, 0.2, 1) relative border-r border-slate-800/50 z-50
        ${isExpanded ? 'w-20 lg:w-64' : 'w-20'}
      `}
    >
      {/* Toggle Button */}
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="hidden lg:flex absolute -right-3 top-9 w-6 h-6 bg-slate-800 rounded-full items-center justify-center text-slate-400 border border-slate-700 hover:bg-cyan-500 hover:text-white hover:border-cyan-400 transition-all z-50 shadow-lg"
      >
        {isExpanded ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {/* Brand / Logo Area */}
      <div className="h-20 flex items-center justify-center lg:justify-start lg:px-6 border-b border-slate-800/50 flex-shrink-0 bg-slate-950/30">
        <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
          <div className="absolute inset-0 bg-cyan-500/20 blur-lg rounded-full"></div>
          <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Command className="w-5 h-5 text-white" />
          </div>
        </div>
        
        <div className={`hidden lg:flex flex-col ml-3 overflow-hidden whitespace-nowrap transition-all duration-300 ${
          isExpanded ? 'w-40 opacity-100' : 'w-0 opacity-0'
        }`}>
          <span className="font-bold text-lg tracking-tight text-white">Viver de IA</span>
          <span className="text-[10px] uppercase tracking-wider text-cyan-500 font-semibold">Workspace</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-6 px-3 space-y-1.5 overflow-x-hidden">
        {menuItems.map((item) => {
          const Icon = item.icon;
          // Verifica se a rota começa com o id do item (para sub-rotas funcionarem)
          const isActive = currentPath.startsWith(item.id);
          
          return (
            <button
              key={item.id}
              onClick={() => navigate(`/${item.id}`)}
              className={`w-full flex items-center justify-center lg:justify-start px-3 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden
                ${isActive 
                  ? 'bg-slate-800/80 text-cyan-400 shadow-lg shadow-black/20 ring-1 ring-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                }`}
              title={!isExpanded ? item.label : ''}
            >
              {isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500 rounded-l-md shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>
              )}
              
              <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${isActive ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
              
              <div className={`hidden lg:block overflow-hidden whitespace-nowrap transition-all duration-300 ${
                isExpanded ? 'w-auto opacity-100 ml-3' : 'w-0 opacity-0 ml-0'
              }`}>
                <span className={`text-sm font-medium ${isActive ? 'text-cyan-50' : ''}`}>{item.label}</span>
              </div>
            </button>
          );
        })}

        {/* Pro Banner (Mock) */}
        {isExpanded && (
           <div className="mt-8 mx-2 p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700/50 relative overflow-hidden group hidden lg:block">
             <div className="absolute -top-10 -right-10 w-24 h-24 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition-all"></div>
             <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-cyan-400 fill-cyan-400/20" />
                <span className="text-xs font-bold text-white">Plano Pro</span>
             </div>
             <p className="text-xs text-slate-400 mb-3">Você está usando 80% dos recursos de IA.</p>
             <button className="w-full py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors border border-slate-600">
               Fazer Upgrade
             </button>
           </div>
        )}
      </nav>

      {/* User Footer */}
      <div className="p-4 border-t border-slate-800/50 bg-slate-950/30">
        <button className="w-full flex items-center justify-center lg:justify-start p-2 rounded-xl hover:bg-slate-800/50 transition-colors text-slate-400 hover:text-white group border border-transparent hover:border-slate-700/50">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-cyan-900 to-slate-800 flex items-center justify-center text-xs font-bold text-cyan-200 border border-slate-700 ring-2 ring-transparent group-hover:ring-cyan-500/20 transition-all flex-shrink-0">
            AD
          </div>
          
          <div className={`hidden lg:block overflow-hidden whitespace-nowrap transition-all duration-300 ${
            isExpanded ? 'w-auto opacity-100 ml-3' : 'w-0 opacity-0 ml-0'
          }`}>
            <div className="text-left">
              <p className="text-sm font-medium text-slate-200 group-hover:text-white">Admin User</p>
              <p className="text-xs text-slate-500 truncate w-32">admin@viverdeia.com</p>
            </div>
          </div>

          <div className={`hidden lg:block overflow-hidden whitespace-nowrap transition-all duration-300 ${
             isExpanded ? 'w-auto opacity-100 ml-auto' : 'w-0 opacity-0 ml-0'
          }`}>
             <LogOut className="w-4 h-4 text-slate-500 hover:text-red-400 transition-colors" />
          </div>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
