import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Check, ArrowUpRight } from "lucide-react";
import type { GroupPlace, GroupRanking } from "../lib/group-swipe";
import type { ReactNode } from "react";

export function GroupPairwise({ ranking, deck, busy, choose, photo }: {
  ranking: GroupRanking; deck: GroupPlace[]; busy: boolean;
  choose: (payload: { candidate: string; against: string; preferred: string; step: number }) => void;
  photo: (place: GroupPlace) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const candidate = deck.find(p => p.id === ranking.remaining?.[0]);
  const against = deck.find(p => p.id === ranking.ordered?.[Math.floor(((ranking.lo ?? 0) + (ranking.hi ?? 1)) / 2)]);
  if (!candidate || !against) return null;
  const sorted = ranking.ordered?.length ?? 0;
  const total = sorted + (ranking.remaining?.length ?? 0);
  return <section className="gs-pairwise">
    <div className="gs-round-steps"><span><Check size={13} /> Swipe</span><i /><strong>2 · Rank your favorites</strong></div>
    <h1>Which would you<br />rather go to?</h1>
    <p>Pick between your yeses. We’ll find your order.</p>
    <AnimatePresence mode="wait" initial={false}>
      <motion.div className="gs-pair-options" key={`${candidate.id}-${against.id}`} initial={{ opacity: 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: reduced ? 1 : .98 }} transition={{ duration: .18 }}>
        {[candidate, against].map(place => <button key={place.id} disabled={busy} aria-label={`Prefer ${place.name}`} onClick={() => choose({ candidate: candidate.id, against: against.id, preferred: place.id, step: ranking.comparisons ?? 0 })}>
          {photo(place)}<div className="gs-pair-shade" />
          <div className="gs-pair-copy"><small>{place.cuisine}{place.priceLevel ? ` · ${"$".repeat(place.priceLevel)}` : ""}</small><strong>{place.name}</strong><span>{(place.distance / 1609).toFixed(1)} mi away <ArrowUpRight size={18} /></span></div>
        </button>)}
        <span className="gs-pair-or" aria-hidden="true">or</span>
      </motion.div>
    </AnimatePresence>
    <div className="gs-pair-progress" role="status"><span>{sorted} of {total} favorites in order</span><div className="gs-progress"><i style={{ width: `${sorted / total * 100}%` }} /></div></div>
  </section>;
}
