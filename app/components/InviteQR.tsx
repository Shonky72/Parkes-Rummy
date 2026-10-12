"use client";

import { useId, useMemo } from "react";
import QRCode from "qrcode/lib/core/qrcode.js";

export interface InviteQRProps {
  /** Complete invitation URL, including the origin and room code. */
  value: string;
  size?: number;
}

/** A real SVG QR code, generated locally with a four-module white quiet zone. */
export function InviteQR({ value, size = 172 }: InviteQRProps) {
  const titleId = useId();
  const descriptionId = useId();
  const symbol = useMemo(() => {
    if (!value.trim()) return null;
    try {
      const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
      const quietZone = 4;
      const dimension = modules.size + quietZone * 2;
      const segments: string[] = [];
      // One path per contiguous row section keeps the SVG small and edges crisp.
      for (let row = 0; row < modules.size; row++) {
        let column = 0;
        while (column < modules.size) {
          if (!modules.data[row * modules.size + column]) {
            column++;
            continue;
          }
          const firstColumn = column;
          while (column < modules.size && modules.data[row * modules.size + column]) column++;
          segments.push(
            `M${firstColumn + quietZone} ${row + quietZone}h${column - firstColumn}v1H${firstColumn + quietZone}z`,
          );
        }
      }
      return { dimension, path: segments.join("") };
    } catch {
      return null;
    }
  }, [value]);

  const pixels = Number.isFinite(size) ? Math.max(96, Math.round(size)) : 172;
  if (!symbol) {
    return (
      <div
        role="status"
        style={{
          width: pixels,
          height: pixels,
          maxWidth: "100%",
          display: "grid",
          placeItems: "center",
          padding: 16,
          background: "#fff",
          color: "#354a40",
          textAlign: "center",
          fontSize: 12,
        }}
      >
        {value.trim() ? "Use the invite link to join" : "Preparing invitation…"}
      </div>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={pixels}
      height={pixels}
      viewBox={`0 0 ${symbol.dimension} ${symbol.dimension}`}
      role="img"
      aria-labelledby={`${titleId} ${descriptionId}`}
      shapeRendering="crispEdges"
      focusable="false"
      style={{ display: "block", maxWidth: "100%", height: "auto", background: "#fff" }}
    >
      <title id={titleId}>Scan to join this Parkes Rummy table</title>
      <desc id={descriptionId}>Opens the invitation on your phone: {value}</desc>
      <rect width={symbol.dimension} height={symbol.dimension} fill="#fff" />
      <path d={symbol.path} fill="#111" />
    </svg>
  );
}

export default InviteQR;
