import React, { useState, useRef, useEffect } from 'react';
import { Search, MoreVertical, Phone, Video, Paperclip, Send, Check, CheckCheck, Smile, Play, Loader2, Mic, MessageSquare, Info, X, Mail, MapPin, Calendar, DollarSign, Tag } from 'lucide-react';
import { Conversation, Message, MessageDirection, MessageType } from '../types';
import { Button } from './Button';
import { api } from '../services/api';

const ChatInterface: React.FC = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  // Changed default to true so it starts open
  const [showProfileInfo, setShowProfileInfo] = useState(true);
  
  const activeChat = conversations.find(c => c.id === selectedChatId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchChats = async () => {
      try {
        const data = await api.fetchConversations();
        setConversations(data);
        if (data.length > 0 && !selectedChatId) {
          setSelectedChatId(data[0].id);
        }
      } catch (e) {
        console.error("Erro ao carregar chats", e);
      } finally {
        setLoading(false);
      }
    };
    fetchChats();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (activeChat) {
      scrollToBottom();
    }
  }, [activeChat?.id, selectedChatId]); 

  useEffect(() => {
    scrollToBottom();
  }, [activeChat?.messages]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || !activeChat) return;

    const tempId = Date.now().toString();
    const newMessage: Message = {
      id: tempId,
      content: inputText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      direction: MessageDirection.OUTGOING,
      type: MessageType.TEXT,
      status: 'sent' as const
    };

    const updatedConversations = conversations.map(chat => {
      if (chat.id === activeChat.id) {
        return {
          ...chat,
          lastMessage: inputText,
          lastMessageTime: 'Agora',
          messages: [...chat.messages, newMessage]
        };
      }
      return chat;
    });
    setConversations(updatedConversations);
    setInputText('');
    
    try {
       await api.sendMessage(activeChat.id, newMessage);
    } catch (error) {
       console.error("Falha ao enviar mensagem", error);
    }
  };

  const renderMessageContent = (msg: Message) => {
    if (msg.type === MessageType.IMAGE) {
      return (
        <div className="mb-1 group relative">
          <img 
            src={msg.content} 
            alt="Anexo" 
            className="rounded-lg max-w-full h-auto max-h-72 object-cover border border-slate-700/50 shadow-lg"
            loading="lazy"
            onError={(e) => {
                (e.target as HTMLImageElement).src = 'https://placehold.co/300x200/1e293b/cbd5e1?text=Erro+Imagem';
            }}
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-lg pointer-events-none"></div>
        </div>
      );
    }

    if (msg.type === MessageType.AUDIO) {
      return (
        <div className="flex items-center gap-3 min-w-[220px] py-1">
          <button className={`flex items-center justify-center w-9 h-9 rounded-full transition-all shadow-md ${
            msg.direction === MessageDirection.OUTGOING 
              ? 'bg-white text-cyan-600 hover:bg-cyan-50' 
              : 'bg-cyan-500 text-white hover:bg-cyan-400'
          }`}>
            <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />
          </button>
          <div className="flex-1 flex flex-col gap-1 justify-center h-9">
            {/* Visual Waveform */}
            <div className="flex items-center gap-0.5 h-4 opacity-80">
                {[0.4, 0.7, 0.5, 0.9, 0.6, 0.3, 0.8, 0.5, 0.7, 0.4, 0.6, 0.8, 0.5].map((h, i) => (
                <div 
                    key={i} 
                    className={`w-0.5 rounded-full ${
                    msg.direction === MessageDirection.OUTGOING ? 'bg-white/70' : 'bg-slate-400'
                    }`}
                    style={{ height: `${h * 16}px` }}
                />
                ))}
            </div>
            <span className={`text-[10px] font-medium ${
            msg.direction === MessageDirection.OUTGOING ? 'text-cyan-100' : 'text-slate-400'
            }`}>
            0:24
            </span>
          </div>
        </div>
      );
    }

    return <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>;
  };

  if (loading) {
    return (
      <div className="flex h-full bg-slate-950 items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
          <p className="text-sm text-slate-500">Sincronizando conversas criptografadas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-slate-950 rounded-tl-2xl overflow-hidden border-t border-l border-slate-800/50 shadow-2xl">
      
      {/* Left Sidebar: Chat List */}
      <div className="w-80 lg:w-96 border-r border-slate-800 flex flex-col bg-slate-900/50 backdrop-blur-md z-20 flex-shrink-0">
        {/* Search Header */}
        <div className="p-4 border-b border-slate-800/50">
          <h2 className="text-lg font-bold text-white mb-4 px-1">Chats Ativos</h2>
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-cyan-400 transition-colors" />
            <input 
              type="text" 
              placeholder="Buscar conversa..."
              className="w-full pl-9 pr-4 py-2.5 bg-slate-950/50 border border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 outline-none text-slate-200 placeholder:text-slate-600 transition-all"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {conversations.map((chat) => (
            <div 
              key={chat.id}
              onClick={() => setSelectedChatId(chat.id)}
              className={`flex items-center p-4 cursor-pointer transition-all duration-200 border-b border-slate-800/30 hover:bg-slate-800/50 ${
                  selectedChatId === chat.id 
                  ? 'bg-slate-800/80 border-l-2 border-l-cyan-500' 
                  : 'border-l-2 border-l-transparent'
              }`}
            >
              <div className="relative">
                <div className="w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-slate-700 to-slate-900">
                    <img src={chat.contactAvatar} alt={chat.contactName} className="w-full h-full rounded-full object-cover border border-slate-800" />
                </div>
                {chat.unreadCount > 0 ? (
                    <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-cyan-500 border-2 border-slate-900 rounded-full animate-pulse"></span>
                ) : (
                    <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-slate-600 border-2 border-slate-900 rounded-full"></span>
                )}
              </div>
              
              <div className="ml-3 flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <h3 className={`text-sm font-semibold truncate ${selectedChatId === chat.id ? 'text-white' : 'text-slate-300'}`}>{chat.contactName}</h3>
                  <span className="text-[10px] text-slate-500 font-medium">{chat.lastMessageTime}</span>
                </div>
                <p className="text-xs text-slate-500 truncate group-hover:text-slate-400 transition-colors">
                  {chat.messages[chat.messages.length-1]?.type === MessageType.IMAGE ? '📷 Imagem' : 
                   chat.messages[chat.messages.length-1]?.type === MessageType.AUDIO ? '🎵 Áudio' : 
                   chat.lastMessage}
                </p>
                
                <div className="flex items-center mt-2 gap-1.5">
                  {chat.tags.slice(0, 2).map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-slate-800/80 border border-slate-700 text-slate-400 text-[10px] rounded-md font-medium">
                      {tag}
                    </span>
                  ))}
                  {chat.unreadCount > 0 && (
                    <span className="ml-auto bg-gradient-to-r from-cyan-600 to-teal-600 text-white text-[10px] font-bold px-1.5 h-4 min-w-[1rem] flex items-center justify-center rounded-full shadow-lg shadow-cyan-500/20">
                      {chat.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Area: Chat Window & Profile */}
      {activeChat ? (
        <div className="flex-1 flex overflow-hidden bg-[#0B0E14]">
          {/* Main Chat Content */}
          <div className="flex-1 flex flex-col min-w-0 relative">
             {/* Background pattern */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>

            {/* Chat Header */}
            <div className="h-16 px-6 flex items-center justify-between bg-slate-900/80 backdrop-blur-md border-b border-slate-800 z-10 shrink-0">
              <div 
                className="flex items-center cursor-pointer hover:bg-slate-800/50 p-1.5 -ml-1.5 rounded-lg transition-colors pr-3"
                onClick={() => setShowProfileInfo(!showProfileInfo)}
              >
                <div className="relative">
                  <img src={activeChat.contactAvatar} alt={activeChat.contactName} className="w-9 h-9 rounded-full ring-2 ring-slate-800" />
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-900 rounded-full"></span>
                </div>
                <div className="ml-3">
                  <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      {activeChat.contactName}
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 font-normal border border-slate-700">Líder</span>
                  </h2>
                  <p className="text-xs text-cyan-500 font-medium">Online via WhatsApp</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className={`text-slate-400 hover:text-white ${showProfileInfo ? 'bg-slate-800 text-cyan-400' : ''}`} onClick={() => setShowProfileInfo(!showProfileInfo)} title="Ver Informações">
                  <Info className="w-5 h-5" />
                </Button>
                <div className="h-6 w-px bg-slate-800 mx-1"></div>
                <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white"><Phone className="w-5 h-5" /></Button>
                <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white"><MoreVertical className="w-5 h-5" /></Button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative z-0">
              <div className="flex justify-center my-6">
                <span className="px-4 py-1.5 bg-slate-800/80 border border-slate-700 text-slate-400 text-xs font-medium rounded-full shadow-sm backdrop-blur-sm">Hoje</span>
              </div>

              {activeChat.messages.map((msg) => {
                const isOutgoing = msg.direction === MessageDirection.OUTGOING;
                return (
                  <div key={msg.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} group animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                    <div className={`flex flex-col max-w-[75%] ${isOutgoing ? 'items-end' : 'items-start'}`}>
                        <div 
                          className={`px-5 py-3 rounded-2xl shadow-md relative text-sm leading-relaxed ${
                            isOutgoing 
                              ? 'bg-gradient-to-br from-cyan-600 to-teal-700 text-white rounded-tr-sm shadow-cyan-900/20' 
                              : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700/50'
                          }`}
                        >
                          {renderMessageContent(msg)}
                        </div>
                        
                        <div className="flex items-center mt-1.5 gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity px-1">
                            <span className="text-[10px] text-slate-500 font-medium">{msg.timestamp}</span>
                            {isOutgoing && (
                                msg.status === 'read' ? <CheckCheck className="w-3.5 h-3.5 text-cyan-500" /> : <Check className="w-3.5 h-3.5 text-slate-500" />
                            )}
                        </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-slate-900/90 border-t border-slate-800 backdrop-blur-sm z-10">
              <form onSubmit={handleSendMessage} className="flex items-end gap-3 max-w-4xl mx-auto">
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" className="text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-full transition-colors">
                      <Smile className="w-5 h-5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-full transition-colors">
                      <Paperclip className="w-5 h-5" />
                  </Button>
                </div>
                
                <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 focus-within:ring-2 focus-within:ring-cyan-500/30 focus-within:border-cyan-500/50 transition-all shadow-inner">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Digite sua mensagem..."
                    className="w-full bg-transparent border-none p-3.5 max-h-32 min-h-[48px] text-sm text-slate-200 focus:ring-0 resize-none outline-none placeholder:text-slate-600"
                    rows={1}
                  />
                </div>

                {inputText.trim() ? (
                  <Button type="submit" className="rounded-full w-12 h-12 p-0 shadow-lg shadow-cyan-500/20 hover:scale-105 active:scale-95 transition-all">
                      <Send className="w-5 h-5 ml-0.5" />
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" className="rounded-full w-12 h-12 p-0 bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700">
                      <Mic className="w-5 h-5" />
                  </Button>
                )}
              </form>
            </div>
          </div>

          {/* Right Profile Sidebar (CRM View) */}
          {/* Changed from absolute to flex item */}
          <div 
            className={`${showProfileInfo ? 'w-80 border-l border-slate-800 opacity-100' : 'w-0 opacity-0 border-none'} transition-all duration-300 ease-in-out bg-slate-900/95 flex-shrink-0 flex flex-col overflow-hidden`}
          >
             {/* Inner container with fixed width to prevent content squashing during transition */}
             <div className="w-80 h-full flex flex-col">
                {/* Header */}
                <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800 flex-shrink-0">
                    <span className="font-semibold text-white">Informações do Lead</span>
                    <button 
                      onClick={() => setShowProfileInfo(false)}
                      className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
                    {/* Identity */}
                    <div className="flex flex-col items-center text-center">
                        <div className="w-24 h-24 rounded-full p-1 bg-gradient-to-tr from-cyan-500 to-teal-600 shadow-xl mb-4">
                          <img src={activeChat.contactAvatar} alt={activeChat.contactName} className="w-full h-full rounded-full object-cover border-2 border-slate-900" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-1">{activeChat.contactName}</h3>
                        <p className="text-sm text-slate-400 mb-4">CEO & Founder @ TechCorp</p>
                        
                        <div className="flex gap-2 w-full justify-center">
                          <Button size="sm" variant="secondary" className="flex-1 bg-slate-800/50 border-slate-700"><Phone className="w-4 h-4 mr-2" /> Ligar</Button>
                          <Button size="sm" variant="secondary" className="flex-1 bg-slate-800/50 border-slate-700"><Mail className="w-4 h-4 mr-2" /> Email</Button>
                        </div>
                    </div>

                    {/* Details List */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Dados de Contato</h4>
                      
                      <div className="flex items-center gap-3 text-sm">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-400">
                            <Phone className="w-4 h-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs text-slate-500">Telefone</span>
                            <span className="text-slate-200 font-medium">{activeChat.contactPhone}</span>
                          </div>
                      </div>

                      <div className="flex items-center gap-3 text-sm">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-400">
                            <Mail className="w-4 h-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs text-slate-500">Email</span>
                            <span className="text-slate-200 font-medium">contato@empresa.com.br</span>
                          </div>
                      </div>

                      <div className="flex items-center gap-3 text-sm">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-400">
                            <MapPin className="w-4 h-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs text-slate-500">Localização</span>
                            <span className="text-slate-200 font-medium">São Paulo, SP</span>
                          </div>
                      </div>
                    </div>

                    <div className="h-px bg-slate-800/50 w-full"></div>

                    {/* Deal Info */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Oportunidade</h4>
                      <div className="p-4 rounded-xl bg-gradient-to-br from-slate-800/50 to-slate-900 border border-slate-700/50 relative overflow-hidden">
                          <div className="flex justify-between items-start mb-2">
                              <div className="flex items-center gap-2">
                                <DollarSign className="w-4 h-4 text-emerald-400" />
                                <span className="text-xs font-medium text-emerald-400">Em Negociação</span>
                              </div>
                              <span className="text-xs text-slate-500">há 2 dias</span>
                          </div>
                          <div className="text-2xl font-bold text-white mb-1">R$ 12.500</div>
                          <p className="text-xs text-slate-400">Plano Enterprise Anual</p>
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                          Tags
                          <button className="text-cyan-500 hover:text-cyan-400 transition-colors"><MoreVertical className="w-3 h-3" /></button>
                      </h4>
                      <div className="flex flex-wrap gap-2">
                          {activeChat.tags.map(tag => (
                            <span key={tag} className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-300 font-medium flex items-center gap-1.5 hover:bg-slate-700 transition-colors cursor-pointer">
                                <Tag className="w-3 h-3 text-cyan-500" />
                                {tag}
                            </span>
                          ))}
                          <button className="px-2.5 py-1 rounded-md border border-slate-700 border-dashed text-xs text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-all">
                            + Adicionar
                          </button>
                      </div>
                    </div>

                    {/* Notes Area */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Notas Internas</h4>
                      <textarea 
                        className="w-full bg-slate-950/50 border border-slate-800 rounded-lg p-3 text-sm text-slate-300 placeholder:text-slate-600 focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 outline-none resize-none transition-all"
                        rows={4}
                        placeholder="Adicione observações sobre este lead..."
                        defaultValue="Cliente demonstrou interesse no módulo de IA Generativa. Agendar demo técnica para a próxima semana."
                      ></textarea>
                    </div>
                </div>
             </div>
          </div>

        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-[#0B0E14] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/20 to-transparent"></div>
          <div className="relative z-10 flex flex-col items-center p-8 text-center max-w-md">
            <div className="w-24 h-24 bg-slate-900 rounded-full flex items-center justify-center mb-6 shadow-2xl border border-slate-800 relative group">
                <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-xl group-hover:bg-cyan-500/30 transition-all duration-1000"></div>
                <MessageSquare className="w-10 h-10 text-cyan-500" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Viver de IA Workspace</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Selecione uma conversa ao lado para iniciar o atendimento inteligente. Sua IA está ativa e monitorando.
            </p>
            <div className="mt-8 flex gap-3 text-xs text-slate-500 font-mono bg-slate-900/50 px-4 py-2 rounded-lg border border-slate-800/50">
                <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    System Online
                </span>
                <span className="w-px h-4 bg-slate-800"></span>
                <span>v2.4.0</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;