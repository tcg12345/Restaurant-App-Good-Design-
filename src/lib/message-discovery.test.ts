import { describe, expect, it } from 'vitest';
import { conversationHasShares, conversationMatchesText, isRoomInvite } from './message-discovery';
import type { Conversation, ChatMessage } from '../contexts/ChatContext';
const chat = (...messages: Partial<ChatMessage>[]) => ({ messages: messages.map((m, i) => ({ id: String(i), senderId: 'friend', text: '', timestamp: i, ...m })) } as Conversation);
describe('message discovery', () => {
 it('finds earlier message text after a newer reply', () => expect(conversationMatchesText(chat({text:'Meet at Lilia for pasta'}, {text:'Sounds good'}), 'LILIA')).toBe(true));
 it('keeps threads with older shares in the Shares filter', () => expect(conversationHasShares(chat({sharedRestaurant:{name:'Lilia'} as any},{text:'See you there'}))).toBe(true));
 it('recognizes group room invitations as shares', () => expect(conversationHasShares(chat({text:'Join https://grubbyrater.com/decide?code=ABCD1234'}))).toBe(true));
 it('searches shared guide titles', () => expect(conversationMatchesText(chat({sharedGuide:{title:'Downtown favorites'} as any}), 'downtown')).toBe(true));
 it('does not mark ordinary conversation as a share', () => expect(conversationHasShares(chat({text:'Let’s go for dinner'}))).toBe(false));
 it('rejects malformed room codes', () => expect(isRoomInvite('https://grubbyrater.com/decide?code=ABCD12345')).toBe(false));
});
