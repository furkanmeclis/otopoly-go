import type { ThemeName } from "./lib/stage";
import { loadFont } from "@remotion/google-fonts/PlusJakartaSans";

const { fontFamily } = loadFont("normal", {
  weights: ["600", "700", "800"],
  subsets: ["latin"],
});

export const FONT = fontFamily;

export type Palette = {
  name: ThemeName;
  bg: string;
  fg: string;
  card: string;
  muted: string;
  border: string;
  primary: string;
  success: string;
  wa: string;
  text2: string;
  skeleton: string;
  /** Darker skeleton for "title" bars. */
  skeleton2: string;
  amber: string;
  slate: string;
  tickBlue: string;
  bubble: string;
  bubbleLine: string;
  /** Soft elevation for cards. */
  shadow: string;
  shadowLift: string;
  /** Sheen laid over cards (dark theme only gets a hint of top light). */
  sheen: string;
  glowAlpha: number;
  gridOpacity: number;
  car: {
    body: string;
    bodyOpacity: number;
    tyre: string;
    tyreRing: string;
    rim: string;
    spoke: string;
    seam: string;
    groundShadow: string;
  };
  phoneFrame: string;
  phoneRing: string;
};

export const PALETTES: Record<ThemeName, Palette> = {
  light: {
    name: "light",
    bg: "#FFF9F5",
    fg: "#241C18",
    card: "#FFFDFB",
    muted: "#F7EEE9",
    border: "#E7DBD5",
    primary: "#EA6E43",
    success: "#16A34A",
    wa: "#25D366",
    text2: "#6B5E57",
    skeleton: "#EFE6E0",
    skeleton2: "#E2D4CC",
    amber: "#F59E0B",
    slate: "#64748B",
    tickBlue: "#34B7F1",
    bubble: "#DCF8C6",
    bubbleLine: "rgba(36, 28, 24, 0.13)",
    shadow:
      "0 1px 2px rgba(36,28,24,0.05), 0 10px 24px -10px rgba(36,28,24,0.12), 0 30px 60px -28px rgba(36,28,24,0.18)",
    shadowLift:
      "0 2px 4px rgba(36,28,24,0.05), 0 22px 40px -14px rgba(36,28,24,0.20), 0 50px 90px -36px rgba(36,28,24,0.26)",
    sheen: "linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0) 30%)",
    glowAlpha: 0.08,
    gridOpacity: 0.55,
    car: {
      body: "#241C18",
      bodyOpacity: 0.92,
      tyre: "#16110F",
      tyreRing: "rgba(0,0,0,0)",
      rim: "#EFE6E0",
      spoke: "#8A7B73",
      seam: "rgba(255,249,245,0.16)",
      groundShadow: "rgba(36,28,24,0.22)",
    },
    phoneFrame: "#241C18",
    phoneRing: "rgba(0,0,0,0)",
  },
  dark: {
    name: "dark",
    bg: "#1A1412",
    fg: "#FBF5F2",
    card: "#241C18",
    muted: "#322621",
    border: "rgba(255,255,255,0.10)",
    primary: "#EA6E43",
    success: "#22C55E",
    wa: "#25D366",
    text2: "#B7A79F",
    skeleton: "#3A2D27",
    skeleton2: "#4A3A33",
    amber: "#FBBF24",
    slate: "#94A3B8",
    tickBlue: "#53BDEB",
    bubble: "#1F4D3A",
    bubbleLine: "rgba(255, 255, 255, 0.16)",
    shadow:
      "0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 28px -12px rgba(0,0,0,0.55), 0 36px 70px -30px rgba(0,0,0,0.65)",
    shadowLift:
      "0 1px 0 rgba(255,255,255,0.05) inset, 0 24px 44px -14px rgba(0,0,0,0.6), 0 60px 100px -36px rgba(0,0,0,0.75)",
    sheen: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0) 35%)",
    glowAlpha: 0.14,
    gridOpacity: 0.5,
    car: {
      body: "#FBF5F2",
      bodyOpacity: 0.92,
      tyre: "#0E0A09",
      tyreRing: "rgba(255,255,255,0.14)",
      rim: "#B7A79F",
      spoke: "#322621",
      seam: "rgba(26,20,18,0.18)",
      groundShadow: "rgba(0,0,0,0.55)",
    },
    phoneFrame: "#0D0A09",
    phoneRing: "rgba(255,255,255,0.14)",
  },
};
