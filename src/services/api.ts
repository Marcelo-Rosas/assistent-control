import { Contact, Conversation, StatMetric, Message, TeamMember, Appointment, Deal } from '../types';
import { MOCK_CONTACTS, MOCK_CONVERSATIONS, STATS, MOCK_TEAM, MOCK_APPOINTMENTS, MOCK_DEALS } from '../constants';

const DELAY_MS = 800;

// Dados do gráfico movidos do componente para o serviço
const CHART_DATA = [
  { name: 'Seg', chats: 40, sales: 24 },
  { name: 'Ter', chats: 30, sales: 13 },
  { name: 'Qua', chats: 20, sales: 38 },
  { name: 'Qui', chats: 27, sales: 39 },
  { name: 'Sex', chats: 18, sales: 48 },
  { name: 'Sáb', chats: 23, sales: 38 },
  { name: 'Dom', chats: 34, sales: 43 },
];

export const api = {
  /**
   * Simula o fetch das métricas do dashboard
   */
  fetchDashboardMetrics: async (): Promise<StatMetric[]> => {
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    return STATS;
  },

  /**
   * Simula o fetch dos dados do gráfico
   */
  fetchChartData: async (): Promise<any[]> => {
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    return CHART_DATA;
  },

  /**
   * Simula o fetch da lista de contatos
   */
  fetchContacts: async (): Promise<Contact[]> => {
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    return MOCK_CONTACTS;
  },

  /**
   * Simula o fetch da lista de equipe
   */
  fetchTeam: async (): Promise<TeamMember[]> => {
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    return MOCK_TEAM;
  },

  /**
   * Simula o fetch da lista de agendamentos
   */
  fetchAppointments: async (): Promise<Appointment[]> => {
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    return MOCK_APPOINTMENTS;
  },
  
  /**
   * Simula o fetch do pipeline (kanban)
   */
  fetchPipeline: async (): Promise<Deal[]> => {
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    return MOCK_DEALS;
  },

  /**
   * Simula o fetch das conversas e mensagens
   */
  fetchConversations: async (): Promise<Conversation[]> => {
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    return MOCK_CONVERSATIONS;
  },

  /**
   * Simula o envio de uma mensagem para o backend
   */
  sendMessage: async (chatId: string, message: Message): Promise<Message> => {
    await new Promise(resolve => setTimeout(resolve, 300)); // Delay menor para UX de chat
    // Aqui seria feita a chamada POST para a Evolution API
    console.log(`[API] Enviando mensagem para chat ${chatId}:`, message);
    return message;
  }
};