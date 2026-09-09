import type { ChatMessage, Conversation } from '../contexts/ChatContext';

/** Merge a delayed server snapshot with messages delivered while it was in
 * flight. A server copy confirms an optimistic send, using the same UUID. */
export function mergeChatMessages(local: ChatMessage[], server: ChatMessage[]): ChatMessage[] {
  const messages = new Map(local.map((message) => [message.id, message]));
  for (const message of server) messages.set(message.id, { ...message, status: 'sent' });
  return [...messages.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

export function mergeChatConversation(local: Conversation | undefined, server: Conversation): Conversation {
  const messages = mergeChatMessages(local?.messages || [], server.messages);
  return { ...server, messages, lastMessageAt: Math.max(server.lastMessageAt, messages.at(-1)?.timestamp || 0) };
}
