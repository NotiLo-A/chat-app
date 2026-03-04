export interface ChatMessage {
  type: 'message';
  id?: number;
  from: string;
  to: string;
  content: string;
  ts: string;
}

export interface Channel {
  id: string;
  name: string;
  created_by: string;
  members: string[];
}

export type ServerMessage =
  | { type: 'auth_ok'; username: string }
  | { type: 'auth_error'; msg: string }
  | { type: 'user_list'; users: string[]; online: string[] }
  | { type: 'contacts'; contacts: string[] }
  | { type: 'channels'; channels: Channel[] }
  | { type: 'channel_created'; channel: Channel }
  | { type: 'channel_deleted'; channel_id: string }
  | { type: 'history'; channel: string; messages: ChatMessage[] }
  | { type: 'message_deleted'; msg_id: number; channel: string }
  | ChatMessage;

export type ClientMessage =
  | { type: 'login'; username: string; password: string }
  | { type: 'register'; username: string; password: string }
  | { type: 'message'; to: string; content: string }
  | { type: 'get_history'; with: string }
  | { type: 'create_channel'; name: string; members: string[] }
  | { type: 'delete_channel'; channel_id: string }
  | { type: 'close_dm'; peer: string }
  | { type: 'delete_message'; msg_id: number; channel: string };

export type Theme = 'light' | 'dark';
export type AuthTab = 'login' | 'register';

export interface AuthStatus {
  msg: string;
  type: '' | 'ok' | 'err';
}
