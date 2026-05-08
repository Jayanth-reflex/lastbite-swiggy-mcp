import { useEffect, useState } from "react";

/**
 * Reveal `text` one word at a time. Pure cosmetic — the message has already
 * arrived from the server. The trick: word-by-word fades faster than
 * char-by-char (5-10x) but reads as "thinking out loud" which our users
 * already expect from chat agents.
 *
 * Returns { display, done }. `done` flips true when the full string is
 * showing, useful for hiding a typing caret.
 */
export function useStreamedText(
  text: string,
  msPerWord = 18,
  enabled = true,
): { display: string; done: boolean } {
  const [n, setN] = useState(enabled ? 0 : Number.POSITIVE_INFINITY);

  useEffect(() => {
    if (!enabled) {
      setN(Number.POSITIVE_INFINITY);
      return;
    }
    setN(0);
  }, [text, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const words = text.split(/(\s+)/);
    if (n >= words.length) return;
    const id = window.setTimeout(() => setN((v) => v + 1), msPerWord);
    return () => window.clearTimeout(id);
  }, [n, text, msPerWord, enabled]);

  const words = text.split(/(\s+)/);
  const display = enabled ? words.slice(0, n).join("") : text;
  const done = !enabled || n >= words.length;
  return { display, done };
}
