import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, Clock, AlignLeft, X, Loader2, LayoutGrid, List, Columns, Video, User, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { Appointment } from '../types';
import { api } from '../services/api';
import { useRoles } from '../context/RoleContext';

type ViewMode = 'month' | 'week' | 'day';

const Scheduling: React.FC = () => {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentRole, getRoleName, hasPermission } = useRoles();
  const canEdit = hasPermission('edit_scheduling'); // true for admin & creator
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    title: '',
    time: '09:00',
    type: 'demo',
    description: ''
  });

  useEffect(() => {
    const loadAppointments = async () => {
      try {
        const data = await api.fetchAppointments();
        setAppointments(data);
      } catch (error) {
        console.error("Erro ao carregar agendamentos", error);
      } finally {
        setLoading(false);
      }
    };
    loadAppointments();
  }, []);

  // Navigation Logic
  const navigateDate = (direction: number) => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
        newDate.setMonth(newDate.getMonth() + direction);
    } else if (viewMode === 'week') {
        newDate.setDate(newDate.getDate() + (direction * 7));
    } else {
        newDate.setDate(newDate.getDate() + direction);
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => setCurrentDate(new Date());

  // Date Formatters
  const getMonthLabel = () => currentDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  const getDayLabel = () => currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const getWeekLabel = () => {
     const start = getStartOfWeek(currentDate);
     const end = new Date(start);
     end.setDate(end.getDate() + 6);
     return `${start.getDate()} ${start.toLocaleString('pt-BR', { month: 'short' })} - ${end.getDate()} ${end.toLocaleString('pt-BR', { month: 'short' })}`;
  };

  // Helper: Get Start of Week (Sunday)
  const getStartOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  };

  // Helper: Get Days in Month
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  // Helper: Format Date YYYY-MM-DD
  const formatDateStr = (date: Date) => date.toISOString().split('T')[0];

  const handleDateClick = (day: number) => {
    if (!canEdit) return;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(dateStr);
    setShowCreateModal(true);
  };
  
  const handleSlotClick = (dateStr: string, time?: string) => {
      if (!canEdit) return;
      setSelectedDate(dateStr);
      if(time) setFormData(prev => ({ ...prev, time }));
      setShowCreateModal(true);
  };

  const handleAppointmentClick = (app: Appointment, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedAppointment(app);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate) return;

    const newAppointment: Appointment = {
      id: Date.now().toString(),
      title: formData.title,
      date: selectedDate,
      time: formData.time,
      duration: 60,
      type: formData.type as any,
      description: formData.description
    };

    setAppointments([...appointments, newAppointment]);
    setShowCreateModal(false);
    setFormData({ title: '', time: '09:00', type: 'demo', description: '' });
  };

  const getEventTypeColor = (type: string) => {
    switch (type) {
        case 'demo': return 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20 hover:bg-cyan-500/20';
        case 'meeting': return 'bg-violet-500/10 text-violet-300 border-violet-500/20 hover:bg-violet-500/20';
        case 'support': return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20';
        case 'followup': return 'bg-orange-500/10 text-orange-300 border-orange-500/20 hover:bg-orange-500/20';
        default: return 'bg-slate-700 text-slate-300 border-slate-600';
    }
  };

  // --- RENDERERS ---

  const renderMonthView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const days = daysInMonth(year, month);
    const firstDay = firstDayOfMonth(year, month);

    return (
        <div className="grid grid-cols-7 flex-1 auto-rows-fr">
            {Array.from({ length: firstDay }).map((_, index) => (
                <div key={`empty-${index}`} className="border-b border-r border-slate-800/50 bg-slate-950/30 min-h-[100px]" />
            ))}
            {Array.from({ length: days }).map((_, index) => {
                const day = index + 1;
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayAppointments = appointments.filter(a => a.date === dateStr);
                const isToday = formatDateStr(new Date()) === dateStr;

                return (
                    <div 
                        key={day} 
                        onClick={() => handleDateClick(day)}
                        className={`border-b border-r border-slate-800/50 p-2 min-h-[120px] cursor-pointer transition-colors hover:bg-slate-800/30 group relative ${isToday ? 'bg-cyan-950/10' : ''}`}
                    >
                        <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full mb-2 ${isToday ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/40' : 'text-slate-400 group-hover:text-white'}`}>
                            {day}
                        </span>
                        <div className="space-y-1">
                            {dayAppointments.map(app => (
                                <div 
                                    key={app.id} 
                                    className={`text-[10px] px-2 py-1 rounded border truncate font-medium cursor-pointer ${getEventTypeColor(app.type)}`}
                                    onClick={(e) => handleAppointmentClick(app, e)}
                                >
                                    {app.time} - {app.title}
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
             {/* Fill remaining cells to keep grid structure */}
             {Array.from({ length: 42 - (days + firstDay) }).map((_, index) => (
                <div key={`remaining-${index}`} className="border-b border-r border-slate-800/50 bg-slate-950/30" />
            ))}
        </div>
    );
  };

  const renderWeekView = () => {
    const startOfWeek = getStartOfWeek(currentDate);
    const weekDays = Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(startOfWeek);
        d.setDate(d.getDate() + i);
        return d;
    });
    const hours = Array.from({ length: 14 }).map((_, i) => i + 6); // 06:00 to 19:00

    return (
        <div className="flex flex-col flex-1 overflow-y-auto custom-scrollbar bg-slate-900/30">
            {/* Header Row */}
            <div className="grid grid-cols-8 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
                <div className="p-4 text-xs font-medium text-slate-500 border-r border-slate-800">GMT-3</div>
                {weekDays.map((day, i) => {
                     const isToday = formatDateStr(new Date()) === formatDateStr(day);
                     return (
                        <div key={i} className={`p-2 text-center border-r border-slate-800/50 ${isToday ? 'bg-cyan-950/20' : ''}`}>
                            <div className={`text-xs uppercase font-semibold ${isToday ? 'text-cyan-400' : 'text-slate-500'}`}>
                                {day.toLocaleDateString('pt-BR', { weekday: 'short' })}
                            </div>
                            <div className={`text-xl font-bold ${isToday ? 'text-cyan-500' : 'text-slate-300'}`}>
                                {day.getDate()}
                            </div>
                        </div>
                     )
                })}
            </div>
            
            {/* Time Grid */}
            <div className="flex-1">
                {hours.map(hour => {
                    const timeStr = `${String(hour).padStart(2, '0')}:00`;
                    return (
                        <div key={hour} className="grid grid-cols-8 min-h-[80px]">
                            {/* Time Column */}
                            <div className="border-r border-b border-slate-800/50 p-2 text-xs text-slate-500 text-right sticky left-0 bg-slate-900/30">
                                {timeStr}
                            </div>
                            {/* Days Columns */}
                            {weekDays.map((day, i) => {
                                const dateStr = formatDateStr(day);
                                const isToday = formatDateStr(new Date()) === dateStr;
                                const apps = appointments.filter(a => {
                                    const appHour = parseInt(a.time.split(':')[0]);
                                    return a.date === dateStr && appHour === hour;
                                });

                                return (
                                    <div 
                                        key={i} 
                                        onClick={() => handleSlotClick(dateStr, timeStr)}
                                        className={`border-r border-b border-slate-800/50 relative p-1 transition-colors hover:bg-slate-800/20 group cursor-pointer ${isToday ? 'bg-cyan-950/5' : ''}`}
                                    >
                                        {/* Add Button on Hover */}
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
                                            <Plus className="w-4 h-4 text-slate-600" />
                                        </div>

                                        {apps.map(app => (
                                            <div 
                                                key={app.id} 
                                                className={`mb-1 p-2 rounded text-xs border cursor-pointer hover:brightness-110 relative z-10 shadow-sm ${getEventTypeColor(app.type)}`}
                                                onClick={(e) => handleAppointmentClick(app, e)} 
                                            >
                                                <div className="font-bold truncate">{app.title}</div>
                                                <div className="text-[10px] opacity-80">{app.time}</div>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    )
                })}
            </div>
        </div>
    );
  };

  const renderDayView = () => {
    const hours = Array.from({ length: 14 }).map((_, i) => i + 6); // 06:00 to 19:00
    const dateStr = formatDateStr(currentDate);

    return (
        <div className="flex flex-col flex-1 overflow-y-auto custom-scrollbar bg-slate-900/30">
             <div className="p-4 border-b border-slate-800 bg-slate-900 sticky top-0 z-10">
                <h3 className="text-xl font-bold text-white capitalize">{currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
             </div>
             
             <div className="flex-1 p-4">
                 {hours.map(hour => {
                    const timeStr = `${String(hour).padStart(2, '0')}:00`;
                    const apps = appointments.filter(a => {
                        const appHour = parseInt(a.time.split(':')[0]);
                        return a.date === dateStr && appHour === hour;
                    });

                    return (
                        <div key={hour} className="flex border-b border-slate-800/50 min-h-[100px] group hover:bg-slate-900/40 transition-colors">
                            <div className="w-20 py-4 pr-6 text-right text-sm font-medium text-slate-500 border-r border-slate-800/50">
                                {timeStr}
                            </div>
                            <div 
                                className="flex-1 p-2 relative cursor-pointer"
                                onClick={() => handleSlotClick(dateStr, timeStr)}
                            >
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-10 pointer-events-none">
                                    <Plus className="w-6 h-6 text-slate-700" />
                                </div>
                                {apps.map(app => (
                                    <div 
                                        key={app.id} 
                                        className={`mb-2 p-3 rounded-lg border flex justify-between items-center shadow-md relative z-10 cursor-pointer hover:brightness-110 ${getEventTypeColor(app.type)}`}
                                        onClick={(e) => handleAppointmentClick(app, e)}
                                    >
                                        <div>
                                            <div className="font-bold text-sm">{app.title}</div>
                                            <div className="text-xs opacity-80 mt-1">{app.description || 'Sem descrição'}</div>
                                        </div>
                                        <div className="text-right">
                                             <div className="font-mono text-sm">{app.time}</div>
                                             <div className="text-[10px] opacity-75 uppercase tracking-wider font-bold mt-1">{app.type}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )
                 })}
             </div>
        </div>
    );
  };

  return (
    <div className="p-6 h-full flex flex-col bg-slate-950 text-slate-50">
      {/* Header */}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between mb-6 gap-4">
        <div>
           <h2 className="text-3xl font-bold text-white flex items-center gap-2">
            <CalendarIcon className="w-8 h-8 text-cyan-500" />
            Agendamentos
           </h2>
           <p className="text-slate-400 text-sm mt-1">Gerencie demos, reuniões e suporte técnico.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full xl:w-auto">
            {/* View Switcher */}
            <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                <button 
                    onClick={() => setViewMode('month')} 
                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all ${viewMode === 'month' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <LayoutGrid className="w-3.5 h-3.5" /> Mês
                </button>
                <button 
                    onClick={() => setViewMode('week')} 
                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all ${viewMode === 'week' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <Columns className="w-3.5 h-3.5" /> Semana
                </button>
                <button 
                    onClick={() => setViewMode('day')} 
                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all ${viewMode === 'day' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <List className="w-3.5 h-3.5" /> Dia
                </button>
            </div>

            {/* Date Nav */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
                <button onClick={() => navigateDate(-1)} className="p-2 hover:bg-slate-800 rounded-md text-slate-400 hover:text-white transition-colors">
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="flex flex-col items-center justify-center w-48 px-2 cursor-pointer" onClick={goToToday} title="Ir para hoje">
                    <span className="text-sm font-bold text-slate-200 capitalize">
                        {viewMode === 'month' ? getMonthLabel() : viewMode === 'week' ? getWeekLabel() : getDayLabel()}
                    </span>
                    {viewMode === 'week' && <span className="text-[10px] text-slate-500">{currentDate.getFullYear()}</span>}
                </div>
                <button onClick={() => navigateDate(1)} className="p-2 hover:bg-slate-800 rounded-md text-slate-400 hover:text-white transition-colors">
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>

            <Button 
                onClick={() => { setSelectedDate(new Date().toISOString().split('T')[0]); setShowCreateModal(true); }}
                disabled={!canEdit}
                className={`${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <Plus className="w-4 h-4 mr-2" />
                Agendar
            </Button>
        </div>
      </div>

      {/* Access alert banner for non-editors (Basic User) */}
      {!canEdit && (
        <div className="mb-6 p-4 rounded-xl bg-amber-950/40 border border-amber-800/40 text-sm text-amber-300 flex items-center gap-3 flex-shrink-0 animate-in fade-in duration-300">
          <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0 animate-pulse" />
          <p>
            <strong>Acesso de Leitura:</strong> Como <strong className="text-white">{getRoleName()}</strong>, suas permissões de agendamento estão restritas. Você pode visualizar os compromissos, mas não pode criar ou reagendar reuniões.
          </p>
        </div>
      )}

      {/* Main Calendar Area */}
      <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col relative">
        {loading ? (
             <div className="flex-1 flex items-center justify-center">
                 <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
             </div>
        ) : (
            <>
                {viewMode === 'month' && (
                    <>
                        <div className="grid grid-cols-7 border-b border-slate-800 bg-slate-900">
                            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
                                <div key={day} className="py-3 text-center text-sm font-semibold text-slate-500 uppercase tracking-wider">
                                    {day}
                                </div>
                            ))}
                        </div>
                        {renderMonthView()}
                    </>
                )}
                {viewMode === 'week' && renderWeekView()}
                {viewMode === 'day' && renderDayView()}
            </>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white">Novo Agendamento</h3>
                    <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="space-y-2">
                         <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Data Selecionada</label>
                         <div className="flex items-center gap-2 text-white font-medium bg-slate-950 p-3 rounded-lg border border-slate-800">
                            <CalendarIcon className="w-4 h-4 text-cyan-500" />
                            {selectedDate?.split('-').reverse().join('/')}
                         </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                             <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Horário</label>
                             <div className="relative">
                                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                <input 
                                    type="time" 
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                                    value={formData.time}
                                    onChange={e => setFormData({...formData, time: e.target.value})}
                                />
                             </div>
                        </div>
                        <div className="space-y-2">
                             <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Tipo</label>
                             <select 
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none appearance-none"
                                value={formData.type}
                                onChange={e => setFormData({...formData, type: e.target.value})}
                             >
                                <option value="demo">Demo</option>
                                <option value="meeting">Reunião</option>
                                <option value="support">Suporte</option>
                                <option value="followup">Follow-up</option>
                             </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Título do Evento</label>
                        <input 
                            required
                            type="text" 
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600"
                            placeholder="Ex: Apresentação para Cliente X"
                            value={formData.title}
                            onChange={(e) => setFormData({...formData, title: e.target.value})}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Descrição</label>
                        <div className="relative">
                            <AlignLeft className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                            <textarea 
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600 resize-none h-24"
                                placeholder="Detalhes adicionais..."
                                value={formData.description}
                                onChange={(e) => setFormData({...formData, description: e.target.value})}
                            />
                        </div>
                    </div>

                    <div className="pt-4 flex gap-3">
                        <Button type="button" variant="ghost" onClick={() => setShowCreateModal(false)} className="flex-1 border border-slate-700 hover:bg-slate-800">Cancelar</Button>
                        <Button type="submit" className="flex-1">Salvar</Button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {/* Appointment Details Modal */}
      {selectedAppointment && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
             <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
                 {/* Header */}
                 <div className={`p-6 border-b border-slate-800 relative overflow-hidden ${getEventTypeColor(selectedAppointment.type).replace('text-', 'bg-').replace('/10', '/5')}`}>
                     <div className="absolute top-0 right-0 p-4 opacity-5">
                         <CalendarIcon className="w-32 h-32" />
                     </div>
                     <div className="relative z-10">
                        <div className="flex justify-between items-start mb-4">
                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${getEventTypeColor(selectedAppointment.type)}`}>
                                {selectedAppointment.type}
                            </span>
                            <button onClick={() => setSelectedAppointment(null)} className="p-1 rounded-full bg-black/20 text-white hover:bg-black/40 transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">{selectedAppointment.title}</h3>
                        <div className="flex items-center gap-4 text-sm text-slate-300">
                            <div className="flex items-center gap-1.5">
                                <Clock className="w-4 h-4 text-cyan-500" />
                                {selectedAppointment.time} - {selectedAppointment.duration}min
                            </div>
                            <div className="flex items-center gap-1.5">
                                <CalendarIcon className="w-4 h-4 text-cyan-500" />
                                {selectedAppointment.date.split('-').reverse().join('/')}
                            </div>
                        </div>
                     </div>
                 </div>

                 {/* Body */}
                 <div className="p-6 space-y-6 flex-1">
                     {selectedAppointment.description && (
                         <div className="space-y-2">
                             <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Descrição</h4>
                             <p className="text-sm text-slate-300 leading-relaxed bg-slate-950 p-3 rounded-lg border border-slate-800">
                                 {selectedAppointment.description}
                             </p>
                         </div>
                     )}

                     <div className="space-y-2">
                         <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Participantes</h4>
                         <div className="flex items-center gap-2">
                             {selectedAppointment.attendees?.map((attendee, i) => (
                                 <div key={i} className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
                                     <div className="w-5 h-5 rounded-full bg-cyan-600 flex items-center justify-center text-[10px] text-white font-bold">
                                         {attendee.charAt(0)}
                                     </div>
                                     <span className="text-xs text-slate-200">{attendee}</span>
                                 </div>
                             ))}
                             {!selectedAppointment.attendees && <span className="text-sm text-slate-500">Nenhum participante listado.</span>}
                         </div>
                     </div>

                     <div className="pt-2">
                         <Button 
                            className="w-full shadow-lg shadow-cyan-500/20 py-3" 
                            size="lg"
                            onClick={() => {
                                navigate(`/meeting/${selectedAppointment.id}`);
                            }}
                        >
                             <Video className="w-5 h-5 mr-2" />
                             Entrar na Sala de Reunião
                         </Button>
                         <p className="text-center text-xs text-slate-500 mt-2">
                             A sala estará disponível 5 minutos antes do horário.
                         </p>
                     </div>
                 </div>
             </div>
         </div>
      )}
    </div>
  );
};

export default Scheduling;