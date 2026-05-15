import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, ArrowLeft, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';

type StepOption = { id: string; label: string; image?: string };
type Step = {
  id: number;
  type: 'image' | 'pill';
  question: string;
  options: StepOption[];
};

const STEPS: Step[] = [
  {
    id: 1,
    type: 'image',
    question: "What's your ideal dining atmosphere?",
    options: [
      { id: 'intimate', label: 'Intimate & Dimly Lit', image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=400' },
      { id: 'vibrant', label: 'Vibrant & Social', image: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&q=80&w=400' },
      { id: 'minimalist', label: 'Minimalist & Zen', image: 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?auto=format&fit=crop&q=80&w=400' },
      { id: 'rustic', label: 'Rustic & Organic', image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=400' },
    ]
  },
  {
    id: 2,
    type: 'image',
    question: "Which flavor profile defines your palate?",
    options: [
      { id: 'umami', label: 'Rich & Savory (Umami)', image: 'https://images.unsplash.com/photo-1544070078-a212eda27b49?auto=format&fit=crop&q=80&w=400' },
      { id: 'spicy', label: 'Bold & Spicy', image: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&q=80&w=400' },
      { id: 'sweet', label: 'Delicate & Sweet', image: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&q=80&w=400' },
      { id: 'sour', label: 'Bright & Acidic', image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=400' },
    ]
  },
  {
    id: 3,
    type: 'pill',
    question: "What's your favorite cuisine?",
    options: [
      { id: 'italian', label: 'Italian' },
      { id: 'japanese', label: 'Japanese' },
      { id: 'mexican', label: 'Mexican' },
      { id: 'thai', label: 'Thai' },
      { id: 'indian', label: 'Indian' },
      { id: 'american', label: 'American' },
      { id: 'french', label: 'French' },
      { id: 'chinese', label: 'Chinese' },
    ]
  },
  {
    id: 4,
    type: 'pill',
    question: "How often do you dine out?",
    options: [
      { id: 'rarely', label: 'Rarely' },
      { id: 'monthly', label: 'A few times a month' },
      { id: 'weekly', label: 'Weekly' },
      { id: 'several', label: 'Several times a week' },
      { id: 'daily', label: 'Almost daily' },
    ]
  }
];

export const Onboarding: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const navigate = useNavigate();

  const handleSelect = (optionId: string) => {
    setSelections({ ...selections, [currentStep]: optionId });
    if (currentStep < STEPS.length - 1) {
      setTimeout(() => setCurrentStep(currentStep + 1), 300);
    } else {
      setTimeout(() => navigate('/'), 500);
    }
  };

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-surface flex flex-col px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-8">
      <header className="flex items-center justify-between mb-12">
        <button
          onClick={() => currentStep > 0 && setCurrentStep(currentStep - 1)}
          className={cn("p-3 glass rounded-full text-on-surface transition-opacity", currentStep === 0 && "opacity-0 pointer-events-none")}
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1 mx-8 h-1.5 bg-on-surface/[0.1] rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            className="h-full bg-primary"
          />
        </div>
        <button
          onClick={() => navigate('/')}
          className="text-xs font-bold uppercase tracking-widest text-on-surface/40 hover:text-primary transition-colors"
        >
          Skip
        </button>
      </header>

      <main className="flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex-1 flex flex-col"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-2">Palette Test • {currentStep + 1}/{STEPS.length}</p>
            <h2 className="text-4xl font-serif font-bold mb-12 leading-tight">{STEPS[currentStep].question}</h2>

            {STEPS[currentStep].type === 'image' ? (
              <div className="grid grid-cols-2 gap-4 flex-1">
                {STEPS[currentStep].options.map((option) => (
                  <motion.button
                    key={option.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSelect(option.id)}
                    className={cn(
                      "relative aspect-[4/5] rounded-3xl overflow-hidden group transition-all duration-300",
                      selections[currentStep] === option.id ? "ring-4 ring-primary ring-offset-4 ring-offset-surface" : ""
                    )}
                  >
                    <img
                      src={option.image}
                      alt={option.label}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    <div className="absolute bottom-6 left-6 right-6 text-left">
                      <h4 className="font-serif font-bold text-xl text-white leading-tight">{option.label}</h4>
                    </div>
                    {selections[currentStep] === option.id && (
                      <div className="absolute top-6 right-6 w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white shadow-xl">
                        <Check size={20} />
                      </div>
                    )}
                  </motion.button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-3 content-start">
                {STEPS[currentStep].options.map((option) => {
                  const isSelected = selections[currentStep] === option.id;
                  return (
                    <motion.button
                      key={option.id}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelect(option.id)}
                      className={cn(
                        "min-h-[44px] px-6 rounded-full font-medium text-sm transition-colors duration-200 inline-flex items-center gap-2",
                        isSelected
                          ? "bg-primary text-white shadow-lg shadow-primary/25"
                          : "bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface hover:bg-white"
                      )}
                    >
                      {option.label}
                      {isSelected && <Check size={16} />}
                    </motion.button>
                  );
                })}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="mt-12 flex justify-center">
        <p className="text-xs text-on-surface/40 font-medium italic">
          Your selections help us curate a taste profile that's uniquely yours.
        </p>
      </footer>
    </div>
  );
};
