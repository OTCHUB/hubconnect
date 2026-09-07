import { useEffect, useState } from "react";

/** `[copy]` → `[copied]` for 1.5 s. Silent no-op when the Clipboard API is unavailable (http). */
export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      /* clipboard blocked — the address is still selectable next to the button */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`copy ${text}`}
      className="text-[10px] text-green-600 hover:text-green-300"
    >
      [{done ? "copied" : label}]
    </button>
  );
}
