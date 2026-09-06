import type { Conversation } from '../contexts/ChatContext';
type Message = Conversation['messages'][number];
export const isRoomInvite = (text: string) => /\/decide\?code=[A-Z0-9]{8}(?:\b|$)/i.test(text);
export const isSharedMessage = (message: Message) => !!(message.sharedRestaurant || message.sharedRecipe || message.sharedReel || message.sharedPost || message.sharedGuide || isRoomInvite(message.text));
export const conversationHasShares = (conversation: Conversation) => conversation.messages.some(isSharedMessage);
export const conversationMatchesText = (conversation: Conversation, query: string) => {
  const q = query.trim().toLocaleLowerCase();
  return conversation.messages.some(message => [message.text, message.sharedRestaurant?.name, message.sharedRecipe?.name, message.sharedGuide?.title, message.sharedReel?.attachedTitle].filter(Boolean).join(' ').toLocaleLowerCase().includes(q));
};
