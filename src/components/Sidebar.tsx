import React, { useState } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Settings as SettingsIcon,
  LogOut,
  Command,
  ChevronLeft,
  ChevronRight,
  Zap,
  ShieldCheck,
  Calendar,
  Kanban,
  Code2,
  Lock,
  Database,
  Sparkles,
  Search,
  FileText,
  Bug,
  Building2,
  MapPin,
  Brain,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRoles } from '../context/RoleContext';

const Sidebar: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  const { currentRole, getRoleName, hasPermission } = useRoles();

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'read_dashboard' },
    { id: 'kanban', label: 'Pipeline', icon: Kanban, permission: 'manage_pipeline' },
    { id: 'chat', label: 'Chat Ao Vivo', icon: MessageSquare, permission: 'interact_chat' },
    { id: 'contacts', label: 'Contatos', icon: Users, permission: 'interact_chat' },
    { id: 'prospection', label: 'Prospecção', icon: Search, permission: 'access_eros' },
    { id: 'content', label: 'Conteúdo', icon: FileText, permission: 'access_eros' },
    { id: 'knowledge', label: 'Base de Conhecimento', icon: Database, permission: 'manage_knowledge' },
    { id: 'rag', label: 'RAG Playground', icon: Bug, permission: 'manage_knowledge' },
    { id: 'receita', label: 'Receita CNAE', icon: Building2, permission: 'read_dashboard' },
    { id: 'coverage/bairros', label: 'Cobertura Bairros', icon: MapPin, permission: 'read_dashboard' },
    { id: 'ml/train', label: 'Lab ML Agregadores', icon: Brain, permission: 'manage_knowledge' },
    { id: 'scheduling', label: 'Agendamentos', icon: Calendar, permission: 'manage_appointments' },
    { id: 'playground', label: 'Playground', icon: Sparkles, permission: 'manage_settings' },
    { id: 'team', label: 'Equipe', icon: ShieldCheck, permission: 'manage_team' },
    { id: 'functions', label: 'Funções', icon: Code2, permission: 'edit_functions' },
    { id: 'settings', label: 'Configurações', icon: SettingsIcon, permission: 'manage_settings' },
  ];

  const getUserProfile = () => {
    switch (currentRole) {
      case 'admin':
        return {
          name: 'Marcelo Rosas',
          email: 'marketing@gymsite.com.br',
          initials: 'MR',
          tagColor: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
        };
      case 'creator':
        return {
          name: 'Sarah Connor',
          email: 'sarah@gymsite.com.br',
          initials: 'SC',
          tagColor: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
        };
      case 'basic':
        return {
          name: 'John Doe',
          email: 'john@gymsite.com.br',
          initials: 'JD',
          tagColor: 'bg-slate-800 border-slate-700 text-slate-400',
        };
    }
  };

  const profile = getUserProfile();

  return (
    <div
      className={`flex flex-col bg-slate-950/50 backdrop-blur-xl h-full transition-all duration-300 ease-in-out relative border-r border-slate-800/50 z-50
        ${isExpanded ? 'w-20 lg:w-64' : 'w-20'}
      `}
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="hidden lg:flex absolute -right-3 top-9 w-6 h-6 bg-slate-800 rounded-full items-center justify-center text-slate-400 border border-slate-700 hover:bg-cyan-500 hover:text-white hover:border-cyan-400 transition-all z-50 shadow-lg"
      >
        {isExpanded ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      <div className="h-20 flex items-center justify-center lg:justify-start lg:px-6 border-b border-slate-800/50 flex-shrink-0 bg-slate-950/30">
        <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
          <div className="absolute inset-0 bg-cyan-500/20 blur-lg rounded-full"></div>
          <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Command className="w-5 h-5 text-white" />
          </div>
        </div>

        <div
          className={`hidden lg:flex flex-col ml-3 overflow-hidden whitespace-nowrap transition-all duration-300 ${
            isExpanded ? 'w-40 opacity-100' : 'w-0 opacity-0'
          }`}
        >
          <span className="font-bold text-lg tracking-tight text-white">GymSite - Pipeline</span>
          <span className="text-[10px] uppercase tracking-wider text-cyan-500 font-semibold">
            @gymsite.com.br
          </span>
        </div>
      </div>

      <nav className="flex-1 py-6 px-3 space-y-1.5 overflow-x-hidden overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            location.pathname === `/${item.id}` || location.pathname.startsWith(`/${item.id}/`);
          const hasItemPermission = hasPermission(item.permission);

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/${item.id}`)}
              className={`w-full flex items-center justify-between lg:justify-start px-3 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden
                ${
                  isActive
                    ? 'bg-slate-800/80 text-cyan-400 shadow-lg shadow-black/20 ring-1 ring-slate-700/50'
                    : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                }`}
              title={!isExpanded ? item.label : ''}
            >
              {isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500 rounded-l-md shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>
              )}

              <div className="flex items-center">
                <Icon
                  className={`w-5 h-5 flex-shrink-0 transition-colors ${
                    isActive ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'
                  }`}
                />

                <div
                  className={`hidden lg:block overflow-hidden whitespace-nowrap transition-all duration-300 ${
                    isExpanded ? 'w-auto opacity-100 ml-3' : 'w-0 opacity-0 ml-0'
                  }`}
                >
                  <span className={`text-sm font-medium ${isActive ? 'text-cyan-50' : ''}`}>
                    {item.label}
                  </span>
                </div>
              </div>

              {!hasItemPermission && isExpanded && (
                <div
                  className="hidden lg:block ml-auto text-slate-600 group-hover:text-slate-500"
                  title="Acesso Condicional"
                >
                  <Lock className="w-3.5 h-3.5" />
                </div>
              )}
            </button>
          );
        })}

        {isExpanded && (
          <div className="mt-8 mx-2 p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700/50 relative overflow-hidden group hidden lg:block">
            <div className="absolute -top-10 -right-10 w-24 h-24 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition-all"></div>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-cyan-400 fill-cyan-400/20" />
              <span className="text-xs font-bold text-white">Plano Pro</span>
            </div>
            <p className="text-xs text-slate-400 mb-3">Você está usando 80% dos recursos de IA.</p>
            <button
              type="button"
              className="w-full py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors border border-slate-600"
            >
              Fazer Upgrade
            </button>
          </div>
        )}
      </nav>

      <div className="p-4 border-t border-slate-800/50 bg-slate-950/30">
        <button
          type="button"
          className="w-full flex items-center justify-center lg:justify-start p-2 rounded-xl hover:bg-slate-800/50 transition-colors text-slate-400 hover:text-white group border border-transparent hover:border-slate-700/50"
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-cyan-900 to-slate-800 flex items-center justify-center text-xs font-bold text-cyan-200 border border-slate-700 ring-2 ring-transparent group-hover:ring-cyan-500/20 transition-all flex-shrink-0">
            {profile?.initials}
          </div>

          <div
            className={`hidden lg:block overflow-hidden whitespace-nowrap transition-all duration-300 ${
              isExpanded ? 'w-auto opacity-100 ml-3' : 'w-0 opacity-0 ml-0'
            }`}
          >
            <div className="text-left">
              <p className="text-sm font-medium text-slate-200 group-hover:text-white truncate w-32">
                {profile?.name}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${profile?.tagColor}`}>
                  {getRoleName()}
                </span>
              </div>
            </div>
          </div>

          <div
            className={`hidden lg:block overflow-hidden whitespace-nowrap transition-all duration-300 ${
              isExpanded ? 'w-auto opacity-100 ml-auto' : 'w-0 opacity-0 ml-0'
            }`}
          >
            <LogOut className="w-4 h-4 text-slate-500 hover:text-red-400 transition-colors" />
          </div>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
