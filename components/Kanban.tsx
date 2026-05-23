
import React, { useEffect, useState, useRef } from 'react';
import { 
  Plus, Search, MoreHorizontal, DollarSign, Loader2, CalendarClock, Tag, X, 
  Building, User, Calendar, ArrowRight, CheckCircle2, Circle, 
  FileText, Phone, Mail, Paperclip, Send, CheckSquare, Clock
} from 'lucide-react';
import { Button } from './Button';
import { api } from '../services/api';
import { Deal } from '../types';
import { MOCK_KANBAN_COLUMNS } from '../constants';

const Kanban: React.FC = () => {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [activeTab, setActiveTab] = useState<'note' | 'activity' | 'email'>('note');
  
  const dragItem = useRef<string | null>(null);

  useEffect(() => {
    const loadPipeline = async () => {
      try {
        const data = await api.fetchPipeline();
        setDeals(data);
      } catch (error) {
        console.error("Erro ao carregar pipeline", error);
      } finally {
        setLoading(false);
      }
    };
    loadPipeline();
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const onDragStart = (e: React.DragEvent, dealId: string) => {
    dragItem.current = dealId;
    e.dataTransfer.effectAllowed = "move";
    (e.target as HTMLElement).style.opacity = '0.5';
  };

  const onDragEnd = (e: React.DragEvent) => {
    dragItem.current = null;
    (e.target as HTMLElement).style.opacity = '1';
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    const dealId = dragItem.current;
    if (!dealId) return;

    const updatedDeals = deals.map(deal => {
      if (deal.id === dealId) {
        return { ...deal, stage: targetColumnId };
      }
      return deal;
    });

    setDeals(updatedDeals);
  };

  const filteredDeals = deals.filter(deal => 
    deal.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    deal.company.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getPriorityColor = (priority: string) => {
      switch(priority) {
          case 'high': return 'bg-red-500/10 text-red-400 border-red-500/20';
          case 'medium': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
          default: return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      }
  };

  // Mock Timeline Data Generator
  const getMockTimeline = (deal: Deal) => [
    { id: 1, type: 'planned', icon: CheckSquare, title: 'Follow-up Call', date: 'Amanhã, 14:00', done: false },
    { id: 2, type: 'note', icon: FileText, title: 'Nota adicionada', date: 'Hoje, 10:23', content: 'Cliente pediu para revisar o valor da proposta inicial. Possível desconto de 5% se fechar este mês.' },
    { id: 3, type: 'stage', icon: ArrowRight, title: 'Moveu para Apresentação', date: 'Ontem, 16:45', content: 'De: Qualificação Para: Apresentação' },
    { id: 4, type: 'email', icon: Mail, title: 'Email enviado', date: 'Ontem, 09:30', content: 'Assunto: Proposta Comercial v1.pdf' },
    { id: 5, type: 'call', icon: Phone, title: 'Ligação realizada', date: 'Seg, 15:00', content: 'Duração: 12min. Discussão sobre requisitos técnicos.' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-50 p-6 overflow-hidden relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4 flex-shrink-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Pipeline de Vendas</h2>
          <p className="text-sm text-slate-400 mt-1">Gerencie oportunidades e acompanhe o fluxo de receita.</p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
             <input 
                type="text" 
                placeholder="Buscar oportunidade..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600"
             />
          </div>
          <Button className="shadow-lg shadow-cyan-500/20">
            <Plus className="w-4 h-4 mr-2" />
            Novo Deal
          </Button>
        </div>
      </div>

      {/* Board Scroll Container */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
        <div className="flex h-full gap-4 min-w-max">
          {MOCK_KANBAN_COLUMNS.map((column) => {
            const columnDeals = filteredDeals.filter(d => d.stage === column.id);
            const totalValue = columnDeals.reduce((acc, curr) => acc + curr.value, 0);

            return (
              <div 
                key={column.id}
                className="w-72 flex flex-col h-full bg-slate-900/30 rounded-xl border border-slate-800/50 backdrop-blur-sm"
                onDragOver={onDragOver}
                onDrop={(e) => onDrop(e, column.id)}
              >
                {/* Column Header */}
                <div className={`p-3 border-b border-slate-800/50 flex flex-col gap-1 border-t-2 ${column.color}`}>
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wide">{column.title}</h3>
                    <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded-full font-mono">{columnDeals.length}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium">
                     Total: <span className="text-slate-300">{formatCurrency(totalValue)}</span>
                  </div>
                </div>

                {/* Column Body */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                  {columnDeals.map((deal) => (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, deal.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => setSelectedDeal(deal)}
                      className="bg-slate-900 border border-slate-800 rounded-lg p-3 shadow-sm cursor-grab active:cursor-grabbing hover:border-cyan-500/50 hover:shadow-cyan-500/10 transition-all group relative"
                    >
                      <div className="flex justify-between items-start mb-1.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${getPriorityColor(deal.priority)}`}>
                           {deal.priority === 'high' ? 'Alta' : deal.priority === 'medium' ? 'Média' : 'Baixa'}
                        </span>
                        <button className="text-slate-600 hover:text-white transition-colors opacity-0 group-hover:opacity-100">
                           <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <h4 className="font-semibold text-white text-sm mb-0.5 leading-tight">{deal.title}</h4>
                      <p className="text-[10px] text-slate-400 mb-2">{deal.company}</p>

                      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                         {deal.tags.map(tag => (
                             <span key={tag} className="text-[9px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <Tag className="w-2.5 h-2.5" /> {tag}
                             </span>
                         ))}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                         <div className="flex items-center gap-1.5 text-slate-300 text-xs font-bold">
                            <DollarSign className="w-3 h-3 text-emerald-500" />
                            {formatCurrency(deal.value)}
                         </div>
                         <div className="flex items-center gap-2">
                            {deal.dueDate && (
                                <div className="text-[9px] text-slate-500 flex items-center gap-1" title="Data de previsão">
                                    <CalendarClock className="w-3 h-3" />
                                    {new Date(deal.dueDate).toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})}
                                </div>
                            )}
                            <img src={deal.ownerAvatar} alt="Owner" className="w-5 h-5 rounded-full border border-slate-700" />
                         </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pipedrive-style Side Drawer */}
      {/* Backdrop */}
      {selectedDeal && (
        <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setSelectedDeal(null)}
        />
      )}

      {/* Drawer */}
      <div 
        className={`fixed top-0 right-0 h-full w-full max-w-2xl bg-slate-950 border-l border-slate-800 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${selectedDeal ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {selectedDeal && (
            <>
                {/* 1. Header & Stage Progress */}
                <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800">
                    {/* Top Bar */}
                    <div className="p-6 pb-4 flex justify-between items-start">
                        <div>
                            <h2 className="text-2xl font-bold text-white mb-1">{selectedDeal.title}</h2>
                            <div className="flex items-center gap-2 text-slate-400 text-sm">
                                <span className="font-semibold text-emerald-400">{formatCurrency(selectedDeal.value)}</span>
                                <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                                <span className="flex items-center gap-1"><Building className="w-3 h-3" /> {selectedDeal.company}</span>
                                <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                                <span className="flex items-center gap-1"><User className="w-3 h-3" /> Carlos (Lead)</span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="secondary" className="bg-slate-800 border-slate-700 text-slate-300">Ganho</Button>
                            <Button variant="secondary" className="bg-slate-800 border-slate-700 text-slate-300">Perdido</Button>
                            <button 
                                onClick={() => setSelectedDeal(null)} 
                                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                    </div>

                    {/* Pipeline Visual Progress */}
                    <div className="px-6 pb-6 overflow-x-auto">
                        <div className="flex items-center gap-1 w-full min-w-max">
                            {MOCK_KANBAN_COLUMNS.map((col, idx) => {
                                const currentStageIndex = MOCK_KANBAN_COLUMNS.findIndex(c => c.id === selectedDeal.stage);
                                const isCompleted = idx < currentStageIndex;
                                const isActive = idx === currentStageIndex;
                                
                                return (
                                    <div 
                                        key={col.id} 
                                        className={`flex-1 h-8 flex items-center justify-center px-2 relative cursor-pointer group transition-all first:rounded-l-md last:rounded-r-md 
                                            ${isCompleted ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 
                                              isActive ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' : 
                                              'bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300'}
                                        `}
                                        onClick={() => {
                                            // Optimistic update for UI feel
                                            setDeals(deals.map(d => d.id === selectedDeal.id ? {...d, stage: col.id} : d));
                                            setSelectedDeal({...selectedDeal, stage: col.id});
                                        }}
                                    >
                                        <span className="text-xs font-bold whitespace-nowrap z-10">{col.title}</span>
                                        {/* Arrow shape via clip-path could go here, simplified with simple blocks for now */}
                                        {idx !== MOCK_KANBAN_COLUMNS.length - 1 && (
                                            <div className="absolute right-0 top-0 bottom-0 w-[1px] bg-slate-950/20 z-20"></div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {/* 2. Content Area */}
                <div className="flex-1 overflow-y-auto bg-slate-950 custom-scrollbar">
                    
                    {/* Action Composer */}
                    <div className="p-6 border-b border-slate-800 bg-slate-900/30">
                        <div className="flex gap-4 mb-4">
                            <button 
                                onClick={() => setActiveTab('note')}
                                className={`flex items-center gap-2 text-sm font-medium transition-colors ${activeTab === 'note' ? 'text-cyan-400' : 'text-slate-400 hover:text-white'}`}
                            >
                                <div className={`p-2 rounded-full ${activeTab === 'note' ? 'bg-cyan-500/10' : 'bg-slate-800'}`}>
                                    <FileText className="w-4 h-4" />
                                </div>
                                Nota
                            </button>
                            <button 
                                onClick={() => setActiveTab('activity')}
                                className={`flex items-center gap-2 text-sm font-medium transition-colors ${activeTab === 'activity' ? 'text-amber-400' : 'text-slate-400 hover:text-white'}`}
                            >
                                <div className={`p-2 rounded-full ${activeTab === 'activity' ? 'bg-amber-500/10' : 'bg-slate-800'}`}>
                                    <Calendar className="w-4 h-4" />
                                </div>
                                Atividade
                            </button>
                            <button 
                                onClick={() => setActiveTab('email')}
                                className={`flex items-center gap-2 text-sm font-medium transition-colors ${activeTab === 'email' ? 'text-violet-400' : 'text-slate-400 hover:text-white'}`}
                            >
                                <div className={`p-2 rounded-full ${activeTab === 'email' ? 'bg-violet-500/10' : 'bg-slate-800'}`}>
                                    <Mail className="w-4 h-4" />
                                </div>
                                Email
                            </button>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden focus-within:ring-1 focus-within:ring-cyan-500/50 transition-all shadow-inner">
                            <textarea 
                                className="w-full bg-transparent p-4 text-sm text-slate-200 placeholder:text-slate-600 outline-none resize-none min-h-[80px]"
                                placeholder={
                                    activeTab === 'note' ? "Escreva uma nota..." :
                                    activeTab === 'activity' ? "Descreva a atividade..." :
                                    "Escreva o corpo do email..."
                                }
                            />
                            <div className="px-3 py-2 bg-slate-950/50 border-t border-slate-800 flex justify-between items-center">
                                <div className="flex gap-2">
                                    <button className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-cyan-400 transition-colors"><Paperclip className="w-4 h-4" /></button>
                                </div>
                                <Button size="sm" className="h-8">
                                    {activeTab === 'email' ? 'Enviar Email' : 'Salvar'}
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Timeline & Planned */}
                    <div className="p-6">
                        
                        {/* Planned Section */}
                        <div className="mb-8">
                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <Clock className="w-3.5 h-3.5" /> Planejado
                            </h4>
                            <div className="space-y-3">
                                {getMockTimeline(selectedDeal).filter(t => t.type === 'planned').map(item => (
                                    <div key={item.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all group">
                                        <button className="mt-0.5 text-slate-500 hover:text-emerald-500 transition-colors">
                                            <Circle className="w-5 h-5" />
                                        </button>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">{item.title}</p>
                                            <p className="text-xs text-slate-500">{item.date}</p>
                                        </div>
                                        <div className="p-1 bg-amber-500/10 text-amber-500 rounded text-[10px] font-bold uppercase">
                                            Call
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* History Section */}
                        <div className="relative">
                             <div className="absolute left-4 top-2 bottom-0 w-px bg-slate-800"></div>
                             
                             <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-6 pl-10">Histórico</h4>

                             <div className="space-y-8">
                                {getMockTimeline(selectedDeal).filter(t => t.type !== 'planned').map(item => (
                                    <div key={item.id} className="relative pl-10 group">
                                        {/* Timeline Icon */}
                                        <div className={`absolute left-0 top-0 w-8 h-8 rounded-full border-4 border-slate-950 flex items-center justify-center z-10
                                            ${item.type === 'stage' ? 'bg-cyan-500 text-white' : 
                                              item.type === 'email' ? 'bg-violet-500 text-white' : 
                                              item.type === 'call' ? 'bg-amber-500 text-white' : 
                                              'bg-slate-700 text-slate-300'}
                                        `}>
                                            <item.icon className="w-3.5 h-3.5" />
                                        </div>

                                        {/* Content Card */}
                                        <div>
                                            <div className="flex items-baseline justify-between mb-1">
                                                <span className="text-sm font-bold text-slate-200">{item.title}</span>
                                                <span className="text-xs text-slate-600">{item.date}</span>
                                            </div>
                                            <div className="text-sm text-slate-400 bg-slate-900/50 p-3 rounded-lg border border-slate-800/50 group-hover:border-slate-700 transition-colors">
                                                {item.content}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                             </div>
                        </div>

                        <div className="mt-8 text-center">
                            <button className="text-xs text-slate-500 hover:text-cyan-400 transition-colors font-medium">Ver histórico completo</button>
                        </div>

                    </div>
                </div>
            </>
        )}
      </div>
    </div>
  );
};

export default Kanban;
