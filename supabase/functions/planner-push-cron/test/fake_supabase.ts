export const DB: Record<string, any[]> = {};
type Q = any;
function match(row: any, f: any): boolean {
  const v = row[f.c];
  switch (f.op) {
    case "eq": return v === f.v;
    case "in": return f.v.includes(v);
    case "gte": return v >= f.v; case "lte": return v <= f.v;
    case "gt": return v > f.v; case "lt": return v < f.v;
    case "or": return f.v.some((x: any) => match(row, x));
  }
  return true;
}
class Query {
  filters: any[] = []; mode = "select"; payload: any; opts: any; returning = false;
  constructor(public table: string) {}
  select() { this.returning = true; return this; }
  eq(c: string, v: any) { this.filters.push({ c, op: "eq", v }); return this; }
  in(c: string, v: any[]) { this.filters.push({ c, op: "in", v }); return this; }
  gte(c: string, v: any) { this.filters.push({ c, op: "gte", v }); return this; }
  lte(c: string, v: any) { this.filters.push({ c, op: "lte", v }); return this; }
  gt(c: string, v: any) { this.filters.push({ c, op: "gt", v }); return this; }
  lt(c: string, v: any) { this.filters.push({ c, op: "lt", v }); return this; }
  or(s: string) {
    const parts = s.split(",").map((p) => { const [c, op, v] = p.split("."); return { c, op, v: v === "false" ? false : v === "true" ? true : v }; });
    this.filters.push({ op: "or", v: parts }); return this;
  }
  update(p: any) { this.mode = "update"; this.payload = p; return this; }
  delete() { this.mode = "delete"; return this; }
  upsert(rows: any[], o: any) { this.mode = "upsert"; this.payload = rows; this.opts = o; return this; }
  then(res: any, rej: any) { return Promise.resolve(this.run()).then(res, rej); }
  run() {
    const t = (DB[this.table] ??= []);
    const hit = (r: any) => this.filters.every((f) => match(r, f));
    if (this.mode === "select") return { data: t.filter(hit).map((r) => ({ ...r })), error: null };
    if (this.mode === "update") { const rows = t.filter(hit); rows.forEach((r) => Object.assign(r, this.payload)); return { data: rows, error: null }; }
    if (this.mode === "delete") { DB[this.table] = t.filter((r) => !hit(r)); return { data: null, error: null }; }
    if (this.mode === "upsert") {
      const keys = String(this.opts.onConflict).split(","); const inserted: any[] = [];
      for (const row of this.payload) {
        if (t.some((r) => keys.every((k) => r[k] === row[k]))) continue;
        const nr = { sent_at: new Date().toISOString(), ...row }; t.push(nr); inserted.push(nr);
      }
      return { data: inserted, error: null };
    }
  }
}
export const sentLog: any[] = [];
export const createClient = () => ({
  from: (t: string) => new Query(t),
  auth: { getUser: async (jwt: string) => jwt === "user-jwt" ? { data: { user: { id: "u1" } }, error: null } : { data: null, error: { message: "bad" } } },
});
export default { setVapidDetails() {}, sendNotification: async (sub: any, body: string, opts: any) => {
  if (sub.endpoint.includes("dead")) { const e: any = new Error("gone"); e.statusCode = 410; throw e; }
  sentLog.push({ endpoint: sub.endpoint, ...JSON.parse(body), ttl: opts?.TTL }); return {};
} };
