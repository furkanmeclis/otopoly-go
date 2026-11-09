import type { SVGProps } from "react";

import type { BrandShape, brandMark, brandWordmark } from "./artwork";

export type BrandArt = typeof brandMark | typeof brandWordmark;

/** Logo part a paint is chosen for. */
export type BrandRole = "tile" | "accent" | "o" | "onAccent" | "text";

export type BrandPaint = (role: BrandRole) => SVGProps<SVGElement>;

function shapeElement(
  key: string,
  shape: BrandShape,
  props: SVGProps<SVGElement>,
) {
  if (typeof shape === "string") {
    return (
      <path key={key} d={shape} {...(props as SVGProps<SVGPathElement>)} />
    );
  }
  return (
    <rect
      key={key}
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      rx={shape.rx}
      {...(props as SVGProps<SVGRectElement>)}
    />
  );
}

/**
 * Logo parts in paint order, as plain `<path>` / `<rect>` elements (works in
 * Satori too). `paint` decides fills per role so the same geometry serves
 * themed UI (CSS classes) and static renders (hex fills).
 */
export function brandShapes(art: BrandArt, paint: BrandPaint) {
  return [
    ...("text" in art
      ? [
          <path
            key="text"
            d={art.text}
            fillRule="evenodd"
            {...(paint("text") as SVGProps<SVGPathElement>)}
          />,
        ]
      : []),
    shapeElement("tile", art.tile, paint("tile")),
    shapeElement("accent", art.accent, paint("accent")),
    <path
      key="o"
      d={art.o}
      fillRule="evenodd"
      {...(paint("o") as SVGProps<SVGPathElement>)}
    />,
    <path
      key="p"
      d={art.p}
      fillRule="evenodd"
      {...(paint("onAccent") as SVGProps<SVGPathElement>)}
    />,
    <path
      key="star"
      d={art.star}
      {...(paint("onAccent") as SVGProps<SVGPathElement>)}
    />,
  ];
}

/** Theme-driven paint: colours come from `.brand-logo` tokens in theme.css. */
export const themedPaint: BrandPaint = (role) => ({
  className: `brand-logo-${role}`,
});

/** Static paint for image renders (OG, icons) where CSS is unavailable. */
export function staticPaint(
  tone: "light" | "dark",
  colors: {
    espresso: string;
    cream: string;
    accent: string;
    white: string;
  },
  stroke: number,
): BrandPaint {
  const ink = tone === "light" ? colors.espresso : colors.cream;
  return (role) => {
    switch (role) {
      case "tile":
        return tone === "light"
          ? { fill: colors.espresso }
          : { fill: "none", stroke: colors.cream, strokeWidth: stroke };
      case "accent":
        return { fill: colors.accent };
      case "o":
        return { fill: tone === "light" ? colors.white : colors.cream };
      case "onAccent":
        return { fill: colors.white };
      case "text":
        return { fill: ink };
    }
  };
}
