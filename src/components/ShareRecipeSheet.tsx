/**
 * ShareRecipeSheet — bottom sheet that lets the user pick a chat
 * conversation to share a recipe into. Mirrors the restaurant "Send to
 * Chat" sheet already used on the restaurant detail pages.
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Users, Send, MessageCircle, ChefHat } from 'lucide-react';
import { useChat, type SharedRecipe } from '../contexts/ChatContext';
import { useNavigate } from 'react-router-dom';

export const ShareRecipeSheet: React.FC<{
  open: boolean;
  recipe: SharedRecipe | null;
  onClose: () => void;
}> = ({ open, recipe, onClose }) => {
  const navigate = useNavigate();
  const { conversations, sendMessage } = useChat();
  const [sent, setSent] = useState(false);

  if (!open || !recipe) return null;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70]" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="fixed bottom-0 left-0 right-0 z-[70] bg-surface rounded-t-3xl flex flex-col overflow-hidden max-h-[60vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-on-surface/6 flex-shrink-0">
          <h3 className="font-serif font-bold text-lg">Share Recipe</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
            <X size={16} className="text-on-surface/60" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {sent ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                <ChefHat size={22} className="text-emerald-600" />
              </div>
              <p className="text-sm font-semibold text-emerald-700">Sent!</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-12">
              <MessageCircle size={28} className="mx-auto text-on-surface/15 mb-2" />
              <p className="text-sm text-on-surface/35">No conversations yet</p>
              <button onClick={() => { onClose(); navigate('/messages'); }}
                className="mt-3 text-primary text-xs font-semibold">Go to Messages</button>
            </div>
          ) : (
            <div className="space-y-1 pt-2">
              <div className="flex gap-2 mb-3 items-center">
                <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35">Sharing:</span>
                <ChefHat size={12} className="text-emerald-600" />
                <span className="text-xs font-semibold text-on-surface/60 truncate">{recipe.name}</span>
              </div>
              {conversations.map((conv) => (
                <button key={conv.id}
                  onClick={() => {
                    sendMessage(conv.id, '', undefined, recipe);
                    setSent(true);
                    setTimeout(() => { setSent(false); onClose(); }, 1200);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-on-surface/3 transition-colors text-left">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    {conv.isGroup
                      ? <Users size={14} className="text-emerald-600" />
                      : <span className="text-sm font-bold text-emerald-600">{(conv.name || 'C').charAt(0).toUpperCase()}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-on-surface/70 truncate">{conv.name || 'Direct Message'}</p>
                  </div>
                  <Send size={14} className="text-on-surface/25" />
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
