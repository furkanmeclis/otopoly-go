/**
 * Otopoly — oto yıkama ve hizmet yönetim yazılımı.
 * Hex aliases for JS (theme-color, icons). CSS tokens live in theme.css.
 *
 * Logo pack (docs/brand/logo-pack): terracotta #E26B41, espresso #2B201A,
 * cream #FEF9F5. UI `primary` stays the theme terracotta.
 */
export const brand = {
  name: "Otopoly",
  productName: "Otopoly",
  subtitle: "Yıkama Yazılımı",
  tagline: "Oto yıkama ve hizmet yönetim platformu",
  colors: {
    /** UI terracotta (theme primary) */
    primary: "#EA6E43",
    /** Logo pack terracotta — exact SVG fill */
    logoAccent: "#E26B41",
    primaryForeground: "#FFF8F5",
    /** Logo espresso — O tile and OTOPOLY letters in light mode */
    glyph: "#2B201A",
    /** Logo cream — icon background and dark-mode ink */
    cream: "#FEF9F5",
    /** Dark canvas behind the lockup */
    ink: "#1A1412",
    /** Warm cream surface */
    mist: "#FBF7F4",
    white: "#FFFFFF",
    /** Compat aliases used by theme-switch / legacy tokens */
    navy: "#1A1412",
    lightGray: "#F3EBE6",
  },
} as const;

export type BrandTone = "auto" | "light" | "dark";
export type BrandVariant = "logo" | "wordmark" | "mark" | "icon";
