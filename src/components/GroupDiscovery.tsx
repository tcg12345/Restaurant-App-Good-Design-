import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MapPin, Sparkles, Utensils, Heart } from "lucide-react";

export function GroupDiscovery({ location, count, names }: { location: string; count: number; names: string[] }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(0);
  const messages = ["Matching your tastes", "Exploring the neighborhood", "Finding your common ground", "Looking for tonight’s favorites"];
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setPhase(value => (value + 1) % 4), 4400);
    return () => window.clearInterval(timer);
  }, [reduced]);
  return <div className="gs-discovery" role="status" aria-label={`Finding ${count} places near ${location} for your group`}>
    <div className="gs-discovery-scene" aria-hidden="true">
      <div className="gs-discovery-aura" />
      <div className="gs-discovery-ring ring-one" /><div className="gs-discovery-ring ring-two" />
      {[MapPin, Utensils, Heart].map((Icon, index) => <motion.div key={index} className={`gs-discovery-tile tile-${index}`}
        animate={reduced ? {} : { y: [0, -12, 0], rotate: [index * 8 - 8, index * 8 - 3, index * 8 - 8] }}
        transition={{ duration: 5 + index, repeat: Infinity, ease: "easeInOut", delay: index * .4 }}><Icon strokeWidth={1.35} /></motion.div>)}
      <div className="gs-discovery-core"><Sparkles size={42} strokeWidth={1.3} /></div>
      <div className="gs-discovery-people">{names.slice(0, 5).map((name, i) => <span key={i} style={{ animationDelay: `${i * .3}s` }}>{name.slice(0, 1)}</span>)}{names.length > 5 && <span>+{names.length - 5}</span>}</div>
    </div>
    <span className="gs-eyebrow">A LITTLE OF EVERYONE</span>
    <h1>Finding your places.</h1>
    <div className="gs-discovery-message" aria-hidden="true"><AnimatePresence mode="wait"><motion.p key={phase} initial={{ opacity: 0, y: reduced ? 0 : 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -7 }} transition={{ duration: .4 }}>{messages[phase]}</motion.p></AnimatePresence></div>
    <span className="gs-discovery-location"><MapPin size={14} />{location} · {count} places</span>
    <div className="gs-discovery-light" aria-hidden="true"><i /></div>
  </div>;
}
