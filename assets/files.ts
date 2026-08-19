/**
 * Static asset hashmap — every image, logo and illustration used by TourFlow.
 * All external URLs were validated with checkIfImageExistsByUrl.
 */

export const FILES = {
  // Landing & marketing
  heroBeach: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=1600&q=80",
  heroBoat: "https://images.unsplash.com/photo-1518623489648-a173ef7824f3?w=1600&q=80",
  showcaseIsland: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80",
  showcaseSnorkel: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=80",

  // Product / excursion covers
  excursionIsland: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80",
  excursionSnorkel: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=80",
  excursionWaterfall: "https://images.unsplash.com/photo-1516426122078-c23e76319801?w=1200&q=80",
  excursionCatamaran: "https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=1200&q=80",
  excursionBuggy: "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=1200&q=80",
  excursionCity: "https://images.unsplash.com/photo-1552074284-5e88ef1aef18?w=1200&q=80",
  excursionWhales: "https://images.unsplash.com/photo-1493558103817-58b2924bce98?w=1200&q=80",
  excursionSunset: "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=1200&q=80",
} as const;

export type FileKey = keyof typeof FILES;
