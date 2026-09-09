import React, { createContext, useContext, useState } from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';

const RouteSettledContext = createContext(true);
export const useRouteSettled = () => useContext(RouteSettledContext);

/** Media can paint its poster during a push and start decoders after landing.
 * Use the actual animation completion, including instant/reduced-motion entry,
 * rather than a timer that can drift from the route transition. */
export function RouteMotionLayer({ children, onAnimationComplete, ...props }: HTMLMotionProps<'div'>) {
  const [settled, setSettled] = useState(false);
  const ready = settled || !!props.custom?.instant || props.initial === false;
  return <motion.div {...props} onAnimationComplete={definition => {
    if (definition === 'center') setSettled(true);
    onAnimationComplete?.(definition);
  }}>
    <RouteSettledContext.Provider value={ready}>{children}</RouteSettledContext.Provider>
  </motion.div>;
}
