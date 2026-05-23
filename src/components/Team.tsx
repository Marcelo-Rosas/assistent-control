import React, { useEffect, useState } from 'react';
import { UserPlus, Search, Loader2, X, Check, ChevronDown, Edit2, Shield, Users, Briefcase, Lock, Unlock, HelpCircle, ShieldCheck, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from './Button';
import { api } from '../services/api';
import { TeamMember } from '../types';
import { useRoles, permissionsMatrix } from '../context/RoleContext';

const Team: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'members' | 'matrix'>('members');
  const [formData, setFormData] = useState({ name: '', email: '', role: 'basic' });
  const [searchQuery, setSearchQuery] = useState('');

  const { currentRole, getRoleName, hasPermission } = useRoles();
  const canManageTeam = hasPermission('manage_team'); // Only admin has this!

  useEffect(() => {
    const loadTeam = async () => {
      try {
        const data = await api.fetchTeam();
        setMembers(data);
      } catch (error) {
        console.error("Erro ao carregar equipe", error);
      } finally {
        setLoading(false);
      }
    };
    loadTeam();
  }, []);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTeam) return;

    const newMember: TeamMember = {
        id: Date.now().toString(),
        name: formData.name,
        email: formData.email,
        role: formData.role as 'admin' | 'creator' | 'basic',
        status: 'invited',
        avatar: `https://ui-avatars.com/api/?name=${formData.name.replace(' ', '+')}&background=random`
    };

    setMembers([...members, newMember]);
    setShowModal(false);
    setFormData({ name: '', email: '', role: 'basic' });
  };

  const handleRoleChange = (memberId: string, newRole: 'admin' | 'creator' | 'basic') => {
    if (!canManageTeam) return;
    setMembers(members.map(m => m.id === memberId ? { ...m, role: newRole } : m));
  };

  const handleRemoveMember = (memberId: string) => {
    if (!canManageTeam) return;
    if (confirm('Deseja realmente remover este membro da equipe?')) {
      setMembers(members.filter(m => m.id !== memberId));
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
        case 'active':
            return <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-950 border border-slate-700 text-white shadow-sm">Ativo</span>;
        case 'invited':
            return <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-950 border border-amber-900/50 text-amber-500 shadow-sm">Pendente</span>;
        default:
            return <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-950 border border-slate-800 text-slate-500 shadow-sm">Inativo</span>;
    }
  };

  // Stats derived from local state
  const stats = {
    total: members.length,
    admins: members.filter(m => m.role === 'admin').length,
    creators: members.filter(m => m.role === 'creator').length,
    basics: members.filter(m => m.role === 'basic').length
  };

  const filteredMembers = members.filter(member => 
    member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    member.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    member.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-8 h-full overflow-y-auto bg-slate-950 text-slate-50 relative custom-scrollbar">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4 border-b border-slate-800 pb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Hierarquia de Perfis & Permissões</h2>
          <p className="text-sm text-slate-400 mt-1">Configure administradores, criadores de conteúdo e usuários básicos da organização.</p>
        </div>
        <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          <button 
            onClick={() => setActiveTab('members')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'members' 
                ? 'bg-cyan-500 text-white shadow-lg' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Membros da Equipe
          </button>
          <button 
            onClick={() => setActiveTab('matrix')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'matrix' 
                ? 'bg-cyan-500 text-white shadow-lg' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Matriz de Permissões
          </button>
        </div>
      </div>

      {activeTab === 'members' ? (
        <>
          {/* Stats Cards Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="text-sm font-medium text-slate-400 mb-2">Total de Membros</div>
                <div className="text-3xl font-bold text-white">{loading ? '-' : stats.total}</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="text-sm font-medium text-slate-400 mb-2">Administradores</div>
                <div className="text-3xl font-bold text-cyan-400">{loading ? '-' : stats.admins}</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="text-sm font-medium text-slate-400 mb-2">Criadores de Conteúdo</div>
                <div className="text-3xl font-bold text-violet-400">{loading ? '-' : stats.creators}</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="text-sm font-medium text-slate-400 mb-2">Usuários Básicos</div>
                <div className="text-3xl font-bold text-slate-400">{loading ? '-' : stats.basics}</div>
            </div>
          </div>

          {/* Search & Actions Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar membros por nome, email ou papel..." 
                  className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-800 rounded-lg text-sm text-slate-200 focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600 transition-all focus:border-cyan-500"
              />
            </div>

            <Button 
              onClick={() => {
                if (!canManageTeam) {
                  alert(`Apenas usuários com perfil de Administrador podem convidar novos usuários.`);
                  return;
                }
                setShowModal(true);
              }} 
              disabled={!canManageTeam}
              className={`shadow-lg shadow-cyan-500/20 bg-slate-100 text-slate-900 hover:bg-white hover:text-black ${
                !canManageTeam ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Convidar Usuário
            </Button>
          </div>

          {/* Access Warning Banner for Non-Admins */}
          {!canManageTeam && (
            <div className="mb-6 p-4 rounded-xl bg-amber-950/40 border border-amber-800/40 text-sm text-amber-300 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 animate-pulse" />
              <p>
                <strong>Modo de Leitura:</strong> Como <strong className="text-white">{getRoleName()}</strong>, você pode visualizar os membros e suas funções, mas não possui permissão para mudar papéis de acesso ou excluir usuários da organização.
              </p>
            </div>
          )}

          {/* Main Table Card */}
          <div className="bg-slate-900/30 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="p-6 border-b border-slate-800">
                <h3 className="text-lg font-bold text-white">Listagem de Membros</h3>
                <p className="text-sm text-slate-500 mt-1">Veja quem tem acesso a plataforma e atribua papéis conforme necessário.</p>
            </div>

            {loading ? (
                 <div className="flex flex-col items-center justify-center p-12">
                    <Loader2 className="h-8 w-8 animate-spin text-cyan-500 mb-3" />
                    <span className="text-sm text-slate-400">Carregando dados...</span>
               </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-800/50">
                                <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">Usuário</th>
                                <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">Email</th>
                                <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">Papel / Role</th>
                                <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider text-center">Status</th>
                                <th className="px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/30">
                            {filteredMembers.map((member) => (
                                <tr key={member.id} className="hover:bg-slate-800/20 transition-colors group">
                                    {/* User Info */}
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center gap-3">
                                            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-slate-850 flex items-center justify-center text-xs font-bold text-cyan-400 border border-slate-700 uppercase">
                                                {member.name.substring(0, 2)}
                                            </div>
                                            <span className="text-sm font-medium text-slate-200">{member.name}</span>
                                        </div>
                                    </td>
                                    
                                    {/* Email */}
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="text-sm text-slate-400">{member.email}</span>
                                    </td>

                                    {/* Role Selector */}
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {canManageTeam ? (
                                          <select
                                            value={member.role}
                                            onChange={(e) => handleRoleChange(member.id, e.target.value as any)}
                                            className="bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-300 py-1.5 px-3 outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 cursor-pointer w-48"
                                          >
                                            <option value="admin">Administrador (Admin)</option>
                                            <option value="creator">Criador de Conteúdo (Creator)</option>
                                            <option value="basic">Usuário Básico (Basic)</option>
                                          </select>
                                        ) : (
                                          <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${
                                            member.role === 'admin' 
                                              ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' 
                                              : member.role === 'creator'
                                              ? 'bg-violet-500/10 border-violet-500/20 text-violet-400'
                                              : 'bg-slate-800 border-slate-700 text-slate-400'
                                          }`}>
                                            {member.role === 'admin' ? 'Administrador' : member.role === 'creator' ? 'Criador de Conteúdo' : 'Usuário Básico'}
                                          </span>
                                        )}
                                    </td>

                                    {/* Status */}
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                        {getStatusBadge(member.status)}
                                    </td>

                                    {/* Actions */}
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                        <button 
                                          disabled={!canManageTeam}
                                          onClick={() => handleRemoveMember(member.id)}
                                          className={`p-2 rounded-lg text-slate-500 hover:bg-slate-800 hover:text-red-400 transition-colors ${
                                            !canManageTeam ? 'opacity-30 cursor-not-allowed' : ''
                                          }`}
                                          title={canManageTeam ? "Excluir Membro" : "Apenas Admin pode excluir"}
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
          </div>
        </>
      ) : (
        /* Permissions Matrix View */
        <div className="space-y-6">
          <div className="bg-slate-900/30 border border-slate-800 rounded-xl p-6">
            <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
              <Shield className="w-5 h-5 text-cyan-500" />
              Matriz Geral de Roles & Regras do Sistema
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-6">
              A tabela abaixo resume detalhadamente o perfil e as permissões de cada nível de acesso da plataforma Viver de IA. 
              Mude o seu papel simulado no topo da tela para ver essas regras agindo interativamente no painel.
            </p>

            <div className="overflow-x-auto border border-slate-800/80 rounded-xl bg-slate-950/40">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 font-mono text-xs uppercase text-slate-400">
                    <th className="px-6 py-4 font-bold tracking-wider">Ação / Módulo</th>
                    <th className="px-6 py-4 font-bold tracking-wider">Definição</th>
                    <th className="px-6 py-4 font-bold tracking-wider text-center">Administrador</th>
                    <th className="px-6 py-4 font-bold tracking-wider text-center">Criador de Conteúdo</th>
                    <th className="px-6 py-4 font-bold tracking-wider text-center">Usuário Básico</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {permissionsMatrix.map((item) => (
                    <tr key={item.action} className="hover:bg-slate-900/10 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-200 whitespace-nowrap">
                        <span className="text-sm font-semibold">{item.module}</span>
                      </td>
                      <td className="px-6 py-4 max-w-sm text-xs text-slate-400 leading-relaxed">
                        {item.description}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex justify-center">
                          {item.admin ? (
                            <span className="p-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400" title="Ativo">
                              <Check className="w-4 h-4" />
                            </span>
                          ) : (
                            <span className="p-1 rounded-full bg-slate-800 text-slate-600" title="Inativo">
                              <X className="w-4 h-4" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex justify-center">
                          {item.creator ? (
                            <span className="p-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400" title="Ativo">
                              <Check className="w-4 h-4" />
                            </span>
                          ) : (
                            <span className="p-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500" title="Revogado">
                              <Lock className="w-4 h-4" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex justify-center">
                          {item.basic ? (
                            <span className="p-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" title="Ativo">
                              <Check className="w-4 h-4" />
                            </span>
                          ) : (
                            <span className="p-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500" title="Revogado">
                              <Lock className="w-4 h-4" />
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Quick Cards of Profiles */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 relative overflow-hidden">
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono tracking-widest bg-cyan-500/10 border border-cyan-500/25 text-cyan-400">
                  Total
                </div>
                <h4 className="text-white font-bold text-sm mb-2">1. Administrador (Admin)</h4>
                <p className="text-xs text-slate-400 leading-normal mb-3">
                  Permissões extensivas para manutenção geral. Controla conexões WhatsApp, edita endpoints do backend de automações, ajusta webhooks e recruta equipe.
                </p>
                <div className="flex items-center gap-1.5 text-[11px] text-cyan-400 font-bold">
                  <Unlock className="w-3.5 h-3.5" /> Administra Completamente
                </div>
              </div>

              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 relative overflow-hidden">
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono tracking-widest bg-violet-500/10 border border-violet-500/25 text-violet-400">
                  Parcial
                </div>
                <h4 className="text-white font-bold text-sm mb-2">2. Criador de Conteúdo (Creator)</h4>
                <p className="text-xs text-slate-400 leading-normal mb-3">
                  Atua diretamente na gestão operacional e de relacionamento. Gerencia fluxo de vendas, agendamentos, pipeline, canais de chat, e consulta especificações de códigos.
                </p>
                <div className="flex items-center gap-1.5 text-[11px] text-violet-400 font-bold">
                  <Unlock className="w-3.5 h-3.5" /> Edição de CRM, Chats & Agenda
                </div>
              </div>

              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 relative overflow-hidden">
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono tracking-widest bg-slate-800 border border-slate-700 text-slate-400">
                  Leitura
                </div>
                <h4 className="text-white font-bold text-sm mb-2">3. Usuário Básico (Basic)</h4>
                <p className="text-xs text-slate-400 leading-normal mb-3">
                  Acesso essencial focado em acompanhamento. Monitora o chat de suporte e dashboards de faturamento, sem autoridade para agendar novos compromissos ou mover pipelines.
                </p>
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-bold">
                  <Lock className="w-3.5 h-3.5" /> Leitura do Chat & Dashboard
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                    <h3 className="text-lg font-bold text-white">Convidar para a Equipe</h3>
                    <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <form onSubmit={handleInvite} className="p-6 space-y-4 bg-slate-900/40">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Nome Completo</label>
                        <input 
                            required
                            type="text" 
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none transition-all placeholder:text-slate-700 focus:border-cyan-500"
                            placeholder="Ex: João da Silva"
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Email Corporativo</label>
                        <input 
                            required
                            type="email" 
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none transition-all placeholder:text-slate-700 focus:border-cyan-500"
                            placeholder="joao@viverdeia.com"
                            value={formData.email}
                            onChange={(e) => setFormData({...formData, email: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300">Nível de Acesso</label>
                        <div className="grid grid-cols-3 gap-2">
                            {['basic', 'creator', 'admin'].map((role) => (
                                <div 
                                    key={role}
                                    onClick={() => setFormData({...formData, role})}
                                    className={`cursor-pointer rounded-lg border p-2 text-center transition-all ${
                                        formData.role === role 
                                        ? 'bg-slate-800 border-slate-500 text-white' 
                                        : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                                    }`}
                                >
                                    <div className="text-[10px] font-bold uppercase mb-1">
                                      {role === 'basic' ? 'Básico' : role === 'creator' ? 'Criador' : 'Admin'}
                                    </div>
                                    {formData.role === role && <div className="flex justify-center"><Check className="w-3 h-3 text-cyan-400" /></div>}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="pt-4 flex gap-3">
                        <Button type="button" variant="ghost" onClick={() => setShowModal(false)} className="flex-1 border border-slate-700 hover:bg-slate-800">Cancelar</Button>
                        <Button type="submit" className="flex-1 bg-white text-black hover:bg-slate-200">Enviar Convite</Button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};

export default Team;
