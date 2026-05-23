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