import type { IPointData } from "leafer-editor";

export function transformSvgPath(
  path: string,
  map: (p: IPointData) => IPointData
): string {
  // 支持命令：M/L/C/Q/Z（绝对坐标）
  const segRe = /([MLCQZ])([^MLCQZ]*)/gi;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = segRe.exec(path))) {
    const cmd = m[1]!;
    const body = (m[2] || "").trim();
    if (cmd.toUpperCase() === "Z") {
      out += `${cmd} `;
      continue;
    }
    const nums = body
      .replace(/,/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => Number(n));
    if (!nums.length) {
      out += `${cmd} `;
      continue;
    }
    const mapped: number[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      const x = nums[i];
      const y = nums[i + 1];
      if (typeof x !== "number" || typeof y !== "number") break;
      const p = map({ x, y });
      mapped.push(p.x, p.y);
    }
    out += `${cmd} ${mapped.join(" ")} `;
  }
  return out.trim();
}


