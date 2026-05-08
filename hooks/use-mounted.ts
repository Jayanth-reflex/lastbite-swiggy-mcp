import { useEffect, useState } from "react";

/**
 * Returns true after the component mounts on the client. Used to gate
 * client-only animations so SSR renders the final state — motion v12 + Next 16
 * turbopack production builds occasionally hydrate without firing the
 * `animate` prop, leaving everything stuck at `initial`.
 */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
