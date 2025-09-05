// server.js — HALPhodl Helio donation tracker (standalone)
// Routes:
//   GET  /helio-widget  -> full fishbowl page for <iframe> (supports ?goal=&currency=&bean=)
//   GET  /helio/total   -> { total, currency }
//   POST /helio/webhook -> Helio webhook (idempotent)
// Minimal: in-memory total (upgrade to DB later if you want).

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

// ===== Config =====
const PORT = process.env.PORT || 3000;
const CURRENCY = process.env.CURRENCY || "USD";
// iframe is read-only; you can lock to your domain later if you prefer
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const HELIO_WEBHOOK_SECRET = process.env.HELIO_WEBHOOK_SECRET || "";

// ===== In-memory state (resets on restart) =====
let total = 0;
let seenTx = new Set();

// ===== Middleware =====
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(cors({ origin: CORS_ORIGIN }));

// ===== Helpers =====
function safeGet(obj, keys, fallback) {
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  return fallback;
}
function verifySignature(req) {
  if (!HELIO_WEBHOOK_SECRET) return true;
  const sigHeader = req.get("x-helio-signature") || req.get("X-Helio-Signature");
  if (!sigHeader) return false;
  const expected = crypto.createHmac("sha256", HELIO_WEBHOOK_SECRET).update(req.rawBody).digest("hex");
  const given = sigHeader.startsWith("sha256=") ? sigHeader.slice(7) : sigHeader;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

// ===== API =====
app.get("/healthz", (_req, res) => res.send("ok"));

app.get("/helio/total", (_req, res) => {
  res.json({ total, currency: CURRENCY });
});

app.post("/helio/webhook", (req, res) => {
  try {
    if (!verifySignature(req)) return res.status(401).send("invalid signature");

    const body = req.body || {};
    const txId = safeGet(body, ["txId","id","transactionId","reference"], crypto.randomUUID());
    const amount = Number(safeGet(body, ["amountUsd","usdAmount","amount"], 0)) || 0;

    if (amount <= 0) return res.status(200).send("ignored");
    if (!seenTx.has(txId)) { seenTx.add(txId); total += amount; }
    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    res.sendStatus(200); // avoid retry storms
  }
});

// ===== Widget page (iframe) =====
// Supports query params:
//   goal     -> number (default 50000)
//   currency -> string (default ENV CURRENCY or USD)
//   bean     -> URL to a small bean texture image (optional)
app.get("/helio-widget", (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  const backendURL = `${origin}/helio/total`;

  // Read query params
  const url = new URL(req.originalUrl, origin);
  const GOAL = Number(url.searchParams.get("goal") || 50000);
  const CURRENCY_Q = url.searchParams.get("currency");
  const CURRENCY_FINAL = (CURRENCY_Q || CURRENCY || "USD").toUpperCase();
  const BEAN_IMG = url.searchParams.get("bean") || ""; // if provided, we mix texture beans

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>HALPhodl — Helio Donations</title>
<style>
  :root{ --navy:#0c1730; --navy-2:#0f1d3f; --gold:#ff9d2e; --gold-2:#ffb54f;
         --cream:#ffe7c0; --white:#ffffff; --muted:#9fb1e6; --ring:rgba(255,157,46,.35); }
  html,body{margin:0;padding:0;background:#0c1730;color:var(--cream);font-family:Nunito,system-ui,-apple-system,Inter,Roboto,sans-serif}
  #halp-helio-widget{box-sizing:border-box;padding:20px;max-width:900px;margin:0 auto}
  .hx-card{background:linear-gradient(180deg,#101b38 0%,#0f1d3f 100%);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:18px;overflow:hidden}
  .hx-title{display:flex;align-items:center;gap:10px;margin:0 0 6px 0}
  .dot{width:10px;height:10px;border-radius:999px;background:var(--gold);box-shadow:0 0 0 6px var(--ring)}
  .hx-title h2{margin:0;color:var(--white);font-weight:800;font-size:clamp(18px,3.2vw,24px)}
  .hx-sub{margin:0 0 14px 26px;color:var(--muted);font-weight:600;font-size:clamp(13px,2vw,15px)}
  .hx-stats{display:grid;grid-template-columns:1fr;gap:14px;margin-bottom:16px}
  @media(min-width:720px){.hx-stats{grid-template-columns:1.1fr .9fr}}
  .hx-metric{background:#0c1730;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:baseline}
  .hx-metric b{font-size:clamp(18px,3.4vw,26px);color:var(--gold-2)}
  .hx-metric span{font-size:12px;color:var(--muted);font-weight:700;letter-spacing:.3px;text-transform:uppercase}
  .hx-bar{background:#0c1730;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:10px}
  .hx-bar-track{height:12px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden}
  .hx-bar-fill{height:100%;width:0%;background:linear-gradient(90deg,var(--gold) 0%,var(--gold-2) 100%);transition:width .9s ease}
  .hx-stage{position:relative;background:#0c1730;border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:14px;display:grid;grid-template-columns:1fr;gap:14px}
  @media(min-width:720px){.hx-stage{grid-template-columns:1fr 1fr;align-items:center}}
  .hx-bowl-wrap{position:relative;width:100%;aspect-ratio:1.4/1;display:grid;place-items:center;background:#0c1730;border-radius:12px}
  .hx-bowl{width:100%;height:100%}
  .hx-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .hx-legend{display:grid;gap:8px}
  .hx-legend h3{margin:0;color:var(--white);font-size:clamp(16px,3vw,20px)}
  .hx-legend p{margin:0;color:var(--muted);line-height:1.5;font-weight:600}
  .hx-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .hx-pill{padding:6px 10px;background:rgba(255,157,46,.12);border:1px solid var(--gold);color:var(--gold-2);border-radius:999px;font-weight:800;letter-spacing:.3px}
  .vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);border:0}
</style>
</head>
<body>
<section id="halp-helio-widget" data-backend="${backendURL}" data-goal="${GOAL}" data-currency="${CURRENCY_FINAL}" data-bean="${BEAN_IMG}">
  <div class="hx-card" role="group" aria-labelledby="helio-title">
    <div class="hx-title"><span class="dot"></span><h2 id="helio-title">Helio Fund — Live Donations</h2></div>
    <p class="hx-sub">Watch the beans fill the bowl as donations roll in.</p>
    <div class="hx-stats">
      <div class="hx-metric" aria-live="polite"><span>Total Raised</span><b id="hx-total">$0</b></div>
      <div class="hx-bar"><div class="hx-bar-track"><div id="hx-bar-fill" class="hx-bar-fill"></div></div><div class="vh"><span id="hx-percent">0%</span> of goal reached.</div></div>
    </div>
    <div class="hx-stage">
      <div class="hx-bowl-wrap">
        <svg class="hx-bowl" viewBox="0 0 700 500" role="img" aria-label="Donation fishbowl">
          <defs>
            <clipPath id="bowlClip">
              <path d="M120,80 Q350,10 580,80 Q630,140 650,200 Q670,260 640,340 Q600,440 350,470 Q100,440 60,340 Q30,260 50,200 Q70,140 120,80Z"/>
            </clipPath>
            <linearGradient id="waterGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#ffb54f"/><stop offset="100%" stop-color="#ff9d2e"/>
            </linearGradient>
          </defs>
          <path d="M120,80 Q350,10 580,80 Q630,140 650,200 Q670,260 640,340 Q600,440 350,470 Q100,440 60,340 Q30,260 50,200 Q70,140 120,80Z"
            fill="rgba(255,255,255,0.06)" stroke="#ffffff" stroke-opacity="0.85" stroke-width="6"/>
          <g clip-path="url(#bowlClip)">
            <rect id="hx-water" x="0" y="500" width="700" height="0" fill="url(#waterGrad)"/>
            <ellipse cx="520" cy="120" rx="40" ry="18" fill="rgba(255,255,255,0.17)"/>
          </g>
        </svg>
        <canvas id="hx-beans" class="hx-canvas"></canvas>
      </div>
      <div class="hx-legend">
        <h3>Community Powered Giving</h3>
        <p>We are structured on strong hodling, community engagement, and regular charitable coin burns!</p>
        <div class="hx-row"><span class="hx-pill" id="hx-goal-pill">Goal: $50,000</span><span class="hx-pill" id="hx-pct-pill">0% reached</span></div>
      </div>
    </div>
  </div>
</section>

<script>
(function(){
  const root = document.getElementById('halp-helio-widget');
  const BACKEND_URL = root.getAttribute('data-backend');
  const GOAL = parseFloat(root.getAttribute('data-goal') || '50000');
  const CURRENCY = (root.getAttribute('data-currency') || 'USD').toUpperCase();
  const BEAN_URL = root.getAttribute('data-bean') || ""; // if provided, mix textured beans
  const POLL_MS = 30000;

  const elTotal = root.querySelector('#hx-total');
  const elBarFill = root.querySelector('#hx-bar-fill');
  const elPercent = root.querySelector('#hx-percent');
  const elWater = root.querySelector('#hx-water');
  const elGoalPill = root.querySelector('#hx-goal-pill');
  const elPctPill = root.querySelector('#hx-pct-pill');
  const canvas = root.querySelector('#hx-beans');
  const bowl = root.querySelector('.hx-bowl');

  const fmt = n => new Intl.NumberFormat('en-US',{style:'currency',currency:CURRENCY,maximumFractionDigits:0}).format(n);
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  elGoalPill.textContent = 'Goal: ' + fmt(GOAL);

  function sizeCanvas(){
    const r = bowl.getBoundingClientRect();
    canvas.width = Math.max(320, Math.floor(r.width));
    canvas.height = Math.max(200, Math.floor(r.height));
  }
  sizeCanvas(); addEventListener('resize', sizeCanvas);
  const ctx = canvas.getContext('2d');

  // Bean texture image (optional)
  const beanImg = new Image();
  if (BEAN_URL) beanImg.src = BEAN_URL;

  // Particles
  let beans = [];
  function spawnBeans(count, targetPct){
    for(let i=0;i<count;i++){
      const w=canvas.width,h=canvas.height,size=6+Math.random()*10;
      beans.push({
        x:Math.random()*w, y:-20-Math.random()*40,
        vy:1.5+Math.random()*2.5, rot:Math.random()*Math.PI*2, vr:(Math.random()-.5)*0.08,
        size, targetStopY:h-(h*(targetPct/100))-(Math.random()*8),
        useImage: !!BEAN_URL && Math.random() < 0.6 // ~60% textured beans if provided
      });
    }
  }
  function drawBean(b){
    ctx.save(); ctx.translate(b.x,b.y); ctx.rotate(b.rot);
    if (b.useImage && beanImg.complete && beanImg.naturalWidth){
      const s = b.size*2.0;
      ctx.drawImage(beanImg, -s*0.5, -s*0.5, s, s);
    } else {
      ctx.beginPath(); ctx.ellipse(0,0,b.size*0.7,b.size,0,0,Math.PI*2);
      const g = ctx.createRadialGradient(-b.size*0.2,-b.size*0.2,1,0,0,b.size);
      g.addColorStop(0,'#ffb54f'); g.addColorStop(1,'#ff9d2e'); ctx.fillStyle=g; ctx.fill();
    }
    ctx.restore();
  }
  function clearStage(){ ctx.fillStyle='#0c1730'; ctx.fillRect(0,0,canvas.width,canvas.height); }
  function tick(){ clearStage(); for(let i=0;i<beans.length;i++){ const b=beans[i]; b.y+=b.vy; b.rot+=b.vr;
    if(b.y>b.targetStopY){ b.y=b.targetStopY+Math.sin(performance.now()/250+i)*0.5; b.vy=0; b.vr*=0.95; } drawBean(b); }
    requestAnimationFrame(tick); }

  function setFill(pct){
    const p = clamp(pct,0,100);
    elBarFill.style.width = p + '%';
    elPctPill.textContent = Math.round(p) + '% reached';
    if(elPercent) elPercent.textContent = Math.round(p) + '%';
    const totalH = 500, h = (p/100)*totalH;
    elWater.setAttribute('y', String(totalH - h));
    elWater.setAttribute('height', String(h));
  }

  let lastPct=0;
  async function fetchTotal(){
    try{
      const res = await fetch(BACKEND_URL,{cache:'no-store'});
      if(!res.ok) throw new Error('bad response');
      const data = await res.json();
      const total = Number(data.total ?? 0);
      const pct = clamp((total/GOAL)*100,0,100);
      elTotal.textContent = fmt(total);
      setFill(pct);
      const delta = clamp(pct - lastPct, 0, 100);
      spawnBeans(delta>0 ? Math.max(4, Math.round(delta*1.5)) : 1, pct);
      lastPct = pct;
    }catch(_e){
      spawnBeans(1,lastPct);
    }
  }

  setFill(0); spawnBeans(12,0); tick(); fetchTotal();
  setInterval(fetchTotal, POLL_MS);
  setInterval(()=>spawnBeans(1,lastPct), 1200);
})();
</script>
</body>
</html>`);
});

// ===== Start =====
app.listen(PORT, () => console.log("HALPhodl Helio tracker on :" + PORT));
