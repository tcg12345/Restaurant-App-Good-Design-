import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUp, Check, Clock3, Sparkles, Users } from 'lucide-react';

const PHOTO = '/images/onboarding/miso-salmon.jpg';

const Reveal: React.FC<{ delay?: number; className?: string; children: React.ReactNode }> = ({ delay = 0, className, children }) => {
  const reduce = useReducedMotion();
  return <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .6, delay: reduce ? 0 : delay, ease: [.22, 1, .36, 1] }}>{children}</motion.div>;
};

export const RecipePreview: React.FC = () => <div className="pro-demo pro-demo-recipes" role="img" aria-label="Example AI recipe preview: a salmon photo becomes a complete recipe">
  <div className="pro-demo-glow" />
  <Reveal className="pro-recipe-photo"><img src={PHOTO} alt="" /><span><Sparkles size={12} /> Made with AI</span></Reveal>
  <Reveal delay={.25} className="pro-recipe-result"><span className="pro-demo-label">YOUR RECIPE</span><strong>Miso-glazed salmon</strong><div className="pro-recipe-meta"><span><Clock3 size={12} /> 25 min</span><span><Users size={12} /> Serves 2</span></div><div className="pro-recipe-lines"><i /><i /><i /></div><span className="pro-recipe-ready"><Check size={13} /> Ready to make</span></Reveal>
</div>;

export const AssistantPreview: React.FC = () => <div className="pro-demo pro-demo-assistant" role="img" aria-label="Example assistant conversation suggesting a salmon dinner and ways to adapt it">
  <div className="pro-demo-glow" />
  <Reveal className="pro-chat-question">Something delicious with salmon?</Reveal>
  <Reveal delay={.35} className="pro-chat-answer"><span className="pro-chat-model"><Sparkles size={15} /> GoodEats AI <small>Opus</small></span><p>Try miso-glazed salmon.<br />Savory, bright, and ready in 25 minutes.</p><img src={PHOTO} alt="" /></Reveal>
  <Reveal delay={.7} className="pro-chat-followup"><span>Make it gluten-free</span><span>What goes with it?</span></Reveal>
  <Reveal delay={.9} className="pro-chat-compose"><span>Ask anything…</span><span><ArrowUp size={16} /></span></Reveal>
</div>;

export const TastePreview: React.FC = () => {
  const reduce = useReducedMotion();
  return <div className="pro-demo pro-demo-taste" role="img" aria-label="Example taste profile with an animated flavor chart and a taste-twin match">
    <div className="pro-demo-glow" />
    <svg className="pro-taste-chart" viewBox="0 0 320 285" aria-hidden>
      <defs><linearGradient id="pro-taste-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d1bdff" stopOpacity=".5" /><stop offset="1" stopColor="#8aaadd" stopOpacity=".1" /></linearGradient></defs>
      {[1,.66,.33].map(n=><polygon key={n} points="160,36 254,90 254,198 160,252 66,198 66,90" transform={`translate(160 144) scale(${n}) translate(-160 -144)`} fill="none" stroke="rgba(201,211,234,.14)" />)}
      {[[160,36],[254,90],[254,198],[160,252],[66,198],[66,90]].map(([x,y])=><line key={`${x},${y}`} x1="160" y1="144" x2={x} y2={y} stroke="rgba(201,211,234,.1)" />)}
      <motion.polygon points="160,52 232,104 220,180 160,234 80,190 100,109" fill="url(#pro-taste-fill)" stroke="#c4b8ed" strokeWidth="2" strokeLinejoin="round" initial={reduce ? false : { opacity:0, scale:.3 }} animate={{opacity:1,scale:1}} transition={{duration:1.1,ease:[.22,1,.36,1]}} style={{transformOrigin:'160px 144px'}} />
      <text x="160" y="20" textAnchor="middle">Savory</text><text x="270" y="88">Fresh</text><text x="270" y="209">Spicy</text><text x="160" y="279" textAnchor="middle">Rich</text><text x="50" y="209" textAnchor="end">Sweet</text><text x="50" y="88" textAnchor="end">Bright</text>
    </svg>
    <Reveal delay={.55} className="pro-taste-match"><span className="pro-twin-avatars"><i>J</i><i>You</i></span><span><strong>Your kind of taste.</strong><small>Discover your taste twins</small></span><span className="pro-twin-percent">94<span>%</span></span></Reveal>
    <span className="pro-taste-example">Example profile</span>
  </div>;
};

export const PRO_WALKTHROUGH = [
  { id:'recipes', label:'Recipes', title:'Every idea. A new recipe.', description:'Create and combine AI recipes without a weekly cap.', Visual:RecipePreview },
  { id:'assistant', label:'Assistant', title:'A little more possibility.', description:'More messages. Deeper answers with Opus.', Visual:AssistantPreview },
  { id:'taste', label:'Your taste', title:'Get to know your taste.', description:'See your patterns, compare palates, and find taste twins.', Visual:TastePreview },
] as const;
