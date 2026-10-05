/** Turkish/EU-style licence plate. Base size 200×48, digits + letters of the plate only. */
import type React from "react";
import { FONT } from "../theme";

export const PLATE_W = 200;
export const PLATE_H = 48;

export const Plate: React.FC<{ shadow?: string }> = ({ shadow }) => (
  <div
    style={{
      width: PLATE_W,
      height: PLATE_H,
      borderRadius: 8,
      background: "#FFFFFF",
      boxShadow: `inset 0 0 0 2px #1A1412, ${shadow ?? "0 0 0 0 transparent"}`,
      display: "flex",
      alignItems: "stretch",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        width: 26,
        background: "#1E4FB8",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderTopLeftRadius: 8,
        borderBottomLeftRadius: 8,
      }}
    >
      <svg width={16} height={16} viewBox="0 0 16 16">
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return <circle key={i} cx={8 + Math.cos(a) * 6} cy={8 + Math.sin(a) * 6} r={1} fill="#FFD43B" />;
        })}
      </svg>
    </div>
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT,
        fontWeight: 800,
        fontSize: 27,
        letterSpacing: 1.5,
        color: "#1A1412",
        fontVariantNumeric: "tabular-nums",
        paddingRight: 4,
      }}
    >
      34 OTP 34
    </div>
  </div>
);
