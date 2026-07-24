import React from 'react';
import { Save, Lock, Zap, Bell, Shield, Webhook, ShieldAlert } from 'lucide-react';
import { Button } from './Button';
import { useRoles } from '../context/RoleContext';

const Settings: React.FC = () => {
  const { currentRole, getRoleName } = useRoles();
  const isAdmin = currentRole === 'admin';

  return (
    <div className="p-8 max-w-5xl mx-auto h-full overflow-y-auto bg-slate-950 text-slate-50 custom-scrollbar relative">
      <div className="mb-10 flex items-center justify-between">
        <div>
            <h2 className="text-3xl font-bold tracking-tight text-white">Configurações</h2>
            <p className="text-sm text-slate-400 mt-1">Central de controle da sua instância GymSite - Pipeline.</p>
        </div>
        <div className="flex gap-2">
            <span className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs rounded-full font-mono flex items-center">
                <Shield className="w-3 h-3 mr-1" /> Ambiente Seguro
            </span>
        </div>
      </div>

      <div className="space-y-8 relative">
        {/* Dynamic Restricted Access Overlay */}
        {!isAdmin && (
          <div className="absolute inset-x-[-12px] inset-y-[-12px] z-40 bg-slate-950/80 backdrop-blur-[6px] rounded-2xl border border-slate-800/40 p-8 flex flex-col items-center justify-center text-center">
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-full mb-6 animate-pulse">
              <ShieldAlert className="w-12 h-12 text-red-400" />
            </div>
            <h3 className="text-2xl font-bold text-white tracking-tight mb-2">Acesso Restrito ao Administrador</h3>
            <p className="text-sm text-slate-400 max-w-md leading-relaxed mb-6">
              Você está acessando a plataforma como <strong className="text-red-400 font-semibold">{getRoleName()}</strong>. Configurações de chaves de integração da Evolution API e Webhooks globais só podem ser modificadas por um <strong className="text-white font-semibold">Administrador</strong>.
            </p>
            
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 max-w-lg text-left divide-y divide-slate-800/60 shadow-lg">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider pb-3">Regras de Acesso para esta seção:</p>
              
              <div className="grid grid-cols-2 gap-4 py-3 text-xs">
                <div>
                  <span className="text-white font-semibold block mb-0.5">Administrador</span>
                  <span className="text-slate-400 leading-normal">Acesso total. Visualiza e edita chaves secreta, conexões WhatsApp e integrações.</span>
                </div>
                <div>
                  <span className="text-slate-300 font-semibold block mb-0.5 opacity-60">Criador de Conteúdo</span>
                  <span className="text-slate-500 leading-normal">Acesso revogado. Lida com mensagens e conteúdo no Pipeline, não com redes de API.</span>
                </div>
              </div>
              <div className="pt-3 text-xs">
                <span className="text-slate-300 font-semibold block mb-0.5 opacity-60">Usuário Básico</span>
                <span className="text-slate-500 leading-normal">Acesso revogado. Papel focado em monitoramento básico e leitura de conversas.</span>
              </div>
            </div>
          </div>
        )}

        {/* Evolution API Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm shadow-xl p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
              <Zap className="w-32 h-32 text-cyan-500 rotate-12" />
          </div>
          
          <div className="flex items-start gap-5 mb-8 relative z-10">
            <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl shadow-lg shadow-cyan-500/5">
              <Zap className="w-8 h-8 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Evolution API</h3>
              <p className="text-sm text-slate-400 mt-1">Configure a conexão com sua instância do WhatsApp para automação de mensagens.</p>
            </div>
          </div>

          <div className="grid gap-6 max-w-3xl relative z-10">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-300">
                API URL (Base URL)
              </label>
              <input
                type="text"
                disabled={!isAdmin}
                placeholder="https://api.seu-servidor.com"
                className="flex h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all shadow-inner disabled:opacity-50"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-300">
                API Key (Global)
              </label>
              <div className="relative group">
                <input
                  type="password"
                  value="sk_test_************************"
                  readOnly
                  className="flex h-11 w-full rounded-lg border border-slate-700 bg-slate-950/50 px-4 py-2 text-sm text-slate-400 focus:outline-none cursor-not-allowed"
                />
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-hover:text-slate-300 transition-colors" />
              </div>
            </div>
            
            <div className="flex items-center gap-3 mt-2 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg w-fit">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-sm font-semibold text-emerald-400">Conexão Estabelecida e Operante</span>
            </div>
          </div>
        </div>

        {/* Webhook Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm shadow-xl p-8">
          <div className="flex items-start gap-5 mb-8">
            <div className="p-3 bg-violet-500/10 border border-violet-500/20 rounded-xl shadow-lg shadow-violet-500/5">
              <Webhook className="w-8 h-8 text-violet-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Webhooks</h3>
              <p className="text-sm text-slate-400 mt-1">URLs de retorno para receber eventos de mensagens e status em tempo real.</p>
            </div>
          </div>

          <div className="grid gap-6 max-w-3xl">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-300">
                Callback URL (Eventos de Chat)
              </label>
              <div className="flex gap-2">
                <input
                    type="text"
                    disabled={!isAdmin}
                    placeholder="https://gymsite.com.br/api/hooks/chat"
                    className="flex-1 h-11 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-all shadow-inner disabled:opacity-50"
                />
                <Button disabled={!isAdmin} variant="secondary" className="bg-slate-800 border-slate-700 text-slate-300 hover:text-white disabled:opacity-50">Testar</Button>
              </div>
              <p className="text-xs text-slate-500">O sistema enviará um POST payload para esta URL a cada nova mensagem.</p>
            </div>
          </div>
        </div>
        
        <div className="flex justify-end gap-4 pt-6 border-t border-slate-800">
          <Button variant="ghost" disabled={!isAdmin} className="text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50">Cancelar</Button>
          <Button size="lg" disabled={!isAdmin} className="shadow-lg shadow-cyan-500/20 disabled:opacity-50">
            <Save className="w-5 h-5 mr-2" />
            Salvar Alterações
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Settings;