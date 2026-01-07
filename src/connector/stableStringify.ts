export function stableStringify(value: any): string {
  // 用于 onChange.diff：将对象做 means-preserving 的“稳定序列化”，避免 key 顺序不同导致误判
  const seen = new WeakSet<object>();
  const norm = (v: any): any => {
    if (v == null) return v;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;
    if (t === "bigint") return String(v);
    if (t === "function") return undefined;
    if (Array.isArray(v)) return v.map(norm);
    if (t === "object") {
      if (seen.has(v)) return undefined;
      seen.add(v);
      const out: any = {};
      const keys = Object.keys(v).sort();
      for (const k of keys) {
        const nv = norm(v[k]);
        if (nv !== undefined) out[k] = nv;
      }
      return out;
    }
    return undefined;
  };
  return JSON.stringify(norm(value));
}


