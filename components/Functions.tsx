
import React, { useState } from 'react';
import { Copy, Terminal, CheckCircle2, Circle, Database, Zap, Share2, ClipboardList, Plus, Edit, Trash2, X, Save } from 'lucide-react';
import { Button } from './Button';
import { MOCK_BACKEND_FUNCTIONS } from '../constants';
import { BackendFunction } from '../types';

const Functions: React.FC = () => {
  const [functions, setFunctions] = useState<BackendFunction[]>(MOCK_BACKEND_FUNCTIONS);
  const [filter, setFilter] = useState<'all' | 'core' | 'ai' | 'integration'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    if (confirm('Tem certeza que deseja excluir esta função?')) {
      setFunctions(functions.filter(f => f.id !== id));
    }
  };

  const handleEdit = (fn: BackendFunction) => {
    setEditingFunction(fn);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
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
    if (editingFunction.id) {
      // Edit existing
      setFunctions(functions.map(f => f.id === editingFunction.id ? editingFunction as BackendFunction : f));
    } else {
      // Create new
      const newFunction = {
        ...editingFunction,
        id: Date.now().toString(),
      } as BackendFunction;
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
            <Button onClick={handleAddNew} className="shadow-lg shadow-cyan-500/20">
                <Plus className="w-4 h-4 mr-2" />
                Nova Função
            </Button>
            <Button onClick={handleCopyAll} variant="secondary" className="bg-slate-800 text-slate-300 hover:text-white border-slate-700">
            <ClipboardList className="w-4 h-4 mr-2" />
            {copiedId === 'all' ? 'Copiado!' : 'Copiar Tudo'}
            </Button>
        </div>
      </div>

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
