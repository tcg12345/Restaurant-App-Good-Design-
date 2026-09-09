import { expect, it } from 'vitest';
import { mergeChatConversation, mergeChatMessages } from './chat-reconcile';
import type { ChatMessage, Conversation } from '../contexts/ChatContext';
const message = (id: string, timestamp: number, status?: ChatMessage['status']): ChatMessage => ({ id, timestamp, status, senderId: 'sender', text: id });
it('confirms optimistic echoes exactly once using the server timestamp', () => {
  expect(mergeChatMessages([message('one', 9, 'sending')], [message('one', 2)])).toEqual([message('one', 2, 'sent')]);
});
it('keeps live arrivals, pending sends and failed retries during a delayed snapshot', () => {
  const result = mergeChatMessages([message('incoming', 3), message('pending', 4, 'sending'), message('failed', 5, 'failed')], [message('older', 1)]);
  expect(result.map((m) => m.id)).toEqual(['older', 'incoming', 'pending', 'failed']);
  expect(result[2].status).toBe('sending'); expect(result[3].status).toBe('failed');
});
it('does not move a conversation backwards when a stale history arrives', () => {
  const conversation: Conversation = { id: 'chat', participantIds: ['sender'], createdAt: 1, lastMessageAt: 10, messages: [message('live', 10)], isGroup: false };
  const result = mergeChatConversation(conversation, { ...conversation, lastMessageAt: 2, messages: [message('old', 2)] });
  expect(result.lastMessageAt).toBe(10); expect(result.messages).toHaveLength(2);
});
