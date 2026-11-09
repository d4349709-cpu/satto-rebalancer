// 매일 종가를 받아 Supabase에 저장하는 스크립트 (GitHub Actions에서 실행)
// 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
const BASE = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY || "";
if (!BASE || !KEY) { console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요해요"); process.exit(1); }

const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept": "application/json" };
// 새 secret 키(sb_secret_)는 apikey 헤더로만, 예전 service_role 키(eyJ…)는 Authorization에도 넣어요
const DB = { apikey: KEY, "Content-Type": "application/json", ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}) };
const safeId = c => String(c).toUpperCase().replace(/[^A-Z0-9_.\-]/g, "_").slice(0, 60);
const kst = (ms = Date.now()) => new Date(ms + 9 * 3600e3);
const kstDate = ms => kst(ms).toISOString().slice(0, 10);
const md = d => `${d.slice(5, 7)}.${d.slice(8, 10)}`;
const num = s => { const n = parseFloat(String(s ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const round = (v, d = 2) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// ---------- 시세 출처 ----------
async function yahoo(sym, range = "5d") {
  let lastErr;
  for (const host of ["query1", "query2"]) {
    try {
      const d = await getJSON(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`);
      const r = d.chart.result[0];
      const closes = (r.indicators.quote[0].close || []).filter(x => x != null);
      const price = r.meta.regularMarketPrice ?? closes.at(-1);
      const prev = closes.length > 1 ? closes.at(-2) : r.meta.chartPreviousClose;
      const t = (r.meta.regularMarketTime || Date.now() / 1000) * 1000;
      return { price, chg: prev ? (price / prev - 1) * 100 : null, high: Math.max(...closes, price), date: kstDate(t) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
async function naverStock(code) {
  const d = await getJSON(`https://m.stock.naver.com/api/stock/${code}/basic`);
  const price = num(d.closePrice);
  if (!price) throw new Error("naver no price " + code);
  return { price, chg: num(d.fluctuationsRatio), date: kstDate() };
}
async function upbit(coins) {
  const out = {};
  const one = async list => {
    const d = await getJSON(`https://api.upbit.com/v1/ticker?markets=${list.map(c => "KRW-" + c).join(",")}`);
    d.forEach(x => { out[x.market.slice(4)] = { price: x.trade_price, chg: x.signed_change_rate * 100, date: kstDate() }; });
  };
  try { await one(coins); }
  catch { for (const c of coins) { try { await one([c]); } catch { } await sleep(150); } }
  return out;
}

// 국내 종목/ETF: 네이버 → 실패하면 야후(.KS/.KQ)
async function krQuote(code) {
  try { return await naverStock(code); } catch { }
  for (const sfx of [".KS", ".KQ"]) { try { const y = await yahoo(code + sfx); return { price: y.price, chg: y.chg, date: y.date }; } catch { } }
  throw new Error("kr quote fail " + code);
}
async function usQuote(sym) { const y = await yahoo(sym.replace(/\./g, "-")); return { price: y.price, chg: y.chg, date: y.date }; }

// ---------- Supabase REST ----------
async function sel(table, q = "select=*") {
  const r = await fetch(`${BASE}/rest/v1/${table}?${q}`, { headers: DB });
  if (!r.ok) throw new Error(`select ${table} ${r.status} ${await r.text()}`);
  return r.json();
}
async function upsert(table, rows) {
  if (!rows.length) return;
  const r = await fetch(`${BASE}/rest/v1/${table}`, { method: "POST", headers: { ...DB, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(`upsert ${table} ${r.status} ${await r.text()}`);
}

// ---------- 국면 점수 ----------
function regime(krDD, usDD, vix) {
  const s1 = d => d == null ? 0 : d <= -20 ? -2 : d <= -10 ? -1 : d > -5 ? 1 : 0;
  let score = s1(krDD) + s1(usDD);
  if (vix != null) score += vix >= 30 ? -1 : vix < 20 ? 1 : 0;
  return { score, regime: score <= -2 ? "bear" : score >= 2 ? "bull" : "side" };
}
const quarterOf = d => `${d.slice(0, 4)}Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`;

async function main() {
  const now = new Date().toISOString();
  const log = { ok: [], skip: [] };
  const old = Object.fromEntries((await sel("market", "select=id,data")).map(r => [r.id, r.data]));
  const prevItems = old.latest?.items || {};

  // 1) 시장 지표
  const items = { ...prevItems };
  const tryIt = async (key, fn) => { try { items[key] = await fn(); log.ok.push(key); } catch (e) { log.skip.push(`${key}: ${e.message}`); } };
  await tryIt("kr", async () => { const y = await yahoo("^KS11", "1y"); return { value: round(y.price), chg: round(y.chg), high52: round(y.high), asOf: `${md(y.date)} 마감` }; });
  await tryIt("us", async () => { const y = await yahoo("^GSPC", "1y"); return { value: round(y.price), chg: round(y.chg), high52: round(y.high), asOf: `${md(y.date)} 마감` }; });
  await tryIt("vix", async () => { const y = await yahoo("^VIX"); return { value: round(y.price), chg: round(y.chg), asOf: `${md(y.date)} 마감` }; });
  await tryIt("fx", async () => { const y = await yahoo("KRW=X"); return { value: round(y.price, 1), chg: round(y.chg), asOf: `${md(y.date)}` }; });
  await tryIt("us10y", async () => { const y = await yahoo("^TNX"); const v = y.price > 20 ? y.price / 10 : y.price; return { value: round(v), asOf: `${md(y.date)}` }; });
  const coins = await upbit(["BTC", "ETH"]);
  for (const c of ["BTC", "ETH"]) if (coins[c]) { items[c.toLowerCase()] = { value: Math.round(coins[c].price), chg: round(coins[c].chg), asOf: `${md(coins[c].date)} 업비트` }; log.ok.push(c); }
  // 금 1g (원): 국제 금 선물(달러/온스) × 환율 ÷ 31.1035
  let goldKRW = null;
  try {
    const g = await yahoo("GC=F");
    const fx = items.fx?.value;
    if (fx) { goldKRW = { price: Math.round(g.price * fx / 31.1035), chg: g.chg, date: g.date }; items.gold = { value: goldKRW.price, chg: round(g.chg), asOf: `${md(g.date)} 국제 금 환산` }; log.ok.push("gold"); }
  } catch (e) { log.skip.push("gold: " + e.message); }

  const dataDate = kstDate();
  await upsert("market", [{ id: "latest", data: { updated: dataDate, source: "Yahoo Finance·네이버 증권·업비트", items }, updated_at: now }]);

  // 2) 분기 시장 기록
  const dd = x => x?.high52 ? round((x.value / x.high52 - 1) * 100) : null;
  const krDD = dd(items.kr), usDD = dd(items.us), vix = items.vix?.value ?? null;
  const rg = regime(krDD, usDD, vix);
  const quarters = { ...(old.quarters || {}), [quarterOf(dataDate)]: { krDD, usDD, vix, ...rg, updated: dataDate } };
  await upsert("market", [{ id: "quarters", data: quarters, updated_at: now }]);

  // 3) 등록된 종목 시세
  const tickers = await sel("tickers", "select=code,name,cls,ccy");
  const want = new Map(tickers.map(t => [t.code, t]));
  for (const c of ["BTC", "ETH"]) if (!want.has(c)) want.set(c, { code: c, name: c, cls: "crypto", ccy: "KRW" });
  if (!want.has("KRXGOLD")) want.set("KRXGOLD", { code: "KRXGOLD", name: "KRX 금현물 1g", cls: "gold", ccy: "KRW" });

  const cryptoCodes = [...want.values()].filter(t => t.cls === "crypto").map(t => t.code.toUpperCase());
  const cq = await upbit(cryptoCodes);
  const rows = [];
  for (const t of want.values()) {
    const code = String(t.code);
    try {
      let q;
      if (t.cls === "crypto") { q = cq[code.toUpperCase()]; if (!q) throw new Error("upbit 없음"); }
      else if (code === "KRXGOLD") { if (!goldKRW) throw new Error("금 시세 없음"); q = goldKRW; }
      else if (/^[0-9A-Z]{6}$/.test(code) && /\d/.test(code) && t.ccy !== "USD") q = await krQuote(code);
      else q = await usQuote(code);
      rows.push({ code: safeId(code), data: { price: q.price, chg: round(q.chg), date: q.date, ccy: t.ccy || "KRW", name: t.name || code }, updated_at: now });
      log.ok.push(code);
    } catch (e) { log.skip.push(`${code}: ${e.message}`); }
    await sleep(200);
  }
  await upsert("prices", rows);

  console.log(`갱신 ${log.ok.length}건: ${log.ok.join(", ")}`);
  if (log.skip.length) console.log(`건너뜀 ${log.skip.length}건:\n- ` + log.skip.join("\n- "));
}

main().catch(e => { console.error(e); process.exit(1); });
