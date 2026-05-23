import React, { useEffect, useState } from 'react';
import { Activity, DollarSign, MessageSquare, Users, Loader2, TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar } from 'recharts';
import { StatMetric } from '../types';
import { api } from '../services/api';

const Dashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<StatMetric[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [metricsData, chartDataResponse] = await Promise.all([
          api.fetchDashboardMetrics(),
          api.fetchChartData()
        ]);
        setMetrics(metricsData);
        setChartData(chartDataResponse);
      } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const getIcon = (label: string) => {
    if (label.includes('Vendas')) return <DollarSign className="h-5 w-5 text-emerald-400" />;
    if (label.includes('Atendimentos')) return <MessageSquare className="h-5 w-5 text-cyan-400" />;
    if (label.includes('Leads')) return <Users className="h-5 w-5 text-violet-400" />;
    return <Activity className="h-5 w-5 text-orange-400" />;
  };

  const getGradient = (label: string) => {
    if (label.includes('Vendas')) return 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20';
    if (label.includes('Atendimentos')) return 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/20';
    if (label.includes('Leads')) return 'from-violet-500/20 to-violet-500/5 border-violet-500/20';
    return 'from-orange-500/20 to-orange-500/5 border-orange-500/20';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
             <div className="absolute inset-0 bg-cyan-500/20 blur-xl rounded-full"></div>
             <Loader2 className="h-10 w-10 animate-spin text-cyan-400 relative z-10" />
          </div>
          <p className="text-sm text-slate-400 font-medium animate-pulse">Carregando insights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 overflow-y-auto h-full bg-slate-950 text-slate-50 custom-scrollbar">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Dashboard</h2>
          <p className="text-slate-400 mt-1">Visão geral da performance da sua IA hoje.</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
           <span className="px-3 py-1 bg-slate-800 rounded-md text-xs font-medium text-white shadow-sm">Hoje</span>
           <span className="px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-300 cursor-pointer transition-colors">7 Dias</span>
           <span className="px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-300 cursor-pointer transition-colors">30 Dias</span>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((stat, index) => (
          <div 
            key={index} 
            className={`relative overflow-hidden rounded-2xl border bg-slate-900/50 backdrop-blur-sm p-6 shadow-xl transition-all duration-300 hover:translate-y-[-2px] hover:bg-slate-900 group ${getGradient(stat.label)}`}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="text-sm font-medium text-slate-400">{stat.label}</div>
              <div className="p-2 rounded-lg bg-slate-800/50 border border-slate-700/50 group-hover:border-slate-600 transition-colors">
                 {getIcon(stat.label)}
              </div>
            </div>
            <div className="flex items-end justify-between">
                <div className="text-3xl font-bold text-white tracking-tight">{stat.value}</div>
                <div className={`flex items-center text-xs font-medium px-2 py-1 rounded-full ${stat.trendUp ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                    {stat.trendUp ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                    {stat.trend}
                </div>
            </div>
            {/* Decorative Glow */}
            <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-white/5 blur-2xl rounded-full group-hover:bg-white/10 transition-all"></div>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid gap-6 md:grid-cols-7">
        {/* Main Chart */}
        <div className="col-span-4 rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm p-6 shadow-lg">
          <div className="mb-6 flex items-center justify-between">
            <div>
                <h3 className="text-lg font-semibold text-white">Volume de Atendimentos</h3>
                <p className="text-sm text-slate-400">Interações da IA nos últimos 7 dias</p>
            </div>
            <button className="text-cyan-400 hover:text-cyan-300 transition-colors p-2 hover:bg-cyan-950/30 rounded-lg">
                <ArrowUpRight className="w-5 h-5" />
            </button>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorChats" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tickMargin={10} 
                    fontSize={12} 
                    stroke="#64748b"
                />
                <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    fontSize={12} 
                    stroke="#64748b"
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b', color: '#f8fafc', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)' }} 
                  itemStyle={{ color: '#06b6d4' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="chats" 
                  stroke="#06b6d4" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorChats)" 
                  activeDot={{ r: 6, strokeWidth: 0, fill: '#fff' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Secondary Chart */}
        <div className="col-span-3 rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm p-6 shadow-lg flex flex-col">
           <div className="mb-6">
            <h3 className="text-lg font-semibold text-white">Conversão de Vendas</h3>
            <p className="text-sm text-slate-400">Performance diária vs Meta</p>
          </div>
          
          <div className="flex-1 flex flex-col justify-center space-y-5">
            {chartData.slice(0, 5).map((day, i) => (
              <div key={i} className="group">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-300">{day.name}</span>
                    <span className="text-sm font-bold text-white group-hover:text-cyan-400 transition-colors">{day.sales} conv.</span>
                </div>
                <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-cyan-600 to-teal-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.3)] transition-all duration-1000 ease-out group-hover:shadow-[0_0_15px_rgba(6,182,212,0.6)]" 
                    style={{ width: `${(day.sales / 50) * 100}%` }} 
                  />
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-6 pt-4 border-t border-slate-800">
             <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Média Semanal</span>
                <span className="text-emerald-400 font-bold">+12.5%</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;