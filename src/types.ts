export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  AUDIO = 'audio'
}

export enum MessageDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing'
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  role: 'admin' | 'creator' | 'basic';
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'creator' | 'basic';
  status: 'active' | 'invited' | 'disabled';
  avatar: string;
  lastActive?: string;
}

export interface Message {
  id: string;
  content: string;
  timestamp: string;
  direction: MessageDirection;
  type: MessageType;
  status: 'sent' | 'delivered' | 'read';
}

export interface Conversation {
  id: string;
  contactName: string;
  contactPhone: string;
  contactAvatar: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  tags: string[];
  messages: Message[];
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: 'lead' | 'customer' | 'churned';
  lastContact: string;
}

export interface StatMetric {
  label: string;
  value: string;
  trend: string;
  trendUp: boolean;
}

export interface Appointment {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string;
  duration: number; // minutes
  type: 'demo' | 'meeting' | 'support' | 'followup';
  description?: string;
  attendees?: string[];
}

export interface Deal {
  id: string;
  title: string;
  company: string;
  value: number;
  stage: string; // id da coluna
  ownerAvatar: string;
  tags: string[];
  dueDate?: string;
  priority: 'low' | 'medium' | 'high';
}

export interface KanbanColumn {
  id: string;
  title: string;
  color: string;
}

export interface BackendFunction {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'WEBHOOK';
  route: string;
  description: string;
  category: 'core' | 'ai' | 'integration' | 'database';
  status: 'pending' | 'development' | 'completed';
  code: string; // Pseudo-code or JSON spec
}

// -------------------------
// EROS (primeiro agente)
// -------------------------

export type ErosChannel = 'instagram' | 'whatsapp';
export type ErosClassification = 'hot' | 'morno' | 'frio';
export type ErosLeadStatus = 'new' | 'qualifying' | 'qualified' | 'call' | 'proposal' | 'converted' | 'discarded';
export type ErosPipelineStage = 'new' | 'qualifying' | 'qualified' | 'call' | 'proposal' | 'converted';
export type ErosSpinPhase = 'situation' | 'problem' | 'implication' | 'need_payoff';

export interface ErosLead {
  id: string;
  created_at: string;
  updated_at: string;

  channel: ErosChannel;
  external_id?: string | null;

  name: string;
  username?: string | null;
  phone?: string | null;
  email?: string | null;
  avatar_url?: string | null;

  classification: ErosClassification;
  score: number; // 0..100
  status: ErosLeadStatus;

  tags: string[];
  notes?: string | null;
  last_contact_at?: string | null;
}

export interface ErosConversation {
  id: string;
  lead_id: string;
  channel: ErosChannel;
  external_thread_id?: string | null;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  unread_count: number;
}

export type ErosMessageDirection = 'incoming' | 'outgoing';
export type ErosMessageType = 'text' | 'image' | 'audio';
export type ErosMessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface ErosMessage {
  id: string;
  created_at: string;
  conversation_id: string;
  lead_id: string;

  direction: ErosMessageDirection;
  message_type: ErosMessageType;
  status: ErosMessageStatus;

  content?: string | null;
  media_url?: string | null;
  spin_phase?: ErosSpinPhase | null;
}

export interface ErosPipelineItem {
  id: string;
  lead_id: string;
  stage: ErosPipelineStage;
  position: number;
}