import React, { createContext, useContext, useState } from 'react';

export type UserRole = 'admin' | 'creator' | 'basic';

export interface Permission {
  action: string;
  description: string;
  module: string;
  admin: boolean;
  creator: boolean;
  basic: boolean;
}

export interface RoleContextProps {
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  hasPermission: (action: string) => boolean;
  getRoleName: (role?: UserRole) => string;
  permissionsMatrix: Permission[];
}

const RoleContext = createContext<RoleContextProps | undefined>(undefined);

export const permissionsMatrix: Permission[] = [
  {
    action: 'read_dashboard',
    description: 'Visualizar Dashboard geral e métricas de desempenho',
    module: 'Dashboard',
    admin: true,
    creator: true,
    basic: true,
  },
  {
    action: 'interact_chat',
    description: 'Conversar com clientes e responder mensagens no chat ao vivo',
    module: 'Chat Ao Vivo',
    admin: true,
    creator: true,
    basic: true,
  },
  {
    action: 'manage_pipeline',
    description: 'Criar, mover e excluir contatos ou negócios no Pipeline (Kanban)',
    module: 'Pipeline (Kanban)',
    admin: true,
    creator: true,
    basic: false,
  },
  {
    action: 'manage_appointments',
    description: 'Agendar novas reuniões e demonstrações com clientes',
    module: 'Agendamentos',
    admin: true,
    creator: true,
    basic: false,
  },
  {
    action: 'manage_team',
    description: 'Convidar novos membros, alterar papéis e visualizar matriz de regras',
    module: 'Equipe',
    admin: true,
    creator: false,
    basic: false,
  },
  {
    action: 'edit_functions',
    description: 'Criar, editar e excluir funções e webhook blueprints de automação',
    module: 'Funções (Blueprints)',
    admin: true,
    creator: false,
    basic: false,
  },
  {
    action: 'manage_settings',
    description: 'Acessar e configurar credenciais globais da Evolution API e Webhooks',
    module: 'Configurações',
    admin: true,
    creator: false,
    basic: false,
  },
  {
    action: 'access_eros',
    description: 'Acessar o módulo Eros (prospecção social, chat, kanban e conteúdo)',
    module: 'Eros',
    admin: true,
    creator: true,
    basic: true,
  },
];

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRole, setCurrentRoleState] = useState<UserRole>(() => {
    const saved = localStorage.getItem('viver_de_ia_role');
    return (saved as UserRole) || 'admin';
  });

  const setCurrentRole = (role: UserRole) => {
    setCurrentRoleState(role);
    localStorage.setItem('viver_de_ia_role', role);
  };

  const hasPermission = (action: string): boolean => {
    const perm = permissionsMatrix.find((p) => p.action === action);
    if (!perm) return false;
    return perm[currentRole];
  };

  const getRoleName = (role?: UserRole): string => {
    const r = role || currentRole;
    switch (r) {
      case 'admin':
        return 'Administrador';
      case 'creator':
        return 'Criador de Conteúdo';
      case 'basic':
        return 'Usuário Básico';
      default:
        return 'Membro';
    }
  };

  return (
    <RoleContext.Provider value={{ currentRole, setCurrentRole, hasPermission, getRoleName, permissionsMatrix }}>
      {children}
    </RoleContext.Provider>
  );
};

export const useRoles = () => {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error('useRoles deve ser usado dentro de um RoleProvider');
  }
  return context;
};
