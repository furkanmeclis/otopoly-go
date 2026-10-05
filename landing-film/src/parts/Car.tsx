/** Flat side-view car facing left. Anchor = centre of the 440×165 box. */
import type React from "react";
import type { Palette } from "../theme";

export const CAR_W = 440;
export const CAR_H = 165;
/** Plate centre relative to the car anchor (unscaled). */
export const CAR_PLATE_OFFSET = { x: 185, y: 19.5 };
export const CAR_PLATE_W = 50;

const BODY =
  "M30 124 C16 124 12 116 12 104 L13 92 C14 82 22 77 34 75 L122 62 C140 58 158 36 178 28 C188 24 196 22 210 22 L300 22 C320 22 334 28 348 40 L384 62 C408 66 424 70 428 82 L430 106 C430 118 424 124 412 124 L385 124 A40 40 0 0 0 305 124 L135 124 A40 40 0 0 0 55 124 Z";
const WIN_FRONT =
  "M140 63 C154 57 166 40 182 34 C190 31 198 30 210 30 L250 30 L250 63 Z";
const WIN_REAR =
  "M260 30 L298 30 C313 30 325 35 337 45 L356 63 L260 63 Z";

const Wheel: React.FC<{ cx: number; cy: number; angle: number; P: Palette }> = ({
  cx,
  cy,
  angle,
  P,
}) => (
  <g>
    <circle cx={cx} cy={cy} r={32} fill={P.car.tyre} stroke={P.car.tyreRing} strokeWidth={1.5} />
    <circle cx={cx} cy={cy} r={21} fill={P.car.rim} />
    <g transform={`rotate(${angle} ${cx} ${cy})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <line
          key={a}
          x1={cx}
          y1={cy - 6}
          x2={cx}
          y2={cy - 18}
          stroke={P.car.spoke}
          strokeWidth={4.5}
          strokeLinecap="round"
          transform={`rotate(${a} ${cx} ${cy})`}
        />
      ))}
    </g>
    <circle cx={cx} cy={cy} r={5} fill={P.primary} />
  </g>
);

export const Car: React.FC<{
  P: Palette;
  wheelAngle: number;
  pitch: number;
  showPlate?: boolean;
}> = ({ P, wheelAngle, pitch, showPlate = true }) => {
  return (
    <svg width={CAR_W} height={CAR_H} viewBox={`0 0 ${CAR_W} ${CAR_H}`} style={{ display: "block", overflow: "visible" }}>
      <g transform={`rotate(${pitch} 220 124)`}>
        <path d={BODY} fill={P.car.body} fillOpacity={P.car.bodyOpacity} />
        {/* glass: background + 25% terracotta tint */}
        <path d={WIN_FRONT} fill={P.bg} />
        <path d={WIN_REAR} fill={P.bg} />
        <path d={WIN_FRONT} fill={P.primary} fillOpacity={0.25} />
        <path d={WIN_REAR} fill={P.primary} fillOpacity={0.25} />
        <path d="M168 58 L196 34" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={5} strokeLinecap="round" />
        <path d="M272 58 L290 36" stroke="#FFFFFF" strokeOpacity={0.25} strokeWidth={4} strokeLinecap="round" />
        {/* door seams + handles */}
        <path d="M255 66 L255 116" stroke={P.car.seam} strokeWidth={2} />
        <path d="M136 66 C134 90 136 108 140 116" stroke={P.car.seam} strokeWidth={2} fill="none" />
        <rect x={216} y={84} width={22} height={5} rx={2.5} fill={P.car.seam} />
        <rect x={300} y={84} width={22} height={5} rx={2.5} fill={P.car.seam} />
        {/* terracotta stripe */}
        <path d="M58 76 L408 72" stroke={P.primary} strokeWidth={5} strokeLinecap="round" />
        {/* lights */}
        <rect x={13} y={82} width={16} height={9} rx={4.5} fill="#FFE7C2" />
        <rect x={422} y={74} width={9} height={16} rx={4} fill={P.primary} />
        {/* side mirror */}
        <path d="M150 58 C150 52 158 50 164 52 L166 60 Z" fill={P.car.body} fillOpacity={P.car.bodyOpacity} />
        {showPlate ? (
          <g>
            <rect x={380} y={96} width={50} height={12} rx={2.5} fill="#FFFFFF" stroke="#1A1412" strokeOpacity={0.35} strokeWidth={1} />
            <rect x={380} y={96} width={6} height={12} rx={2} fill="#1E4FB8" />
            <rect x={390} y={100.5} width={36} height={3} rx={1.5} fill="#1A1412" fillOpacity={0.75} />
          </g>
        ) : null}
      </g>
      <Wheel cx={95} cy={126} angle={wheelAngle} P={P} />
      <Wheel cx={345} cy={126} angle={wheelAngle} P={P} />
    </svg>
  );
};
