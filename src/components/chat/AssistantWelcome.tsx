import React, { useState } from 'react';
import { ArrowUpRight, Camera, ChefHat, Compass, MapPin, RefreshCw, Sparkles, Users } from 'lucide-react';
import { homeHaptic } from '../../lib/haptics';

export type AssistantFeature = 'dish' | 'recipe' | 'recommendations' | 'group';
type Suggestion = { title: string; prompt: string; icon: React.ReactNode };

export function AssistantOrb({ small = false }: { small?: boolean }) {
  return <span className={`ai-orb${small ? ' is-small' : ''}`} aria-hidden="true"><span /><Sparkles strokeWidth={1.5} /></span>;
}

export function AssistantWelcome({ city, suggestions, onPrompt, onShuffle, onFeature }: {
  city: string;
  suggestions: Suggestion[];
  onPrompt: (prompt: string) => void;
  onShuffle: () => void;
  onFeature?: (feature: AssistantFeature) => void;
}) {
  const [mode, setMode] = useState<'Dine out' | 'Cook' | 'Plan'>('Dine out');
  const prompts: Suggestion[] = mode === 'Dine out' ? suggestions.slice(0, 3) : mode === 'Cook' ? [
    { title: 'Dinner with what I have', prompt: 'Help me make dinner with ingredients I already have. Ask me what is in my kitchen first.', icon: <ChefHat size={17} /> },
    { title: 'Make a recipe my own', prompt: 'Help me adapt a recipe to my tastes. Ask which recipe and what I would like to change.', icon: <Sparkles size={17} /> },
    { title: 'Find something new to cook', prompt: 'Find recipes I might enjoy based on my taste and saved recipes.', icon: <Compass size={17} /> },
  ] : [
    { title: 'Plan a night out', prompt: `Help me plan a night out in ${city}. Ask about the occasion and budget first.`, icon: <MapPin size={17} /> },
    { title: 'Find a place for everyone', prompt: `Help me find a restaurant for a group in ${city}. Ask about our tastes, budgets, and dietary needs first.`, icon: <Users size={17} /> },
    { title: 'Choose between my saved places', prompt: 'Help me choose between restaurants on my wishlist for my next meal.', icon: <Compass size={17} /> },
  ];
  const features = [
    { id: 'dish' as const, title: 'Recreate a dish', sub: 'Photo to recipe', icon: <Camera size={20} />, tone: 'peach' },
    { id: 'recipe' as const, title: 'Create a recipe', sub: 'Make it your own', icon: <ChefHat size={20} />, tone: 'sage' },
    { id: 'recommendations' as const, title: 'For you', sub: 'Places for your taste', icon: <Compass size={20} />, tone: 'blue' },
    { id: 'group' as const, title: 'Decide together', sub: 'Find your group’s pick', icon: <Users size={20} />, tone: 'lavender' },
  ];
  return <div className="ai-welcome">
    <section className="ai-welcome-hero">
      <AssistantOrb />
      <h1>What sounds good?</h1>
      <p>Find a place. Make something new.</p>
      {city && <span className="ai-location"><MapPin size={12} />{city}</span>}
    </section>
    <div className="ai-prompt-modes" role="group" aria-label="Conversation ideas">
      {(['Dine out', 'Cook', 'Plan'] as const).map(value => <button key={value} aria-pressed={mode === value} onClick={() => { homeHaptic(); setMode(value); }}>{value}</button>)}
      {mode === 'Dine out' && <button className="ai-shuffle" onClick={() => { homeHaptic(); onShuffle(); }} aria-label="More dining ideas"><RefreshCw size={14} /></button>}
    </div>
    <div className="ai-prompt-list" key={mode}>
      {prompts.map(prompt => <button key={prompt.title} onClick={() => { homeHaptic(); onPrompt(prompt.prompt); }}>
        <span>{prompt.icon}</span><span>{prompt.title}</span><ArrowUpRight size={15} />
      </button>)}
    </div>
    {onFeature && <section className="ai-feature-section" aria-label="More with GoodEats AI">
      <h2>More with AI</h2>
      <div className="ai-feature-grid">
        {features.map(feature => <button key={feature.id} onClick={() => { homeHaptic(); onFeature(feature.id); }}>
          <span className={`ai-feature-icon ${feature.tone}`}>{feature.icon}</span>
          <span><strong>{feature.title}</strong><small>{feature.sub}</small></span>
          <ArrowUpRight size={12} />
        </button>)}
      </div>
    </section>}
  </div>;
}
