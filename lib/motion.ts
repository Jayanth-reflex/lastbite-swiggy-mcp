import type { Transition, TargetAndTransition } from "motion/react";

/**
 * Shared motion presets so every surface in the app feels like it belongs to
 * the same family.
 */
export const spring: Record<string, Transition> = {
  snappy: { type: "spring", stiffness: 380, damping: 30, mass: 0.7 },
  gentle: { type: "spring", stiffness: 220, damping: 28, mass: 0.9 },
  cushion: { type: "spring", stiffness: 160, damping: 26, mass: 1 },
};

export const fadeUpFrom = { opacity: 0, y: 12 } as const;
export const fadeUpTo: TargetAndTransition = {
  opacity: 1,
  y: 0,
  transition: spring.gentle,
};

export function fadeUpAt(delay: number): TargetAndTransition {
  return { ...fadeUpTo, transition: { ...spring.gentle, delay } };
}

export const bubbleFrom = { opacity: 0, y: 6, scale: 0.985 } as const;
export const bubbleTo: TargetAndTransition = {
  opacity: 1,
  y: 0,
  scale: 1,
  transition: spring.snappy,
};
