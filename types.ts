export interface AttachedFile {
  name: string;
  data: string;
  mimeType: string;
}

export interface ScoreRecord {
  quizType: string;
  score: number;
  total: number;
  date: number;
}

export interface StudentProfile {
  id: string; // Format: Nom-123
  name: string;
  scores: ScoreRecord[];
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isError?: boolean;
  file?: AttachedFile;
  selectedOption?: string; // Persistance du choix de quiz ou d'identité
  selectedOptions?: string[]; // Pour les QCM à choix multiples
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export enum AppMode {
  TEXT = 'text',
  VOICE = 'voice',
  SETTINGS = 'settings'
}

export interface CourseContext {
  content: string;
  title: string;
}

export type VoiceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
