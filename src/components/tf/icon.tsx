"use client";

import * as Icons from "lucide-react";
import type { LucideProps } from "lucide-react";

/** Renders a lucide icon by name (used by the data-driven navigation). */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name] || Icons.Circle;
  return <Cmp {...props} />;
}
