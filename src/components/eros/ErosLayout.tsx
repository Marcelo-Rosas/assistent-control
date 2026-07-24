import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Heart, LayoutDashboard, MessageSquare, Kanban, Users, Search, FileText, Sparkles } from 'lucide-react';

const tabs = [
  { to: '/eros', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/eros/chat', label: 'Chat', icon: MessageSquare, badge: 'SPIN' },
  { to: '/eros/kanban', label: 'Pipeline', icon: Kanban },
  { to: '/eros/contacts', label: 'Contatos', icon: Users },
  { to: '/eros/prospection', label: 'Prospecção', icon: Search },
  { to: '/eros/content', label: 'Conteúdo', icon: FileText },
] as const;

export const ErosLayout: React.FC = () => {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 pt-4 pb-0 border-b border-slate-800/60 bg-slate-950/40">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
            <Heart className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-300">Eros</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto pb-px scrollbar-thin">
          {tabs.map(({ to, label, icon: Icon, badge, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest ? rest.end : false}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-pink-500 text-pink-200 bg-slate-900/50'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
                }`
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {badge && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-purple-500/20 border border-purple-500/30 text-[10px] font-bold text-purple-200">
                  <Sparkles className="w-2.5 h-2.5" />
                  {badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
};
