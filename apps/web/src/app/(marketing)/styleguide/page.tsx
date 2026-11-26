import type { Metadata } from "next";
import { StyleGuide } from "@/components/marketing/style-guide";

export const metadata: Metadata = {
  title: "Style guide · Lift",
  description: "Lift's theme: colours, type and components, in dark and light.",
};

// UI-01 (docs/briefs/louisa-design.md): every colour as a swatch, the type scale and the dashboard's
// components, in dark and light. Values come from src/styles/theme.css.
export default function StyleGuidePage() {
  return <StyleGuide />;
}
