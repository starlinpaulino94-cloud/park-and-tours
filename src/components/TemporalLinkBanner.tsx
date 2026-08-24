"use client";

import { useEffect, useState } from "react";

/**
 * TemporalLinkBanner - informs the user that the link they are seeing is temporary.
 *
 * It is rendered ONLY when BOTH conditions match:
 *   1. The hostname includes "temporal-link-preview" (the development preview domain)
 *   2. The page is the top-level document — NOT embedded anywhere
 *
 * So it appears when the development link is opened on its own browser tab, and never
 * when the project is embedded in another page (iframe / frame / object on a
 * third-party site). Published projects use a different
 * hostname, so it never shows up for end users either.
 *
 * It renders in the normal document flow at the very top of <body>, so the website
 * content is pushed below it instead of being covered by it.
 *
 * It can be dismissed with the close button. The dismissal is kept in memory only
 * (on purpose), so the banner shows up again on the next page reload.
 */
export function TemporalLinkBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isTemporalLink = window.location.hostname.includes("temporal-link-preview");
    // `window.top` is only strictly equal to `window.self` when nothing embeds us,
    // at any nesting depth and whatever the embedding element is.
    const isTopLevel = window.self === window.top;
    setVisible(isTemporalLink && isTopLevel);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="relative z-[2147483647] w-full bg-orange-500 py-2 pl-4 pr-10 text-center text-xs font-medium leading-snug text-white sm:text-sm"
    >
      This is just a temporal link used for development, to get a permanent link publish your project.
      <button
        type="button"
        aria-label="Close"
        onClick={() => setVisible(false)}
        className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-base leading-none text-white/80 transition-colors hover:bg-white/20 hover:text-white sm:right-2"
      >
        &times;
      </button>
    </div>
  );
}
