import type { IArrowStyle } from "leafer-editor";

export function asArrowStyle(
  style: IArrowStyle | undefined,
  scale?: number
): IArrowStyle | undefined {
  if (!style) return style;
  if (scale == null) return style;
  if (typeof style === "string") return { type: style, scale };
  if (typeof style === "object" && "type" in style) {
    const old = (style as any).scale;
    return { ...(style as any), scale: old != null ? old * scale : scale };
  }
  return style;
}


