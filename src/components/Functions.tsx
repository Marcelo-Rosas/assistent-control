import React, { useState } from 'react';
import { Copy, Terminal, CheckCircle2, Circle, Database, Zap, Share2, ClipboardList, Plus, Edit, Trash2, X, Save, ShieldAlert } from 'lucide-react';
import { Button } from './Button';
import { MOCK_BACKEND_FUNCTIONS } from '../constants';
import { BackendFunction } from '../types';
import { useRoles } from '../context/RoleContext';

const Functions: React.FC = () => {
  const [functions, setFunctions] = useState<BackendFunction[]>(MOCK_BACKEND_FUNCTIONS);
  const [filter, setFilter] = useState<'all' | 'core' | 'ai' | 'integration'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { currentRole, getRoleName, hasPermission } = useRoles();

  const canEdit = hasPermission('edit_functions'); // true for admin
  const canView = currentRole !== 'basic'; // true for admin & creator

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<any[]>(() => {
    const saved = localStorage.getItem('viver_de_ia_audit_logs');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    const defaultLogs = [
      {
        id: 'log_1',
        userName: 'Admin User',
        userRole: 'Administrador',
        action: 'update',
        targetName: 'Send Whatsapp Template',
        targetType: 'webhook',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        details: 'Atualizou a função "Send Whatsapp Template" (POST): código-fonte atualizado, rota alterada para /api/v1/messages/send-template'
      },
      {
        id: 'log_2',
        userName: 'Admin User',
        userRole: 'Administrador',
        action: 'create',
        targetName: 'Evolution Message Callback',
        targetType: 'webhook',
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        details: 'Criou o receptor webhook "Evolution Message Callback" (WEBHOOK /api/v1/callback/evolution) para ouvir mensagens de WhatsApp recebidas'
      },
      {
        id: 'log_3',
        userName: 'Admin User',
        userRole: 'Administrador',
        action: 'update',
        targetName: 'Auth System Login',
        targetType: 'function',
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        details: 'Atualizou a função "Auth System Login" (POST): alterou status de "Em Desenvolvimento" para "Concluído"'
      }
    ];
    localStorage.setItem('viver_de_ia_audit_logs', JSON.stringify(defaultLogs));
    return defaultLogs;
  });

  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logActionFilter, setLogActionFilter] = useState<'all' | 'create' | 'update' | 'delete'>('all');

  const addAuditLog = (action: 'create' | 'update' | 'delete', fn: BackendFunction, original?: BackendFunction) => {
    const logUser = currentRole === 'admin' ? 'Admin User' : currentRole === 'creator' ? 'Sarah Connor' : 'John Doe';
    const roleName = getRoleName();
    
    let details = '';
    if (action === 'create') {
      details = `Criou a função "${fn.name}" (${fn.method} ${fn.route}) com categoria ${fn.category}`;
    } else if (action === 'update' && original) {
      const changes: string[] = [];
      if (original.name !== fn.name) changes.push(`nome alterado de "${original.name}" para "${fn.name}"`);
      if (original.route !== fn.route) changes.push(`rota alterada de "${original.route}" para "${fn.route}"`);
      if (original.method !== fn.method) changes.push(`método alterado de "${original.method}" para "${fn.method}"`);
      if (original.status !== fn.status) changes.push(`status alterado de "${original.status}" para "${fn.status}"`);
      if (original.code !== fn.code) changes.push(`código-fonte atualizado`);
      
      details = `Atualizou a função "${fn.name}" (${fn.method}): ${changes.length > 0 ? changes.join(', ') : 'sem alterações de conteúdo'}`;
    } else if (action === 'delete') {
      details = `Excluiu a função "${fn.name}" (${fn.method} ${fn.route})`;
    }

    const newLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userName: logUser,
      userRole: roleName,
      action,
      targetName: fn.name,
      targetType: fn.method === 'WEBHOOK' ? 'webhook' : 'function',
      timestamp: new Date().toISOString(),
      details
    };

    const updatedLogs = [newLog, ...auditLogs];
    setAuditLogs(updatedLogs);
    localStorage.setItem('viver_de_ia_audit_logs', JSON.stringify(updatedLogs));
  };

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFunction, setEditingFunction] = useState<Partial<BackendFunction>>({});

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAll = () => {
    const allCode = functions.map(fn => 
      `### ${fn.name} (${fn.method} ${fn.route})\n${fn.description}\n\n\`\`\`javascript\n${fn.code}\n\`\`\`\n`
    ).join('\n---\n\n');
    handleCopy(allCode, 'all');
  };

  const filteredFunctions = functions.filter(
    fn => filter === 'all' || fn.category === filter
  );

  const handleDelete = (id: string) => {
    if (!canEdit) return;
    const fnToDelete = functions.find(f => f.id === id);
    if (!fnToDelete) return;
    if (confirm('Tem certeza que deseja excluir esta função?')) {
      addAuditLog('delete', fnToDelete);
      setFunctions(functions.filter(f => f.id !== id));
    }
  };

  const handleEdit = (fn: BackendFunction) => {
    if (!canEdit) return;
    setEditingFunction(fn);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    if (!canEdit) return;
    setEditingFunction({
      id: '',
      name: '',
      method: 'GET',
      route: '/api/v1/...',
      description: '',
      category: 'core',
      status: 'pending',
      code: '// Escreva sua lógica aqui...'
    });
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    if (editingFunction.id) {
      // Edit existing
      const original = functions.find(f => f.id === editingFunction.id);
      addAuditLog('update', editingFunction as BackendFunction, original);
      setFunctions(functions.map(f => f.id === editingFunction.id ? editingFunction as BackendFunction : f));
    } else {
      // Create new
      const newFunction = {
        ...editingFunction,
        id: Date.now().toString(),
      } as BackendFunction;
      addAuditLog('create', newFunction);
      setFunctions([...functions, newFunction]);
    }
    setIsModalOpen(false);
  };

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10';
      case 'POST': return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
      case 'PUT': return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
      case 'DELETE': return 'text-red-400 border-red-500/30 bg-red-500/10';
      case 'WEBHOOK': return 'text-violet-400 border-violet-500/30 bg-violet-500/10';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto bg-slate-950 text-slate-50 custom-scrollbar relative">
      {/* Dynamic Restricted Access Overlay for Basic Users */}
      {!canView && (
        <div className="absolute inset-x-0 inset-y-0 z-40 bg-slate-950/85 backdrop-blur-[6px] p-8 flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-full mb-6 animate-pulse">
            <ShieldAlert className="w-12 h-12 text-red-100" />
          </div>
          <h3 className="text-2xl font-bold text-white tracking-tight mb-2">Acesso Bloqueado: Funções e Blueprints</h3>
          <p className="text-sm text-slate-400 max-w-md leading-relaxed mb-6">
            Seu nível de acesso atual como <strong className="text-red-400 font-semibold">{getRoleName()}</strong> impede a visualização ou alteração de funções e webhooks de automação de backend.
          </p>
          
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md text-left text-xs divide-y divide-slate-800">
            <p className="font-bold text-slate-400 uppercase tracking-wider pb-3">Ações por Papel de Usuário:</p>
            <div className="py-2 flex justify-between">
              <span className="text-slate-400">Criar/Editar Código Webhook:</span>
              <span className="text-cyan-400 font-bold">Apenas Administrador</span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-slate-400">Visualizar/Copiar Código:</span>
              <span className="text-violet-400 font-bold">Criador de Conteúdo & Admin</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Terminal className="w-8 h-8 text-cyan-500" />
            Backend Blueprints
          </h2>
          <p className="text-sm text-slate-400 mt-2 max-w-2xl">
            Painel de arquitetura do sistema. Gerencie e copie as funções para implementar a lógica no backend.
          </p>
        </div>
        <div className="flex gap-3">
            <Button 
              onClick={handleAddNew} 
              disabled={!canEdit}
              className={`shadow-lg shadow-cyan-500/20 ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <Plus className="w-4 h-4 mr-2" />
                Nova Função
            </Button>
            <Button onClick={handleCopyAll} variant="secondary" className="bg-slate-800 text-slate-300 hover:text-white border-slate-700">
            <ClipboardList className="w-4 h-4 mr-2" />
            {copiedId === 'all' ? 'Copiado!' : 'Copiar Tudo'}
            </Button>
        </div>
      </div>

      {/* Read-only notification banner for content creators */}
      {canView && !canEdit && (
        <div className="mb-6 p-4 rounded-xl bg-violet-950/40 border border-violet-800/40 text-sm text-violet-300 flex items-center gap-3 animate-in fade-in duration-300">
          <Terminal className="w-5 h-5 text-violet-400 flex-shrink-0 animate-pulse" />
          <p>
            <strong>Acesso de Leitura:</strong> Como <strong className="text-white">{getRoleName()}</strong>, você tem permissão para ler e copiar os Blueprints do sistema para alimentar materiais, mas não pode criar novas funções ou realizar alterações estruturais.
          </p>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        {['all', 'core', 'ai', 'integration'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize whitespace-nowrap ${
              filter === tab 
                ? 'bg-slate-800 text-white shadow-lg shadow-cyan-900/20 border border-slate-700' 
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900'
            }`}
          >
            {tab === 'all' ? 'Todos os Módulos' : tab}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-20">
        {filteredFunctions.map((fn) => (
          <div key={fn.id} className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-xl hover:border-slate-700 transition-all flex flex-col group/card">
            {/* Card Header */}
            <div className="p-5 border-b border-slate-800 bg-slate-900/80 flex justify-between items-start">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getMethodColor(fn.method)}`}>
                    {fn.method}
                  </span>
                  <span className="font-mono text-xs text-slate-400">{fn.route}</span>
                </div>
                <h3 className="text-lg font-bold text-white">{fn.name}</h3>
              </div>
              
              <div className="flex items-center gap-2">
                 {/* Action Buttons */}
                {canEdit && (
                  <div className="opacity-0 group-hover/card:opacity-100 transition-opacity flex gap-1 mr-2">
                      <button 
                          onClick={() => handleEdit(fn)} 
                          className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-cyan-400" 
                          title="Editar"
                      >
                          <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button 
                          onClick={() => handleDelete(fn.id)} 
                          className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-red-400" 
                          title="Excluir"
                      >
                          <Trash2 className="w-3.5 h-3.5" />
                      </button>
                  </div>
                )}
                {fn.category === 'ai' && <Zap className="w-4 h-4 text-amber-400" />}
                {fn.category === 'database' && <Database className="w-4 h-4 text-emerald-400" />}
                {fn.category === 'integration' && <Share2 className="w-4 h-4 text-violet-400" />}
              </div>
            </div>

            {/* Description */}
            <div className="px-5 py-4 bg-slate-900/30">
              <p className="text-sm text-slate-400 leading-relaxed">{fn.description}</p>
            </div>

            {/* Code Block */}
            <div className="relative flex-1 bg-slate-950 border-t border-b border-slate-800 group">
              <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <Button 
                  size="sm" 
                  variant="secondary" 
                  onClick={() => handleCopy(fn.code, fn.id)}
                  className="bg-slate-800 hover:bg-slate-700 text-xs h-8"
                >
                  {copiedId === fn.id ? <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
                  {copiedId === fn.id ? 'Copiado' : 'Copiar Code'}
                </Button>
              </div>
              <pre className="p-5 overflow-x-auto text-xs font-mono text-cyan-100/90 leading-loose custom-scrollbar">
                <code>{fn.code}</code>
              </pre>
            </div>

            {/* Footer Status */}
            <div className="p-3 bg-slate-900/80 flex justify-between items-center text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Status:</span>
                <span className={`flex items-center gap-1.5 font-medium ${
                  fn.status === 'completed' ? 'text-emerald-400' : 
                  fn.status === 'development' ? 'text-amber-400' : 'text-slate-500'
                }`}>
                  <Circle className={`w-2 h-2 fill-current`} />
                  {fn.status === 'completed' ? 'Completo' : fn.status === 'development' ? 'Em Desenvolvimento' : 'Pendente'}
                </span>
              </div>
              <span className="text-slate-600 font-mono text-[10px]">ID: {fn.id}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Audit Logs Section - Only visible to Administrator */}
      {currentRole === 'admin' && (
        <div className="mt-6 mb-16 p-6 rounded-2xl border border-slate-800 bg-slate-900/40 relative overflow-hidden shadow-2xl">
          {/* Decorative Security Background Icon */}
          <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
            <ClipboardList className="w-48 h-48 text-cyan-500" />
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-800 relative z-10">
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
                </span>
                Logs de Auditoria de Segurança
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                Registro de operações de sistema para fins de auditoria e conformidade. <strong className="text-cyan-400/90 font-semibold">Seção restrita visível apenas para administradores.</strong>
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              {/* Filter Action */}
              <select
                value={logActionFilter}
                onChange={(e) => setLogActionFilter(e.target.value as any)}
                className="bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 py-2 px-3 outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer h-9"
              >
                <option value="all">Todas as Ações</option>
                <option value="create">Criação</option>
                <option value="update">Modificação</option>
                <option value="delete">Exclusão</option>
              </select>

              {/* Log Search */}
              <input
                type="text"
                value={logSearchQuery}
                onChange={(e) => setLogSearchQuery(e.target.value)}
                placeholder="Buscar por nome ou mudança..."
                className="bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 py-2 px-3 outline-none focus:ring-1 focus:ring-cyan-500 placeholder:text-slate-600 w-52 h-9"
              />

              {/* Clear Logs Button */}
              <Button
                variant="ghost"
                onClick={() => {
                  if (confirm('Tem certeza de que deseja limpar completamente o histórico de logs de auditoria?')) {
                    setAuditLogs([]);
                    localStorage.setItem('viver_de_ia_audit_logs', JSON.stringify([]));
                  }
                }}
                className="text-xs text-red-400 hover:text-red-300 hover:bg-slate-800 border border-slate-800 hover:border-red-500/20 px-3 h-9"
              >
                Limpar Logs
              </Button>
            </div>
          </div>

          {/* Logs Timeline List */}
          <div className="space-y-4 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar relative z-10">
            {auditLogs.filter(log => {
              const matchesFilter = logActionFilter === 'all' || log.action === logActionFilter;
              const matchesSearch = log.targetName.toLowerCase().includes(logSearchQuery.toLowerCase()) || 
                                    log.details.toLowerCase().includes(logSearchQuery.toLowerCase()) ||
                                    log.userName.toLowerCase().includes(logSearchQuery.toLowerCase());
              return matchesFilter && matchesSearch;
            }).length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500">
                <ClipboardList className="w-12 h-12 text-slate-800 mb-2" />
                <p className="text-sm">Nenhum evento registrado com os filtros selecionados.</p>
              </div>
            ) : (
              auditLogs
                .filter(log => {
                  const matchesFilter = logActionFilter === 'all' || log.action === logActionFilter;
                  const matchesSearch = log.targetName.toLowerCase().includes(logSearchQuery.toLowerCase()) || 
                                        log.details.toLowerCase().includes(logSearchQuery.toLowerCase()) ||
                                        log.userName.toLowerCase().includes(logSearchQuery.toLowerCase());
                  return matchesFilter && matchesSearch;
                })
                .map((log) => (
                  <div key={log.id} className="relative pl-6 pb-2 border-l border-slate-800 last:border-0">
                    {/* Timeline Node Icon/Dot */}
                    <span className={`absolute -left-1.5 top-1.5 flex h-3 w-3 rounded-full border-2 ${
                      log.action === 'create' ? 'bg-emerald-500 border-slate-950' :
                      log.action === 'update' ? 'bg-cyan-500 border-slate-950' : 'bg-red-500 border-slate-950'
                    }`}></span>

                    <div className="bg-slate-950/40 hover:bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 p-4 rounded-xl transition-all shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="font-bold text-slate-200">{log.userName}</span>
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-400">
                            {log.userRole}
                          </span>
                          
                          <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                            log.action === 'create' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            log.action === 'update' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                            'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                            {log.action === 'create' ? 'Criou' : log.action === 'update' ? 'Modificou' : 'Excluiu'}
                          </span>
                        </div>

                        {/* Timestamp */}
                        <div className="text-[11px] text-slate-500 font-mono" title={new Date(log.timestamp).toLocaleString()}>
                          {new Date(log.timestamp).toLocaleString('pt-BR', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit', second: '2-digit'
                          })}
                        </div>
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed font-mono bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/40">
                        {log.details}
                      </p>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        {editingFunction.id ? <Edit className="w-5 h-5 text-cyan-500" /> : <Plus className="w-5 h-5 text-cyan-500" />}
                        {editingFunction.id ? 'Editar Função' : 'Nova Função'}
                    </h3>
                    <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                    <form id="functionForm" onSubmit={handleSave} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Nome da Função</label>
                                <input 
                                    required
                                    type="text" 
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600"
                                    placeholder="Ex: Process WhatsApp Message"
                                    value={editingFunction.name || ''}
                                    onChange={(e) => setEditingFunction({...editingFunction, name: e.target.value})}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Rota / Endpoint</label>
                                <input 
                                    required
                                    type="text" 
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none font-mono placeholder:text-slate-600"
                                    placeholder="Ex: /api/v1/messages"
                                    value={editingFunction.route || ''}
                                    onChange={(e) => setEditingFunction({...editingFunction, route: e.target.value})}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                             <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Método</label>
                                <select 
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                                    value={editingFunction.method || 'GET'}
                                    onChange={(e) => setEditingFunction({...editingFunction, method: e.target.value as any})}
                                >
                                    <option value="GET">GET</option>
                                    <option value="POST">POST</option>
                                    <option value="PUT">PUT</option>
                                    <option value="DELETE">DELETE</option>
                                    <option value="WEBHOOK">WEBHOOK</option>
                                </select>
                             </div>
                             <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Categoria</label>
                                <select 
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                                    value={editingFunction.category || 'core'}
                                    onChange={(e) => setEditingFunction({...editingFunction, category: e.target.value as any})}
                                >
                                    <option value="core">Core System</option>
                                    <option value="ai">AI / LLM</option>
                                    <option value="integration">Integration</option>
                                    <option value="database">Database</option>
                                </select>
                             </div>
                             <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Status</label>
                                <select 
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                                    value={editingFunction.status || 'pending'}
                                    onChange={(e) => setEditingFunction({...editingFunction, status: e.target.value as any})}
                                >
                                    <option value="pending">Pendente</option>
                                    <option value="development">Em Desenvolvimento</option>
                                    <option value="completed">Concluído</option>
                                </select>
                             </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Descrição</label>
                            <input 
                                required
                                type="text" 
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600"
                                placeholder="Descreva o que essa função faz..."
                                value={editingFunction.description || ''}
                                onChange={(e) => setEditingFunction({...editingFunction, description: e.target.value})}
                            />
                        </div>

                        <div className="space-y-2 flex-1 flex flex-col min-h-[300px]">
                            <label className="text-xs font-bold uppercase text-slate-500 tracking-wider flex justify-between">
                                Código / Lógica
                                <span className="text-[10px] font-normal lowercase opacity-70">javascript / pseudo-código</span>
                            </label>
                            <div className="flex-1 relative">
                                <textarea 
                                    required
                                    className="w-full h-full bg-[#0B0E14] border border-slate-800 rounded-lg p-4 text-sm font-mono text-cyan-100/90 focus:ring-1 focus:ring-cyan-500 outline-none resize-none leading-relaxed"
                                    spellCheck={false}
                                    placeholder="// Cole seu código aqui..."
                                    value={editingFunction.code || ''}
                                    onChange={(e) => setEditingFunction({...editingFunction, code: e.target.value})}
                                />
                            </div>
                        </div>
                    </form>
                </div>

                <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end gap-3">
                    <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)} className="border border-slate-700 hover:bg-slate-800 text-slate-300">
                        Cancelar
                    </Button>
                    <Button type="submit" form="functionForm" className="shadow-lg shadow-cyan-500/20 px-6">
                        <Save className="w-4 h-4 mr-2" />
                        Salvar Função
                    </Button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Functions;