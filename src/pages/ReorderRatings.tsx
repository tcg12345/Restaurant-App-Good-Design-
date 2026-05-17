import React, { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, GripVertical, Undo2, Save, X } from 'lucide-react';
import { Reorder, useDragControls, motion } from 'motion/react';
import { useLists } from '../contexts/ListsContext';

interface RatedItem {
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  score: number;
}

function roundScore(n: number): number {
  return Math.round(n * 10) / 10;
}

const ReorderItem: React.FC<{
  item: RatedItem;
  originalScore: number | undefined;
  onDragEnd: (id: string) => void;
}> = ({ item, originalScore, onDragEnd }) => {
  const controls = useDragControls();
  const changed = originalScore !== undefined && originalScore !== item.score;

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      onDragEnd={() => onDragEnd(item.restaurantId)}
      className="flex items-center gap-3 bg-white rounded-2xl px-3 py-3 shadow-sm border border-on-surface/[0.06] touch-none"
      whileDrag={{ scale: 1.03, boxShadow: '0 8px 30px rgba(0,0,0,0.12)', zIndex: 50 }}
    >
      <button
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab active:cursor-grabbing p-1 text-on-surface/30 hover:text-on-surface/50 transition-colors"
        aria-label="Drag to reorder"
      >
        <GripVertical size={18} />
      </button>

      <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-on-surface/5">
        {item.image ? (
          <img src={item.image} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-on-surface/20 text-xs font-bold">
            ?
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-on-surface truncate">{item.name}</p>
        {item.cuisine && (
          <p className="text-xs text-on-surface/50 truncate">{item.cuisine}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <motion.span
          key={item.score}
          initial={changed ? { scale: 1.3, color: '#f59e0b' } : false}
          animate={{ scale: 1, color: changed ? '#f59e0b' : '#1a1a1a' }}
          transition={{ type: 'spring', damping: 15, stiffness: 300 }}
          className="text-base font-bold tabular-nums min-w-[2rem] text-right"
        >
          {item.score.toFixed(1)}
        </motion.span>
        <span className="text-xs text-on-surface/30 font-medium">/10</span>
      </div>
    </Reorder.Item>
  );
};

export const ReorderRatings: React.FC = () => {
  const navigate = useNavigate();
  const { ratings, updateRating } = useLists();

  // Build initial sorted list from rated restaurants (not wishlist)
  const buildInitialItems = useCallback((): RatedItem[] => {
    return ratings
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => ({
        restaurantId: r.restaurantId,
        name: r.name,
        image: r.image,
        cuisine: r.cuisine,
        score: r.score,
      }));
  }, [ratings]);

  const [items, setItems] = useState<RatedItem[]>(buildInitialItems);
  const [undoStack, setUndoStack] = useState<RatedItem[][]>([]);
  const originalScores = useRef<Record<string, number>>(
    Object.fromEntries(buildInitialItems().map((i) => [i.restaurantId, i.score]))
  );

  const handleReorder = useCallback((newOrder: RatedItem[]) => {
    setItems(newOrder);
  }, []);

  // When a specific item finishes dragging, update only that item's score
  // to the midpoint of its new neighbours.
  const handleItemDragEnd = useCallback((draggedId: string) => {
    setItems((current) => {
      const idx = current.findIndex((i) => i.restaurantId === draggedId);
      if (idx === -1) return current;

      // Save snapshot for undo before mutating
      setUndoStack((prev) => [...prev, current]);

      let newScore: number;
      if (current.length === 1) {
        // Only one item, keep its score
        return current;
      } else if (idx === 0) {
        // Dragged to top: score should be above the item below it
        const below = current[1].score;
        newScore = roundScore(Math.min(10, below + 0.5));
      } else if (idx === current.length - 1) {
        // Dragged to bottom: score should be below the item above it
        const above = current[idx - 1].score;
        newScore = roundScore(Math.max(0.1, above - 0.5));
      } else {
        // Middle: midpoint of the two neighbours
        const above = current[idx - 1].score;
        const below = current[idx + 1].score;
        newScore = roundScore((above + below) / 2);
      }

      // Only update if the score actually changed
      if (newScore === current[idx].score) return current;

      return current.map((item, i) =>
        i === idx ? { ...item, score: newScore } : item
      );
    });
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const stack = [...prev];
      const last = stack.pop()!;
      setItems(last);
      return stack;
    });
  }, []);

  const handleSave = useCallback(() => {
    for (const item of items) {
      const original = originalScores.current[item.restaurantId];
      if (original !== item.score) {
        updateRating(item.restaurantId, { score: item.score });
      }
    }
    navigate(-1);
  }, [items, updateRating, navigate]);

  const handleCancel = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const hasChanges = items.some(
    (item) => originalScores.current[item.restaurantId] !== item.score
  );

  return (
    <div className="min-h-screen bg-surface pb-8">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-surface/80 backdrop-blur-xl border-b border-on-surface/[0.06]">
        <div className="flex items-center justify-between px-4 pt-safe-3 pb-3">
          <div className="flex items-center gap-3">
            <button
              onClick={handleCancel}
              className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 transition-colors"
              aria-label="Cancel"
            >
              <ArrowLeft size={22} className="text-on-surface" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-on-surface">Reorder Ratings</h1>
              <p className="text-xs text-on-surface/50">Drag to reorder, scores update automatically</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-30 text-on-surface/60 hover:bg-on-surface/5"
              aria-label="Undo"
            >
              <Undo2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="px-4 pt-4">
        {items.length === 0 ? (
          <div className="text-center py-20 text-on-surface/40">
            <p className="text-base font-medium">No rated restaurants yet</p>
            <p className="text-sm mt-1">Rate some restaurants to reorder them here.</p>
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={items}
            onReorder={handleReorder}
            className="space-y-2"
          >
            {items.map((item) => (
              <ReorderItem
                key={item.restaurantId}
                item={item}
                originalScore={originalScores.current[item.restaurantId]}
                onDragEnd={handleItemDragEnd}
              />
            ))}
          </Reorder.Group>
        )}
      </div>

      {/* Bottom action bar */}
      {items.length > 0 && (
        <div className="sticky bottom-0 left-0 right-0 px-4 pt-4 pb-safe-4 bg-surface/80 backdrop-blur-xl border-t border-on-surface/[0.06]">
          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-on-surface/5 transition-colors"
            >
              <X size={16} />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold transition-colors disabled:opacity-40 bg-primary text-white hover:bg-primary/90"
            >
              <Save size={16} />
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
