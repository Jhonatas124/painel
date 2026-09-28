/* Painel de Bolso 1.1 — script principal do painel (gerado de painel.html por montar_app.py).
   Só código: os dados chegam trancados do cofre e são injetados antes deste arquivo. */
"use strict";
/* ══════════════════════════════════════════════════════════════════════════
   PAINEL v23 — a camada de tela.

   O motor de dados (contas de venda, câmbio, retenção, cota, carimbo) é o mesmo
   que já estava rodando e conferido — ele vem inteiro, sem uma vírgula mudada,
   no bloco MOTOR lá embaixo. O que foi refeito do zero é tudo que aparece: a
   ordem das seções, o desenho, os gráficos e o movimento.
   ══════════════════════════════════════════════════════════════════════════ */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ——— o que fica guardado no navegador entre uma visita e outra ——— */
const guardado = (k, padrao) => { try { return localStorage.getItem(k) || padrao; } catch(e){ return padrao; } };
const guardar  = (k, v) => { try { localStorage.setItem(k, v); } catch(e){} };

/* ——— estado ——— */
let periodo = guardado("painel-periodo", "90");
let modo    = guardado("painel-modo", "principal");
let ordem   = "views";
let limite  = 40;
let tela    = null;                 // null = Visão geral
let player = null, videoAberto = null, vigia = null;
let VENDAS_CARREGANDO = true;
let VENDAS_LIVE = null;
let carimbando = false;
let _canalCache = new Map();
let ritmoCache = {};
let _mapaRastreado = null;
let medCache = {};
let baseRet;
let gDin = "dia", gMom = "dias";
let _mexendoURL = false;

const CACHE_VENDAS = "painel-vendas-v1";
const CHAVE_ABAS   = "painel-secoes-off-v1";
const MIN_DIAS_RASTREIO = 7;
const INICIO_TRACKING_PADRAO = "2026-09-14";
const NOME_CANAL = {recuperacao: "recuperada", trafego: "de tráfego pago"};
const ARQUIVO = location.protocol === "file:";
const FAIXAS_DIAS  = [[0,1,"24 horas"],[2,3,"3 dias"],[4,7,"7 dias"],[8,14,"14 dias"],
                      [15,30,"30 dias"],[31,90,"90 dias"],[91,1e9,"90 dias +"]];
const FAIXAS_VIEWS = [[0,999,"1k"],[1000,4999,"5k"],[5000,19999,"20k"],
                      [20000,49999,"50k"],[50000,199999,"100k"],[200000,1e12,"200k +"]];

/* ——— formatadores ——— */
const nf  = n => (n==null||isNaN(n)) ? "–" : Math.round(n).toLocaleString("pt-BR");
const sinal = n => (n>0?"+":"") + nf(n);
const brl = n => (Number(n)||0).toLocaleString("pt-BR", {minimumFractionDigits:2, maximumFractionDigits:2});
/* R$ 13.752 com os centavos menores — o olho lê o inteiro, o centavo fica de nota de rodapé */
const dinheiro = n => {
  const v = Math.abs(Number(n) || 0);
  const i = Math.floor(v).toLocaleString("pt-BR");
  const c = Math.round((v - Math.floor(v)) * 100).toString().padStart(2, "0");
  return `${n<0?"−":""}R$ ${i}<span class="cent">,${c}</span>`;
};
const hms = s => { s=Math.round(s||0); const m=Math.floor(s/60);
  return (m>=60 ? Math.floor(m/60)+":"+String(m%60).padStart(2,"0") : m) + ":" + String(s%60).padStart(2,"0"); };
const dt  = s => s ? String(s).slice(0,10).split("-").reverse().join("/") : "";
const dm  = s => { const p = String(s||"").slice(0,10).split("-"); return p.length===3 ? p[2]+"/"+p[1] : ""; };
const curto = n => n >= 1e6 ? (n/1e6).toFixed(1).replace(".",",")+"M"
                 : n >= 1000 ? (n/1000).toFixed(n < 1e4 ? 1 : 0).replace(".",",")+"k"
                 : String(Math.round(n));
const corta = (s, n) => {
  s = String(s || "");
  if (s.length <= n) return s;
  let c = s.slice(0, n);
  const esp = c.lastIndexOf(" ");
  if (esp > n * 0.6) c = c.slice(0, esp);
  return c.replace(/[\s(\[{,.;:\-–—]+$/, "") + "…";
};
/* escapa TUDO que pode quebrar um atributo — título de vídeo já veio com aspas dentro */
const esc = s => String(s==null?"":s).replace(/[<>&"']/g,
  c => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c]));
const mediana = a => { if(!a.length) return 0; const b=[...a].sort((x,y)=>x-y), m=b.length>>1;
  return b.length%2 ? b[m] : (b[m-1]+b[m])/2; };
const isoLocal = d => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0")
                                      + "-" + String(d.getDate()).padStart(2,"0");
const diasEntre = (a, b) => Math.round((new Date(b+"T00:00:00") - new Date(a+"T00:00:00"))/86400000);
const semAcento = t => String(t||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();

/* ——— moeda ——— */
const MOEDA  = () => (typeof DADOS !== "undefined" && DADOS && DADOS.moeda) || "USD";
const SIMB   = () => ({BRL:"R$", USD:"US$", EUR:"€"}[MOEDA()] || (MOEDA()+" "));
const CAMBIO = () => (typeof DADOS !== "undefined" && DADOS && DADOS.cambio) || null;
const din    = n => SIMB() + " " + brl(n);
const emReal = (n, k) => {
  const t = taxaDaJanela(k);
  if (!t || MOEDA() !== "USD") return "";
  return `<span class="conv" title="${esc(fonteDaTaxa(k))}">≈ R$ ${brl(n * t)}</span>`;
};
const dinDuplo = n => din(n) + emReal(n);

/* ——— períodos ——— */
const NOME_PERIODO = {hoje:"Hoje", ontem:"Ontem", mes:"Este mês", "7":"7 dias", "28":"28 dias",
                      "60":"60 dias", "90":"90 dias", "365":"365 dias"};
function frasePeriodo(){
  const p = (NOME_PERIODO[periodo] || periodo).toLowerCase();
  if (p === "hoje") return "hoje";
  if (p === "ontem") return "ontem";
  if (p === "este mês") return "neste mês";
  return "nos últimos " + p;
}

/* ═══ SUA PARTE (18/09/2026) ═══
   "O painel é meu, então faz sentido ter o meu valor em destaque." Todo dinheiro da Assiny
   aparece assim: em cima, grande, a parte dele; embaixo, pequeno, o total da venda.
   A base é o LÍQUIDO (já sem a taxa da Assiny) — é o que o recebedor ao vivo guarda
   (net_amount) e o que o histórico importa (ValorLiquido), então as telas nunca discordam.
   O percentual vem de dados/vendas/canais.js (comissao de cada canal). AdSense e Meta Ads
   NÃO passam por aqui: AdSense é 100% dele e investimento em anúncio não é venda. */
const PARTE_PADRAO = 50;
function pctParte(canal){
  const c = (typeof CANAIS_CFG !== "undefined" && CANAIS_CFG) ? CANAIS_CFG[canal || "organico"] : null;
  return (c && c.comissao != null) ? +c.comissao : PARTE_PADRAO;
}
const parte = (v, canal) => (+v || 0) * pctParte(canal) / 100;
/* a linha de baixo: o total da venda, antes da divisão */
const deTotal = (v, extra) => `<div class="bruto">de R$ ${nf(v)} no total${extra ? " · " + extra : ""}</div>`;

/* ——— plataformas: a pergunta central deste painel ——— */
const origemDe = o => {
  const t = String(o || "").toLowerCase();
  if (t.includes("you") || t === "yt") return "youtube";
  if (t.includes("insta") || t === "ig") return "instagram";
  if (t.includes("tik") || t === "tk") return "tiktok";
  /* material gratuito (18/09/2026): o link que vai dentro de PDF usa utm_source=pdf */
  if (t.includes("pdf")) return "pdf";
  return "outra";
};
const PLAT = {
  youtube:   {rot:"YouTube",   cor:"var(--yt)", cls:"yt"},
  instagram: {rot:"Instagram", cor:"var(--ig)", cls:"ig"},
  tiktok:    {rot:"TikTok",    cor:"var(--tk)", cls:"tk"},
  pdf:       {rot:"PDF",       cor:"var(--pdf)",cls:"pdf"},
  outra:     {rot:"Sem origem",cor:"var(--nt)", cls:""},
};

/* ——— ícones (traço de 1.7px, o mesmo peso em todos) ——— */
const IC = {
  visao:  '<path d="M4 13.5 10 7l4 4 6-6.5"/><path d="M3.5 20h17"/>',
  vendas: '<path d="M12 3v18"/><path d="M16.5 7.5c0-1.9-2-3-4.5-3s-4.5 1-4.5 3 2 2.6 4.5 3.2 4.5 1.3 4.5 3.3-2 3-4.5 3-4.5-1.1-4.5-3"/>',
  plat:   '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  pago:   '<rect x="2.5" y="5.5" width="19" height="13" rx="3"/><path d="M2.5 10h19"/><path d="M6.5 14.5h3"/>',
  recup:  '<path d="M3.5 12a8.5 8.5 0 1 1 2.8 6.3"/><path d="M3.5 19v-5h5"/>',
  publico:'<circle cx="9" cy="8" r="3.2"/><path d="M2.8 19c0-3.4 2.8-5.5 6.2-5.5s6.2 2.1 6.2 5.5"/><path d="M16.5 5.6a3.2 3.2 0 0 1 0 5.6"/><path d="M18 19c0-2.4-.9-4.2-2.4-5.2"/>',
  videos: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="m10 9.5 5 2.5-5 2.5z"/>',
  sol:    '<circle cx="12" cy="12" r="4"/><path d="M12 3v1.6M12 19.4V21M4.2 4.2l1.2 1.2M18.6 18.6l1.2 1.2M3 12h1.6M19.4 12H21M4.2 19.8l1.2-1.2M18.6 5.4l1.2-1.2"/>',
  lua:    '<path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z"/>',
  seta:   '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
  mais:   '<path d="M12 6v12M6 12h12"/>',
  alerta: '<path d="M12 8.5v4.5"/><path d="M12 16.5h.01"/><path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  troe:   '<path d="M12 2.5 14.6 9h6.9l-5.6 4.1 2.2 6.6L12 15.6l-6.1 4.1 2.2-6.6L2.5 9h6.9z"/>',
  relogio:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
  ideia:  '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
  radar:  '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18.5 5.5"/><circle cx="12" cy="12" r="1.2"/>',
  conc:   '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  calend: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
};
const ico = (k, cls) => `<svg class="ico${cls?" "+cls:""}" viewBox="0 0 24 24">${IC[k]||""}</svg>`;

/* ══════════ AS SEÇÕES ══════════
   A ordem aqui é a prioridade do painel, e ela mudou de propósito na v23:
   DINHEIRO primeiro, PLATAFORMA depois, AUDIÊNCIA por último. A versão antiga abria
   em "views", que é o dado mais fácil de conseguir — não o que responde a pergunta.  */
const SECOES = [
  {k:"visao",   rot:"Visão geral",   grupo:"Painel",    ic:"visao"},
  {k:"vendas",  rot:"Vendas",        grupo:"Dinheiro",  ic:"vendas"},
  {k:"hist",    rot:"Histórico",     grupo:"Dinheiro",  ic:"calend"},
  {k:"plat",    rot:"Por plataforma",grupo:"Dinheiro",  ic:"plat"},
  {k:"pago",    rot:"Tráfego pago",  grupo:"Dinheiro",  ic:"pago"},
  {k:"recup",   rot:"Recuperação",   grupo:"Dinheiro",  ic:"recup"},
  {k:"publico", rot:"Audiência",     grupo:"YouTube",   ic:"publico"},
  {k:"videos",  rot:"Vídeos",        grupo:"YouTube",   ic:"videos"},
  {k:"ideias",  rot:"Próximo vídeo", grupo:"YouTube",   ic:"ideia"},
  {k:"radar",   rot:"Radar",         grupo:"YouTube",   ic:"radar"},
  {k:"conc",    rot:"Concorrência",  grupo:"YouTube",   ic:"conc"},
];
const FIXAS = new Set(["visao", "videos"]);
const TIT = {
  visao:  ["Visão geral",    "o dinheiro que entrou e de onde ele veio"],
  vendas: ["Vendas",         "cada compra, o horário, e qual vídeo trouxe"],
  hist:   ["Histórico",      "o dinheiro mês a mês, desde antes do rastreio ao vivo"],
  plat:   ["Por plataforma", "YouTube · Instagram · TikTok — quem está vendendo"],
  pago:   ["Tráfego pago",   "o que o Meta Ads gastou e o que voltou"],
  recup:  ["Recuperação",    "as vendas que o time recuperou"],
  publico:["Audiência",      "views, inscritos e de onde vem o público"],
  videos: ["Vídeos",         "o catálogo inteiro, ordenável por qualquer coluna"],
  ideias: ["Próximo vídeo",  "três opções — uma pra vender, uma pra crescer, uma pra trazer público novo"],
  radar:  ["Radar",          "os vídeos de outros canais que mandam público pra você"],
  conc:   ["Concorrência",   "o que os concorrentes postaram, por que deu bom, e o que você ainda não testou"],
};
function secoesOff(){
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_ABAS) || "[]")); }
  catch(e){ return new Set(); }
}
const secaoLigada = k => FIXAS.has(k) || !secoesOff().has(k);
function alternarSecao(k){
  if (FIXAS.has(k)) return;
  const off = secoesOff();
  off.has(k) ? off.delete(k) : off.add(k);
  try { localStorage.setItem(CHAVE_ABAS, JSON.stringify([...off])); } catch(e){}
  if (tela && !secaoLigada(tela)) tela = null;
  desenhar();
}

/* ——— colunas da tabela ——— */
const COL = {
  views:       {r:"Views",      fmt:v=>nf(v.views),               get:v=>v.views},
  inscritos:   {r:"Inscritos",  fmt:v=>sinal(v.inscritos),        get:v=>v.inscritos},
  ins_1k:      {r:"Insc/1k",    fmt:v=>v.ins_1k.toFixed(1),       get:v=>v.ins_1k,
                aj:"inscritos ganhos a cada 1.000 views — separa vídeo que viralizou de vídeo que converteu"},
  avg_pct:     {r:"% assist.",  fmt:v=>v.avg_pct.toFixed(1)+"%",  get:v=>v.avg_pct},
  avg_watch_s: {r:"Tempo méd.", fmt:v=>hms(v.avg_watch_s),        get:v=>v.avg_watch_s},
  watch_h:     {r:"Horas",      fmt:v=>nf(Math.round(v.watch_h)), get:v=>v.watch_h},
  comentarios: {r:"Coment.",    fmt:v=>nf(v.comentarios),         get:v=>v.comentarios},
  shares:      {r:"Compart.",   fmt:v=>nf(v.shares),              get:v=>v.shares},
  likes:       {r:"Likes",      fmt:v=>nf(v.likes),               get:v=>v.likes},
  eng_1k:      {r:"Eng/1k",     fmt:v=>v.eng_1k.toFixed(0),       get:v=>v.eng_1k},
  vendas:      {r:"Vendas",     fmt:v=>{const d=semSaber(v.id);
                  if (d===null) return '<span class="nd">–</span>';
                  if (!d.n) return '<span class="nd">0</span>';
                  return `<span class="vendalink" title="ver as compras deste vídeo"
                    onclick="event.stopPropagation();abrirVendas('${v.id}')">${nf(d.n)}</span>`;},
                get:v=>{const d=semSaber(v.id); return d===null ? -1 : d.n;},
                aj:"vendas atribuídas a este vídeo pelo utm_content — “–” quer dizer que o vídeo não está marcado, não que vendeu zero"},
  ritmo:       {r:"Ritmo",      fmt:v=>{const p=ritmoDo(v.id);
                  return p ? `<span class="ritmo ${p.cls}" title="${esc(p.dica)}">${p.txt}</span>`
                           : '<span class="nd">–</span>';},
                get:v=>{const p=ritmoDo(v.id); return p ? p.r : -1;},
                aj:"como este vídeo foi na mesma idade que os outros — só vídeos dos últimos 120 dias têm esse dado"},
  rpm:         {r:"RPM",        fmt:v=>(v.adsense==null||!v.views) ? '<span class="nd">–</span>'
                  : dinDuplo(v.adsense/v.views*1000),
                get:v=>(v.adsense==null||!v.views) ? -1 : v.adsense/v.views*1000,
                aj:"quanto o YouTube te paga a cada 1.000 views — o mesmo RPM que o Studio mostra"},
  venda_1k:    {r:"Venda/1k",   fmt:v=>{const d=semSaber(v.id); const vr=viewsRastreadas(v.id);
                  if (vr===null) return `<span class="nd" title="a medição por vídeo começou em ${dt(inicioTracking()||"2026-09-14")} e ainda não há dia medido suficiente">–</span>`;
                  if (d===null || !vr || !d.receita) return '<span class="nd">–</span>';
                  return "R$ " + brl(parte(d.receita)/vr*1000) + `<span class="conv">de R$ ${brl(d.receita/vr*1000)}</span>`;},
                get:v=>{const d=semSaber(v.id); const vr=viewsRastreadas(v.id);
                  return (d===null||!vr) ? -1 : parte(d.receita)/vr*1000;},
                aj:"quanto da SUA PARTE da venda cada 1.000 views trouxe — contando só as views DEPOIS que o link deste vídeo passou a ser rastreado"},
  adsense:     {r:"AdSense",    fmt:v=>(v.adsense==null) ? '<span class="nd">–</span>' : dinDuplo(v.adsense),
                get:v=>v.adsense==null ? -1 : v.adsense,
                aj:"receita de anúncios do YouTube neste período — não tem nada a ver com as vendas"},
};
const MODOS = {
  principal: ["views","ritmo","avg_pct","vendas","venda_1k","rpm","ins_1k"],
  tudo:      ["views","ritmo","avg_pct","vendas","venda_1k","adsense","rpm","ins_1k","inscritos","avg_watch_s","watch_h","comentarios","shares","likes","eng_1k"],
};
const ORDEM_PADRAO = {principal:"views", tudo:"views"};

/* ——— o selo de vendas ao vivo, na lateral ——— */
function marcarAoVivo(txt, cls){
  const el = $("#vivo"), t = $("#vivoTxt");
  if (!el || !t) return;
  t.innerHTML = txt;
  el.className = "vivo " + (cls || "");
}

/* ——— a lista de vídeos do período, já filtrada e ordenada ——— */
function linhas(){
  const j = DADOS.janelas[periodo];
  if (!j) return [];
  const cx = $("#busca");
  const q = (cx && !cx.hidden ? cx.value : "").trim().toLowerCase();
  return j.videos
    .map(v => ({...v, m: DADOS.videos[v.id] || null}))
    .filter(v => v.m)
    .filter(v => !q || v.m.titulo.toLowerCase().includes(q))
    .sort((a,b) => COL[ordem].get(b) - COL[ordem].get(a));
}


/* ══════════════════════════════════════════════════════════════════════════
   GRÁFICOS — todos desenhados aqui, do zero.

   Regra que vale pros três: uma pergunta por gráfico, nenhum eixo duplo, nenhum
   número em cima de toda barra, e a cor só entra quando ela significa alguma
   coisa (a plataforma). Entram animados — a linha se desenha, a área aparece,
   a coluna cresce da base — tudo na mesma curva do resto da interface.
   ══════════════════════════════════════════════════════════════════════════ */

/* peças comuns ------------------------------------------------------------ */
function caixaGrafico(idSvg, corpo, altura){
  return `<div class="svgb" id="${idSvg}-box">
    <svg viewBox="0 0 ${altura.w} ${altura.h}" class="gsvg" id="${idSvg}"
      preserveAspectRatio="none" style="max-height:${altura.max||280}px">${corpo}</svg>
    <div class="dica" id="${idSvg}-dica"></div></div>`;
}
/* ═══ O GRÁFICO QUE RESPONDE (22/09/2026) ═══
   Pedido dele: "passo o mouse em cima de qualquer gráfico e ele mostra exatamente o que aconteceu
   naquele dia". Antes a dica existia em alguns gráficos e só dizia o valor do ponto. Agora:
   · uma dica só pro painel inteiro (fica por cima de tudo, não é cortada pelo cartão escuro);
   · uma linha-guia vertical que segue o mouse e uma bolinha em cima de cada linha;
   · funciona no dedo (celular) — é pointer, não mouse;
   · nos gráficos de DIA, a dica é o DIA INTEIRO: vendas, quem vendeu, reembolso, views e
     inscritos do canal, AdSense, R$ por mil views e o que foi publicado naquele dia.
   Os números do lado do YouTube vêm de DADOS.canal_dia (coletor, a partir de 22/09/2026). */
function dicaG(){
  let d = document.getElementById("dicaG");
  if (!d){ d = document.createElement("div"); d.id = "dicaG"; d.className = "dica dicaG"; document.body.appendChild(d); }
  return d;
}
function posDica(D, x, y){
  const w = D.offsetWidth, h = D.offsetHeight, W = innerWidth, H = innerHeight;
  let l = x + 18; if (l + w > W - 8) l = x - w - 18; if (l < 8) l = Math.max(8, (W - w)/2);
  let t = y - h/2; t = Math.min(Math.max(t, 8), H - h - 8);
  D.style.left = l + "px"; D.style.top = t + "px";
}
function ligarDica(idSvg, texto, opt){
  opt = opt || {};
  const svg = $("#"+idSvg), box = $("#"+idSvg+"-box");
  if (!svg || !box) return;
  const alvos = [...svg.querySelectorAll(".alvo")].map(h => ({i:+h.dataset.i,
    x:+h.getAttribute("x"), w:+h.getAttribute("width")}));
  if (!alvos.length) return;
  const vb = svg.viewBox.baseVal, D = dicaG();
  let guia = box.querySelector(":scope > .guia");
  if (!guia){ guia = document.createElement("div"); box.appendChild(guia); }
  guia.className = "guia" + (opt.faixa ? " faixa" : "");
  let pinos = [], atual = -1;
  const esconder = () => { atual = -1; D.classList.remove("ver"); guia.classList.remove("ver");
    pinos.forEach(p => p.remove()); pinos = []; };
  const mostrar = ev => {
    const r = svg.getBoundingClientRect(), rb = box.getBoundingClientRect();
    if (!r.width) return;
    const vx = (ev.clientX - r.left) / r.width * vb.width;
    let a = alvos.find(a => vx >= a.x && vx < a.x + a.w);
    if (!a) a = alvos.reduce((m, b) => Math.abs(b.x + b.w/2 - vx) < Math.abs(m.x + m.w/2 - vx) ? b : m);
    if (a.i !== atual){
      const t = texto(a.i);
      if (!t){ esconder(); return; }
      atual = a.i;
      D.innerHTML = t;
      const esc_ = r.width / vb.width, cx = r.left - rb.left + (a.x + a.w/2) * esc_;
      if (opt.faixa){ const w = a.w * esc_; guia.style.left = (cx - w/2) + "px"; guia.style.width = w + "px"; }
      else { guia.style.left = cx + "px"; guia.style.width = ""; }
      guia.style.top = (r.top - rb.top) + "px"; guia.style.height = r.height + "px";
      guia.classList.add("ver");
      pinos.forEach(p => p.remove()); pinos = [];
      (opt.pontos ? opt.pontos(a.i) || [] : []).forEach(p => {
        const e = document.createElement("i"); e.className = "pino";
        e.style.left = (r.left - rb.left + (p.x != null ? p.x : a.x + a.w/2) * esc_) + "px";
        e.style.top  = (r.top - rb.top + p.y / vb.height * r.height) + "px";
        e.style.setProperty("--c", p.cor || "var(--ac)");
        box.appendChild(e); pinos.push(e);
      });
    }
    D.classList.add("ver");
    posDica(D, ev.clientX, ev.clientY);
  };
  svg.style.touchAction = "pan-y";
  svg.onpointermove = mostrar; svg.onpointerdown = mostrar; svg.onpointerleave = esconder;
}
/* dica de qualquer elemento com data-dica (rosca, barras deitadas): uma vez só, pro documento */
(function dicaSolta(){
  let dono = null;
  document.addEventListener("pointerover", ev => {
    const el = ev.target.closest && ev.target.closest("[data-dica]");
    const D = dicaG();
    if (!el){ if (dono){ dono = null; D.classList.remove("ver"); } return; }
    if (el !== dono){ dono = el; D.innerHTML = el.getAttribute("data-dica"); }
    D.classList.add("ver"); posDica(D, ev.clientX, ev.clientY);
  });
  document.addEventListener("pointermove", ev => { if (dono) posDica(dicaG(), ev.clientX, ev.clientY); });
  document.addEventListener("scroll", () => { dono = null; dicaG().classList.remove("ver"); }, {passive:true});
})();

/* ——— o índice do dia: tudo que aconteceu, por data ——— */
const DSEM = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
const diaSemana = iso => DSEM[new Date(String(iso).slice(0,10) + "T00:00:00").getDay()];
let _idxDia = null, _idxDiaDe = null;
function indiceDoDia(){
  const d = dadosVendas();
  if (_idxDia && _idxDiaDe === d && _idxDia.dados === DADOS) return _idxDia;
  const V = {}, pega = k => V[k] = V[k] || {n:0, r:0, plat:{}, vids:{}, semVid:0, nb:0, rb:0};
  if (d){
    Object.entries(d.por_marca || {}).forEach(([marca, dd]) => (dd.compras || []).forEach(c => {
      const k = (c.data || "").slice(0,10); if (!k) return;
      const x = pega(k), val = +c.valor || 0;
      x.n++; x.r += val;
      const o = origemDe(c.origem); x.plat[o] = (x.plat[o] || 0) + val;
      const vid = marca === MARCA_HIST ? null : idDaMarca(marca);
      if (vid){ const v = x.vids[vid] = x.vids[vid] || {n:0, r:0}; v.n++; v.r += val; }
      else x.semVid++;
    }));
    (d.movimento || []).forEach(m => { if (m.tipo !== "baixa" || !m.data) return;
      const x = pega(m.data.slice(0,10)); x.nb++; x.rb += +m.valor || 0; });
  }
  const pub = {};
  Object.entries((typeof DADOS !== "undefined" && DADOS.videos) || {}).forEach(([id, m]) => {
    if (m.publicado) (pub[m.publicado] = pub[m.publicado] || []).push(id); });
  _idxDia = {vendas: V, pub, dados: (typeof DADOS !== "undefined" ? DADOS : null)}; _idxDiaDe = d;
  return _idxDia;
}
function fxDoDia(iso){
  const C = CAMBIO(); if (!C) return null;
  const s = C.serie || {};
  if (s[iso]) return s[iso];
  const ant = Object.keys(s).filter(k => k <= iso).sort().pop();
  return ant ? s[ant] : (C.usd_brl || null);
}
/* o texto da dica de um dia. opt.topo: uma linha extra logo abaixo da data (o valor do gráfico) */
function resumoDoDia(iso, opt){
  opt = opt || {};
  iso = String(iso).slice(0,10);
  const X = indiceDoDia(), v = X.vendas[iso], hoje = iso === isoLocal(new Date());
  let h = `<div class="dd-cab"><b>${diaSemana(iso)}, ${dt(iso)}</b>${hoje ? ' <span class="l">· hoje, até agora</span>' : ""}</div>`;
  if (opt.topo) h += `<div class="dd-sec">${opt.topo}</div>`;
  marcosDoDia(iso).forEach(m => h += `<div class="dd-sec dd-marco">◆ ${esc(m.txt)}</div>`);

  /* vendas */
  if (v && v.n){
    h += `<div class="dd-sec"><div class="dd-t">Vendas</div><b>${v.n} venda${v.n===1?"":"s"}</b> · <b>R$ ${nf(parte(v.r))}</b> seus <span class="l">de R$ ${nf(v.r)}</span>`;
    const pl = Object.entries(v.plat).filter(([, r]) => r > 0).sort((a, b) => b[1] - a[1]);
    if (pl.length > 1 || (pl[0] && pl[0][0] !== "youtube"))
      h += `<div>${pl.map(([k, r]) => `<span class="dd-pt" style="background:${PLAT[k] ? PLAT[k].cor : "var(--t3)"}"></span>${PLAT[k] ? PLAT[k].rot : k} R$ ${nf(parte(r))}`).join(" &nbsp;")}</div>`;
    const tv = Object.entries(v.vids).sort((a, b) => b[1].r - a[1].r);
    tv.slice(0, 3).forEach(([id, x]) =>
      h += `<div class="dd-v"><span>${esc(corta(tituloDe(id).t, 40))}</span><b>${x.n}×</b></div>`);
    if (tv.length > 3) h += `<div class="l">+ ${tv.length - 3} vídeo${tv.length-3===1?"":"s"}</div>`;
    if (v.semVid) h += `<div class="l">${v.semVid} sem vídeo de origem${iso < inicioTracking() ? " (antes do rastreio, o link era um só)" : ""}</div>`;
    h += `</div>`;
  } else h += `<div class="dd-sec"><span class="l">Nenhuma venda nesse dia</span></div>`;
  const clq = cliquesDoDia(iso);
  if (clq) h += `<div class="dd-sec"><span class="l">${nf(clq)} clique${clq===1?"":"s"} na página de vendas</span></div>`;
  if (v && v.nb) h += `<div class="dd-sec"><span class="dd-neg">voltou ${v.nb} · R$ ${nf(parte(v.rb))} seus</span></div>`;

  /* YouTube */
  const c = ((typeof DADOS !== "undefined" && DADOS.canal_dia) || {})[iso];
  const ads = ((typeof DADOS !== "undefined" && DADOS.adsense_dia) || {})[iso];
  if (c || ads != null){
    const fx = fxDoDia(iso);
    const partes = [];
    if (c){ partes.push(`<b>${nf(c[0])}</b> views`); partes.push(`<b>${sinal(c[1] - c[2])}</b> inscritos`); }
    if (ads != null) partes.push(`AdSense <b>${fx ? "R$ " + nf(ads * fx) : din(ads)}</b>`);
    const sdia = STUDIO_ && STUDIO_.dias && STUDIO_.dias[iso];
    if (sdia) partes.push(`${nf(sdia[0])} impressões · CTR <b>${String(sdia[1]).replace(".", ",")}%</b>`);
    h += `<div class="dd-sec"><div class="dd-t">Canal no YouTube</div>${partes.join(" · ")}`;
    const ry = v && v.plat.youtube;
    if (c && c[0] && ry) h += `<div class="l">R$ ${brl(parte(ry) / c[0] * 1000)} seus a cada mil views (venda do YouTube ÷ views do canal)</div>`;
    h += `</div>`;
  } else if (typeof DADOS !== "undefined" && iso > (DADOS.dado_ate || ""))
    h += `<div class="dd-sec"><span class="l">O YouTube ainda não fechou este dia (2–3 dias de atraso)</span></div>`;

  /* publicado */
  const p = X.pub[iso];
  if (p && p.length) h += `<div class="dd-sec"><div class="dd-t">Publicou</div>${p.map(id =>
    `<div class="dd-v"><span>▶ ${esc(corta(tituloDe(id).t, 42))}</span></div>`).join("")}</div>`;
  return h;
}
/* o mesmo, pro mês: views, inscritos e vídeos publicados — vai embaixo da dica de mês */
function resumoDoMes(k){
  const cd = (typeof DADOS !== "undefined" && DADOS.canal_dia) || {};
  let vw = 0, ins = 0, nd = 0;
  Object.entries(cd).forEach(([d, c]) => { if (d.slice(0,7) === k){ vw += c[0]; ins += c[1] - c[2]; nd++; } });
  const pub = Object.values((typeof DADOS !== "undefined" && DADOS.videos) || {})
    .filter(m => (m.publicado || "").slice(0,7) === k && !m.curto).length;
  let h = "";
  if (nd) h += `<div class="dd-sec"><div class="dd-t">Canal no YouTube</div><b>${nf(vw)}</b> views · <b>${sinal(ins)}</b> inscritos${nd < 28 ? ` <span class="l">(${nd} dias medidos)</span>` : ""}</div>`;
  if (pub) h += `<div class="dd-sec"><span class="l">${pub} vídeo${pub===1?"":"s"} longo${pub===1?"":"s"} publicado${pub===1?"":"s"} no mês</span></div>`;
  return h;
}

function vazioG(titulo, linha){
  return `<div class="vaz"><b>${titulo}</b>${linha}</div>`;
}

/* ——— 1) O DINHEIRO POR DIA ———
   Área com degradê por plataforma, empilhada visualmente por sobreposição. A linha
   se desenha da esquerda pra direita quando entra. */
function graficoDinheiro(){
  const D = dadosDinheiro();
  if (!D) return vazioG("Ainda não chegou venda nenhuma.",
      "Assim que a Assiny avisar a primeira, ela aparece aqui sozinha.");
  if (D.vazioPeriodo) return vazioG("Nenhuma venda neste período.", "Troque o período aí em cima.");

  /* sua parte: as linhas, o eixo e a dica mostram a parte dele; o total fica no rodapé */
  const kP = pctParte() / 100, totEntrou = D.entrou, totVoltou = D.voltou;
  D.dias.forEach(d => { ORIGENS.forEach(o => d[o.k] = (d[o.k] || 0) * kP); d.voltou *= kP; d.total *= kP; });
  D.entrou *= kP; D.voltou *= kP;

  const W = 760, H = 250, PL = 46, PR = 16, PT = 14, PB = 30;
  const acum = gDin === "acum";
  const ac = {voltou:0}; ORIGENS.forEach(o => ac[o.k] = 0);
  const serie = D.dias.map(d => {
    const l = {data:d.data, nv:d.nv, nb:d.nb, bruto:d};
    ORIGENS.forEach(o => { ac[o.k] += d[o.k]; l[o.k] = acum ? ac[o.k] : d[o.k]; });
    ac.voltou += d.voltou; l.voltou = acum ? ac.voltou : d.voltou;
    return l;
  });
  const usadas = D.usadas.length ? D.usadas : [ORIGENS[0]];
  const vals = serie.flatMap(d => usadas.map(o => d[o.k]).concat([d.voltou]));
  const teto = Math.max(...vals, 1);
  const n = serie.length;
  const px = i => PL + (n === 1 ? (W-PL-PR)/2 : i*(W-PL-PR)/(n-1));
  const py = v => PT + (1 - v/teto) * (H-PT-PB);
  /* HOJE AINDA NÃO ACABOU (18/09/2026): às 10h o dia tem um terço das vendas e a linha
     despencava no fim, como se o dia fosse ruim. O último trecho vira tracejado e o rótulo
     diz "hoje". No acumulado não tem queda, então fica como está. */
  const parcial = !acum && n > 2 && serie[n-1].data === isoLocal(new Date());
  const ult = parcial ? n-2 : n-1;

  let grade = "";
  for (let g = 0; g <= 3; g++){
    const v = teto*g/3, y = py(v);
    grade += `<line class="lin-g" x1="${PL}" y1="${y.toFixed(1)}" x2="${W-PR}" y2="${y.toFixed(1)}"/>
      <text x="${PL-9}" y="${(y+4).toFixed(1)}" text-anchor="end">${g?"R$ "+curto(v):"0"}</text>`;
  }

  let defs = "", camadas = "";
  usadas.forEach((o, idx) => {
    const cor = PLAT[o.k] ? PLAT[o.k].cor : o.cor;
    const id = "grd-" + o.k;
    defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${cor}" stop-opacity=".26"/>
      <stop offset="100%" stop-color="${cor}" stop-opacity="0"/></linearGradient>`;
    const pts = serie.map((d,i) => `${px(i).toFixed(1)},${py(d[o.k]).toFixed(1)}`);
    const linha = "M" + pts.slice(0, ult+1).join(" L");
    const area = linha + ` L${px(ult).toFixed(1)},${py(0).toFixed(1)} L${px(0).toFixed(1)},${py(0).toFixed(1)} Z`;
    camadas += `<path class="area" d="${area}" fill="url(#${id})" style="animation-delay:${idx*.07}s"/>
      <path class="traco" d="${linha}" stroke="${cor}" stroke-width="2.4"
        style="--len:${Math.round((W-PL-PR)*1.5)};animation-delay:${idx*.07}s"/>`;
    if (parcial) camadas += `<path d="M${pts[n-2]} L${pts[n-1]}" stroke="${cor}" stroke-width="2"
        stroke-dasharray="3 4" stroke-linecap="round" fill="none" opacity=".75"/>`;
    if (n <= 26) serie.forEach((d,i) => {
      if (d[o.k] > 0) camadas += `<circle cx="${px(i).toFixed(1)}" cy="${py(d[o.k]).toFixed(1)}" r="3.4"
        fill="${cor}" stroke="var(--carta)" stroke-width="2"/>`;
    });
  });
  if (D.voltou > 0){
    const pts = serie.map((d,i) => `${px(i).toFixed(1)},${py(d.voltou).toFixed(1)}`);
    camadas += `<path class="traco" d="M${pts.join(" L")}" stroke="var(--t3)" stroke-width="1.8"
      stroke-dasharray="5 4" style="--len:0;animation:none"/>`;
  }

  let eixo = "", alvos = "";
  const passo = Math.max(1, Math.ceil(n/7));
  const larg = (W-PL-PR)/Math.max(n-1,1);
  serie.forEach((d,i) => {
    if (!(i % passo) || i === n-1)
      eixo += `<text x="${px(i).toFixed(1)}" y="${H-8}" text-anchor="${parcial && i === n-1 ? "end" : "middle"}">${parcial && i === n-1 ? "hoje, até agora" : dm(d.data)}</text>`;
    alvos += `<rect class="alvo" data-i="${i}" x="${(px(i)-larg/2).toFixed(1)}" y="${PT}"
      width="${Math.max(larg,8).toFixed(1)}" height="${H-PT-PB}" fill="transparent"/>`;
    eixo += pontoMarco(px(i), H-PB, d.data);
  });

  /* O recebedor, quando a venda é reembolsada, muda o status da MESMA linha: ela sai de
     "entrou" e passa a contar só em "voltou". Então "entrou" já é o que ficou. Antes aqui era
     entrou − voltou, e o reembolso era descontado duas vezes (erro antigo, achado em 18/09). */
  const liq = D.entrou;
  window._serieDin = serie;
  window._ptsDin = serie.map(d => usadas.map(o => ({y: py(d[o.k]), cor: PLAT[o.k] ? PLAT[o.k].cor : o.cor})));
  return caixaGrafico("gdin", `<defs>${defs}</defs>${grade}${camadas}${eixo}${alvos}`, {w:W,h:H,max:270})
    + `<div class="leg-g">${usadas.map(o =>
        `<span><i style="background:${PLAT[o.k]?PLAT[o.k].cor:o.cor}"></i>${PLAT[o.k]?PLAT[o.k].rot:o.rot}</span>`).join("")}
       ${D.voltou ? '<span><i style="background:var(--t3)"></i>voltou (reembolso/chargeback)</span>' : ""}</div>
      <div class="tot-g">
        <div><div class="r">Sua parte — vendas que ficaram</div><div class="v pos">R$ ${nf(liq)}</div>${deTotal(totEntrou)}</div>
        <div><div class="r">Reembolsado (sua parte)</div><div class="v ${D.voltou?"neg":""}">R$ ${nf(D.voltou)}</div>${deTotal(totVoltou)}</div>
      </div>`;
}
function ligarDinheiro(){
  if (!window._serieDin || !$("#gdin")) return;
  ligarDica("gdin", i => {
    const d = window._serieDin[i];
    const topo = gDin === "acum"
      ? `acumulado até aqui: <b>R$ ${nf(ORIGENS.reduce((t, o) => t + (d[o.k] || 0), 0))}</b> seus` : "";
    return resumoDoDia(d.data, {topo});
  }, {pontos: i => window._ptsDin[i]});
}

/* ——— FAÍSCA: a linha do dinheiro dentro do cartão escuro ———
   Sem eixo, sem número, sem grade: é a FORMA do período, não a leitura dele. A leitura
   exata está no gráfico grande, na tela de Vendas. Aqui ela existe só pra dizer, de
   relance, se o dinheiro vem subindo ou afundando. */
function faisca(compras){
  if (!compras.length) return "";
  let {ini, fim} = janelaVendas();
  if (!ini || !fim) return "";
  /* começa na primeira venda que existe, não no início do período: com "365 dias" o período
     começa em setembro do ano passado, e a linha ficava 9 meses no zero antes de subir */
  const primeira = compras.reduce((m, c) => (c.data && c.data.slice(0,10) < m) ? c.data.slice(0,10) : m, fim);
  if (primeira > ini) ini = primeira;
  const n = Math.min(diasEntre(ini, fim) + 1, 400);
  if (n < 3) return "";
  const dias = Array.from({length:n}, (_, i) =>
    isoLocal(new Date(new Date(ini+"T00:00:00").getTime() + i*86400000)));
  const idx = Object.fromEntries(dias.map((d,i) => [d, i]));
  const v = new Array(n).fill(0);
  compras.forEach(c => { const i = idx[(c.data||"").slice(0,10)]; if (i != null) v[i] += parte(c.valor); });
  const teto = Math.max(...v, 1);
  const W = 560, H = 96;
  const px = i => n === 1 ? W/2 : i*W/(n-1);
  const py = x => 6 + (1 - x/teto) * (H-12);
  const pts = v.map((x,i) => `${px(i).toFixed(1)},${py(x).toFixed(1)}`);
  /* hoje ainda não acabou: o último trecho é tracejado, não uma queda */
  const parcial = fim === isoLocal(new Date());
  const ult = parcial ? n-2 : n-1;
  const linha = "M" + pts.slice(0, ult+1).join(" L");
  const area = linha + ` L${px(ult).toFixed(1)},${H} L0,${H} Z`;
  const tracejado = parcial ? `<path d="M${pts[n-2]} L${pts[n-1]}" stroke="var(--ac)" stroke-width="2"
      stroke-dasharray="3 4" stroke-linecap="round" fill="none" opacity=".7" vector-effect="non-scaling-stroke"/>` : "";
  const ultimo = v[n-1], maior = v.indexOf(teto);
  const lg = W / Math.max(n-1, 1);
  const alvosF = dias.map((d,i) => `<rect class="alvo" data-i="${i}" x="${(px(i)-lg/2).toFixed(1)}" y="0"
      width="${lg.toFixed(2)}" height="${H}" fill="transparent"/>`).join("");
  window._faisca = {dias, pts: v.map(x => py(x))};
  const marcosF = dias.map((d,i) => pontoMarco(px(i), H-4, d)).join("");
  return `<div style="margin-top:auto;padding-top:18px"><div class="svgb" id="gfai-box">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="gsvg" id="gfai" style="height:96px;overflow:visible">
      <defs><linearGradient id="grd-faisca" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--ac)" stop-opacity=".40"/>
        <stop offset="100%" stop-color="var(--ac)" stop-opacity="0"/></linearGradient></defs>
      <path class="area" d="${area}" fill="url(#grd-faisca)"/>
      <path class="traco" d="${linha}" stroke="var(--ac)" stroke-width="2.4" style="--len:1600"/>${tracejado}
      <circle cx="${px(maior).toFixed(1)}" cy="${py(teto).toFixed(1)}" r="4"
        fill="var(--ac)" stroke="var(--escuro)" stroke-width="2.5"/>${marcosF}${alvosF}
    </svg></div>
    <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--escuro-t2);margin-top:7px">
      <span>${dt(ini)}</span>
      <span>seu melhor dia: <b style="color:var(--escuro-t1);font-weight:600">R$ ${nf(teto)}</b></span>
      <span>${parcial ? "hoje, até agora" : dt(fim)}</span>
    </div></div>`;
}

function ligarFaisca(){
  if (!window._faisca || !$("#gfai")) return;
  ligarDica("gfai", i => resumoDoDia(window._faisca.dias[i]),
    {pontos: i => [{y: window._faisca.pts[i], cor: "var(--ac)"}]});
}
function ligarFaiscaMeses(){
  const F = window._faiscaMeses;
  if (!F || !$("#gfm")) return;
  ligarDica("gfm", i => {
    const k = F.ks[i], v = F.vals[i], a = i ? F.vals[i-1] : null;
    const d = a ? Math.round((v / a - 1) * 100) : null;
    return `<div class="dd-cab"><b>${nomeMes(k, true)}</b></div>`
      + `<div class="dd-sec">${F.rot} <b>R$ ${nf(v)}</b>`
      + (d != null ? ` <span class="${d >= 0 ? "" : "dd-neg"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}% vs. mês anterior</span>` : "")
      + (mesCompleto(k) !== "inteiro" ? `<div class="l">mês parcial: ${mesCompleto(k)}</div>` : "")
      + `</div>` + resumoDoMes(k);
  }, {pontos: i => [{y: F.pts[i], cor: "var(--ac)"}]});
}

/* ——— 2) A ROSCA DAS PLATAFORMAS ———
   É a resposta visual da pergunta que deu origem ao painel: de onde vem o dinheiro. */
function dicaFatia(f, total){
  return `<b>${esc(f.rot)}</b><br>R$ ${nf(f.val)} · ${Math.round(f.val/(total||1)*100)}% do total`
    + (f.n ? `<br><span class="l">${f.n} venda${f.n===1?"":"s"} · ticket R$ ${nf(f.val/f.n)}</span>` : "");
}
function rosca(fatias, total, rotuloMeio){
  const R = 78, r = 52, cx = 90, cy = 90;
  if (!total) return vazioG("Sem venda no período.", "Troque o período pra ver outro pedaço do tempo.");
  let ang = -Math.PI/2, caminhos = "";
  fatias.forEach((f, i) => {
    const frac = f.val / total;
    const d = frac * Math.PI * 2;
    const a2 = ang + d;
    // círculo inteiro não pode virar arco: vira dois semicírculos
    if (frac >= 0.9999){
      caminhos += `<circle class="fatia" cx="${cx}" cy="${cy}" r="${(R+r)/2}" fill="none"
        stroke="${f.cor}" stroke-width="${R-r}" data-dica="${esc(dicaFatia(f, total))}"/>`;
    } else {
      const g = d > Math.PI ? 1 : 0;
      const x1 = cx + R*Math.cos(ang), y1 = cy + R*Math.sin(ang);
      const x2 = cx + R*Math.cos(a2),  y2 = cy + R*Math.sin(a2);
      const x3 = cx + r*Math.cos(a2),  y3 = cy + r*Math.sin(a2);
      const x4 = cx + r*Math.cos(ang), y4 = cy + r*Math.sin(ang);
      caminhos += `<path class="fatia" d="M${x1.toFixed(2)} ${y1.toFixed(2)}
        A${R} ${R} 0 ${g} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}
        L${x3.toFixed(2)} ${y3.toFixed(2)} A${r} ${r} 0 ${g} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z"
        fill="${f.cor}" data-dica="${esc(dicaFatia(f, total))}"></path>`;
    }
    ang = a2;
  });
  return `<div class="rosca">
    <svg viewBox="0 0 180 180" width="180" height="180" class="gsvg" style="max-width:180px">
      ${caminhos}
      <g class="meio"><text class="n" x="90" y="88" text-anchor="middle">R$ ${curto(total)}</text>
      <text class="l" x="90" y="104" text-anchor="middle">${esc(rotuloMeio)}</text></g>
    </svg>
    <div class="rleg">${fatias.map(f => `<div data-dica="${esc(dicaFatia(f, total))}">
      <span class="pto" style="background:${f.cor}"></span>
      <span class="nm">${esc(f.rot)}</span>
      <span class="vv">R$ ${nf(f.val)} <span style="color:var(--t3);font-weight:500">
        ${Math.round(f.val/total*100)}%</span></span></div>`).join("")}</div></div>`;
}

/* ——— 3) BARRAS POR HORA DO DIA ——— */
function barrasHora(compras){
  const cols = Array.from({length:24}, (_,h) => ({h, val:0, r:0}));
  let semHora = 0;
  compras.forEach(c => {
    const h = parseInt((c.data||"").slice(11,13), 10);
    if (isNaN(h)){ semHora++; return; }
    cols[h].val++; cols[h].r += (+c.valor || 0);
  });
  const teto = Math.max(...cols.map(c => c.val), 1);
  const pico = cols.reduce((a,b) => b.val > a.val ? b : a, cols[0]);
  const W = 720, H = 168, PB = 26, PT = 12;
  let barras = "", eixo = "", alvos = "";
  const passo = W / 24;
  const larg = Math.min(20, passo - 7);
  cols.forEach((c,i) => {
    const x = i*passo + (passo-larg)/2;
    const alt = c.val ? Math.max(3, c.val/teto * (H-PT-PB)) : 2;
    barras += `<rect class="colu" x="${x.toFixed(1)}" y="${(H-PB-alt).toFixed(1)}" width="${larg.toFixed(1)}"
      height="${alt.toFixed(1)}" rx="4" fill="${c.val ? (c===pico ? "var(--ac)" : "var(--carta-3)") : "var(--carta-3)"}"
      style="animation-delay:${(i*.016).toFixed(3)}s"/>`;
    if (!(i % 3)) eixo += `<text x="${(x+larg/2).toFixed(1)}" y="${H-8}" text-anchor="middle">${String(i).padStart(2,"0")}</text>`;
    alvos += `<rect class="alvo" data-i="${i}" x="${(i*passo).toFixed(1)}" y="${PT}" width="${passo.toFixed(1)}"
      height="${H-PT-PB}" fill="transparent"/>`;
  });
  window._horas = cols;
  return caixaGrafico("ghora", `${barras}${eixo}${alvos}`, {w:W,h:H,max:180})
    + `<div class="sub">Pico às <b style="color:var(--t1)">${String(pico.h).padStart(2,"0")}h</b>`
    + (semHora ? ` · ${semHora} venda${semHora>1?"s":""} sem horário registrado` : "") + `</div>`;
}
function ligarHoras(){
  if (!window._horas) return;
  ligarDica("ghora", i => {
    const c = window._horas[i];
    return `<b>${String(c.h).padStart(2,"0")}h</b><br>` +
      (c.val ? `${c.val} venda${c.val===1?"":"s"}<br><span class="l">R$ ${nf(parte(c.r))} seus · de R$ ${nf(c.r)}</span>`
             : '<span class="l">sem venda</span>');
  }, {faixa:true});
}

/* ——— 4) EM QUE ALTURA DA VIDA DO VÍDEO A VENDA ACONTECE ——— */
function graficoMomento(){
  const D = dadosMomento();
  if (!D) return vazioG("Ainda não dá pra ver esse padrão.",
      "Ele se forma sozinho conforme as vendas vão chegando.");
  if (!D.com) return vazioG("As vendas ainda não estão carimbadas.",
      "O carimbo acontece na próxima vez que o painel buscar as vendas.");
  const W = 560, H = 190, PB = 40, PT = 16;
  const teto = Math.max(...D.faixas.map(f => f.n), 1);
  const passo = W / D.faixas.length;
  const larg = Math.min(46, passo - 14);
  let barras = "", eixo = "", alvos = "";
  D.faixas.forEach((f,i) => {
    const x = i*passo + (passo-larg)/2;
    const alt = f.n ? Math.max(4, f.n/teto * (H-PT-PB)) : 3;
    barras += `<rect class="colu" x="${x.toFixed(1)}" y="${(H-PB-alt).toFixed(1)}" width="${larg.toFixed(1)}"
      height="${alt.toFixed(1)}" rx="6" fill="${f.n ? "var(--ac)" : "var(--carta-3)"}"
      style="animation-delay:${(i*.05).toFixed(2)}s"/>`;
    if (f.n) barras += `<text x="${(x+larg/2).toFixed(1)}" y="${(H-PB-alt-7).toFixed(1)}" text-anchor="middle"
      style="fill:var(--t1);font-weight:600">${f.n}</text>`;
    eixo += `<text x="${(x+larg/2).toFixed(1)}" y="${H-PB+18}" text-anchor="middle">${f.rot}</text>`;
    alvos += `<rect class="alvo" data-i="${i}" x="${(i*passo).toFixed(1)}" y="${PT}" width="${passo.toFixed(1)}"
      height="${H-PT-PB}" fill="transparent"/>`;
  });
  const mid = D.valores[Math.floor(D.valores.length/2)];
  const unidade = gMom === "dias"
      ? (mid === 0 ? "no mesmo dia" : `${mid} dia${mid>1?"s":""} de vida`)
      : `${nf(mid)} views`;
  window._momento = D;
  return caixaGrafico("gmom", `${barras}${eixo}${alvos}`, {w:W,h:H,max:200})
    + `<div class="tot-g">
        <div><div class="r">Venda típica (mediana)</div><div class="v">${unidade}</div></div>
        <div><div class="r">Carimbadas</div><div class="v">${D.com} <span style="color:var(--t3);font-size:14px">de ${D.total}</span></div></div>
      </div>`
    + (D.com < 5 ? `<div class="sub">Com ${D.com} venda${D.com>1?"s":""} isso ainda não é padrão — é o começo dele.</div>` : "");
}
function ligarMomento(){
  if (!window._momento) return;
  ligarDica("gmom", i => {
    const f = window._momento.faixas[i];
    const q = gMom === "dias" ? "com essa idade" : "com esse tanto de views";
    return `<b>${f.rot}</b><br>${f.n} venda${f.n===1?"":"s"} ${q}`;
  }, {faixa:true});
}

/* ——— 5) BARRAS DEITADAS (fontes de tráfego, termos de busca, projetos) ——— */
function barrasLado(itens, opt){
  opt = opt || {};
  if (!itens.length) return `<div class="vaz-p">${opt.vazio || "Sem dado aqui neste período."}</div>`;
  const teto = Math.max(...itens.map(i => i.val), 1);
  const soma = itens.reduce((a, i) => a + (+i.val || 0), 0) || 1;
  return itens.map((i, n) => `<div class="plat" data-dica="${esc(i.dica || (`<b>${esc(i.rot)}</b><br>${i.txt}`
      + (i.pc != null ? ` · ${i.pc}% do total` : ` · ${Math.round(i.val/soma*100)}% da lista`)))}"${i.clic?` style="cursor:pointer" onclick="${i.clic}"`:""}>
      <span class="pto" style="background:${i.cor || "var(--ac)"}"></span>
      <span class="nm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:0 1 150px">${esc(i.rot)}</span>
      <span class="trilho"><span class="ench" style="width:${(i.val/teto*100).toFixed(1)}%;
        background:${i.cor || "var(--ac)"};animation-delay:${(n*.04).toFixed(2)}s"></span></span>
      <span class="qt">${i.txt}</span>
      ${i.pc != null ? `<span class="pc">${i.pc}%</span>` : ""}
    </div>`).join("");
}

/* ——— 6) LISTA DE VÍDEOS COM CAPA ——— */
function listaVideos(itens, opt){
  opt = opt || {};
  if (!itens.length) return `<div class="vaz-p">${opt.vazio || "Sem vídeo pra mostrar aqui."}</div>`;
  return `<div class="lista">` + itens.map((i, n) => {
    if (i.naoVideo) return `<div class="lin naovideo">
      <span class="pos"></span><span class="semcapa">s/ vídeo</span>
      <span class="txt"><span class="tt" style="color:var(--t2)">${esc(i.rotulo)}</span>
        <span class="mt">chegou sem vídeo de origem</span></span>
      <span class="dir"><b>${i.val}</b><span>${esc(i.sub||"")}</span></span></div>`;
    return `<button class="lin" data-vid="${esc(i.id)}">
      <span class="pos">${String(n+1).padStart(2,"0")}</span>
      <img class="capa" src="${esc((i.m && i.m.thumb) || "")}" alt="" loading="lazy"
        onerror="this.style.visibility='hidden'">
      <span class="txt"><span class="tt">${esc((i.m && i.m.titulo) || i.id)}</span>
        ${i.mt ? `<span class="mt">${i.mt}</span>` : ""}</span>
      <span class="dir"><b>${i.val}</b><span>${esc(i.sub||"")}</span></span></button>`;
  }).join("") + `</div>`;
}

/* a marca crua vira um nome que se entende. As do Instagram chegam como um blob
   ("link_in_bio::PAcGRvZgJIaHRuA2FIbQ...") — isso é o identificador interno do app, não um
   nome. Sem isso ele aparecia ranqueado no meio dos vídeos, com a marca crua na tela. */
/* VENDA SEM UTM (22/09/2026, pedido dele): uma venda de hoje chegou como "direct" — sem
   utm_source nem utm_content. Mas ela caiu no projeto "Instagram" da Assiny, e cada projeto tem o
   próprio checkout. Então a origem dá pra deduzir pelo projeto: projeto Instagram = alguém que
   comprou pelo link do Instagram sem marcação (link da bio, story, direct). A venda passa a contar
   na plataforma certa e aparece como "Instagram — link sem marcação", não como "sem origem". */
function normalizaOrigens(d){
  if (!d || !d.por_marca) return d;
  const deduz = x => {
    if (origemDe(x.origem) !== "outra") return;
    const o = PROJ_ORIGEM[semAcento(x.projeto)];
    if (o){ x.origem_utm = x.origem; x.origem = o; x.deduzida = true; }
  };
  /* cliques de TESTE (22/09/2026, na instalação do contador) não entram em conta nenhuma */
  ["cliques", "cliques_pago"].forEach(k => Object.keys(d[k] || {}).forEach(m => { if (/^(teste|t8)/i.test(m)) delete d[k][m]; }));
  Object.values(d.por_marca).forEach(dd => (dd.compras || []).forEach(deduz));
  (d.movimento || []).forEach(deduz);
  return d;
}
/* chave de agrupamento de venda SEM vídeo: sem UTM, agrupa pelo projeto de onde veio */
function chaveSolta(c){
  const m = String(c.marca || "").toLowerCase();
  if ((!m || m === "direct" || m === "direto" || m === "(sem marca)") && c.projeto) return "projeto:" + c.projeto;
  return c.marca;
}
function nomeDaOrigemSolta(marca){
  const t = String(marca || "").toLowerCase();
  if (t.startsWith("projeto:")){
    const pj = String(marca).slice(8), o = PROJ_ORIGEM[semAcento(pj)];
    return (o ? PLAT[o].rot + " — link sem marcação" : "sem marcação") + ` (caiu no projeto “${pj}” da Assiny${o === "instagram" ? ": link da bio, story ou direct" : ""})`;
  }
  if (!t || t === "(sem marca)") return "sem marcação nenhuma";
  if (t.startsWith("link_in_bio") || t.includes("linkinbio")) return "link da bio (Instagram)";
  if (t === "direct" || t === "direto") return "acesso direto, sem origem";
  if (t === MARCA_HIST) return "antes do rastreio por vídeo — sem vídeo de origem";
  /* materiais gratuitos: utm_content=pdf-<nome>. Cada PDF novo aparece com o próprio nome,
     sem precisar mexer aqui de novo. */
  if (t.startsWith("pdf-")){
    const nome = t.slice(4).split("-").map(p => p.length <= 3 ? p.toUpperCase()
                  : p[0].toUpperCase() + p.slice(1)).join(" ");
    return "PDF · " + nome;
  }
  if (t.includes("whats")) return "WhatsApp";
  if (t.startsWith("http")) return "link avulso";
  if (t.length > 26) return "marcação sem vídeo correspondente";
  return marca;
}

/* ——— a pílula de variação ——— */
function pilula(d, inverso){
  if (!d || !isFinite(d.r)) return "";
  const p = Math.round((d.r - 1) * 100);
  const setaCima = '<svg viewBox="0 0 24 24"><path d="M12 19V6"/><path d="m6 11 6-6 6 6"/></svg>';
  const setaBaixo = '<svg viewBox="0 0 24 24"><path d="M12 5v13"/><path d="m6 13 6 6 6-6"/></svg>';
  if (Math.abs(p) < 3) return `<span class="var eq">igual <small>a ${d.base}</small></span>`;
  const bom = inverso ? p < 0 : p > 0;
  const n = Math.abs(p) >= 1000 ? d.r.toFixed(1).replace(".",",")+"×" : Math.abs(p)+"%";
  return `<span class="var ${bom?"up":"dn"}">${p>0?setaCima:setaBaixo}${n}<small>vs. ${d.base}</small></span>`;
}


/* ══════════════════════════════════════════════════════════════════════════
   AS TELAS
   ══════════════════════════════════════════════════════════════════════════ */

const cart = (conteudo, cls) => `<div class="cart ${cls||""}">${conteudo}</div>`;
function bloco(titulo, legenda, corpo, extra){
  return `<section class="cart">
    <div class="cab"><div><h3>${titulo}</h3>${legenda?`<div class="leg">${legenda}</div>`:""}</div>
    ${extra||""}</div>${corpo}</section>`;
}
function dobra(titulo, corpo){
  return `<details class="dobra"><summary>${titulo}
    <span class="mais-ic">${ico("mais")}</span></summary><div class="corpo">${corpo}</div></details>`;
}

/* ——— o que cada plataforma trouxe no período ——— */
function porPlataforma(canal){
  const compras = comprasDoPeriodo(canal);
  const por = {};
  compras.forEach(c => {
    const k = origemDe(c.origem);
    (por[k] = por[k] || {n:0, r:0}).n++;
    por[k].r += (+c.valor || 0);
  });
  const total = Object.values(por).reduce((a,x) => a + x.r, 0);
  const lista = Object.entries(por)
    .map(([k,v]) => ({k, rot: PLAT[k].rot, cor: PLAT[k].cor, val: v.r, n: v.n}))
    .sort((a,b) => b.val - a.val);
  return {lista, total, compras};
}

/* ═══ REEMBOLSO EM DESTAQUE (18/09/2026) ═══
   Pedido dele. Conferido na Assiny antes de desenhar: o número é real — 851 de 2.814 pedidos
   (30%) voltaram entre junho e setembro, estável mês a mês, e 9 de cada 10 voltam na primeira
   semana. Estava num rodapé pequeno do gráfico; é o segundo maior número do negócio.

   TAXA = voltou ÷ (ficou + voltou), pelo dia em que cada coisa aconteceu (o mesmo `movimento`
   do gráfico de dinheiro). O reembolso que chega ao vivo traz a marca do vídeo — daí sai o
   ranking por vídeo, que só existe de 14/09 em diante.

   "PODE VOLTAR" = pra cada venda que ficou, com X dias de idade: das vendas antigas (mais de
   35 dias, já sem chance de reembolso) que tinham passado X dias sem voltar, quantas voltaram
   depois. É uma probabilidade da sua própria loja, não um palpite. */
let _chanceVolta = null;
function chanceDeVoltar(){
  if (_chanceVolta) return _chanceVolta;
  const P = (typeof HISTORICO !== "undefined" && HISTORICO && HISTORICO.pedidos) || [];
  const ref = new Date(((typeof HISTORICO !== "undefined" && HISTORICO.gerado_em) || isoLocal(new Date())).slice(0,10) + "T00:00:00");
  const velhas = P.filter(p => (ref - new Date(p[1].slice(0,10) + "T00:00:00")) / 86400000 > 35);
  const atrasos = velhas.filter(p => p[4] === "r" && p[5])
    .map(p => Math.max(0, diasEntre(p[1].slice(0,10), p[5])));
  const chance = [];
  for (let a = 0; a <= 30; a++){
    const depois = atrasos.filter(d => d > a).length;
    const vivas = velhas.length - atrasos.filter(d => d <= a).length;
    chance.push(vivas ? depois / vivas : 0);
  }
  const semana = atrasos.length ? atrasos.filter(d => d <= 7).length / atrasos.length : 0;
  return _chanceVolta = {chance, semana, base: velhas.length};
}

function dadosReembolso(){
  const d = dadosVendas();
  const mov = (d && d.movimento) || [];
  if (!mov.length) return null;
  const {ini, fim} = janelaVendas();
  const dentro = m => (!ini || m.data >= ini) && (!fim || m.data <= fim);
  const soma = (lista, f) => lista.reduce((a, m) => a + (f(m) ? (+m.valor || 0) : 0), 0);
  const ehV = m => m.tipo === "venda", ehB = m => m.tipo === "baixa";

  const usados = mov.filter(dentro);
  const ficou = soma(usados, ehV), voltou = soma(usados, ehB);
  const nV = usados.filter(ehV).length, nB = usados.filter(ehB).length;
  const taxa = (ficou + voltou) ? voltou / (ficou + voltou) : 0;
  const ficouT = soma(mov, ehV), voltouT = soma(mov, ehB);
  const media = (ficouT + voltouT) ? voltouT / (ficouT + voltouT) : 0;

  const porPlat = {};
  usados.forEach(m => { const k = origemDe(m.origem);
    const x = porPlat[k] = porPlat[k] || {f:0, v:0, nb:0};
    if (ehV(m)) x.f += +m.valor || 0; else if (ehB(m)){ x.v += +m.valor || 0; x.nb++; } });
  const plats = Object.entries(porPlat).filter(([, x]) => x.f + x.v > 0)
    .map(([k, x]) => ({k, rot: PLAT[k].rot, cor: PLAT[k].cor, taxa: x.v / (x.f + x.v), v: x.v, nb: x.nb, peso: x.f + x.v}))
    .sort((a, b) => b.peso - a.peso);

  /* por vídeo: só o ao vivo tem marca, então só a partir do corte */
  const porVid = {};
  usados.forEach(m => { const vid = idDaMarca(m.marca); if (!vid) return;
    const x = porVid[vid] = porVid[vid] || {nv:0, nb:0, v:0};
    if (ehV(m)) x.nv++; else if (ehB(m)){ x.nb++; x.v += +m.valor || 0; } });
  const vids = Object.entries(porVid).filter(([, x]) => x.nb >= 2)
    .sort((a, b) => b[1].nb - a[1].nb || b[1].nb/(b[1].nb+b[1].nv) - a[1].nb/(a[1].nb+a[1].nv)).slice(0, 4);

  /* o que ainda pode voltar: é o estado de HOJE, não depende do período escolhido */
  const {chance, semana} = chanceDeVoltar();
  const hoje = isoLocal(new Date());
  let recente = 0, pode = 0;
  Object.values(d.por_marca || {}).forEach(dd => (dd.compras || []).forEach(c => {
    const idade = diasEntre((c.data || "").slice(0,10), hoje);
    if (!(idade >= 0) || idade > 30) return;
    if (idade <= 7) recente += +c.valor || 0;
    pode += (+c.valor || 0) * (chance[idade] || 0);
  }));
  return {ficou, voltou, nV, nB, taxa, media, plats, vids, recente, pode, semana};
}

const pct1 = x => (x * 100).toFixed(1).replace(".", ",") + "%";
function blocoReembolso(){
  const R = dadosReembolso();
  if (!R || !(R.ficou + R.voltou)) return "";
  const alto = R.taxa >= 0.2;

  /* "sem origem" não é plataforma, e plataforma com menos de 2% do dinheiro também não entra:
     1 reembolso vira "9,6%" e só confunde */
  const platsV = R.plats.filter(p => p.k !== "outra" && p.peso >= (R.ficou + R.voltou) * 0.02);
  const plats = platsV.length > 1 ? barrasLado(platsV.map(p => ({rot: p.rot, val: p.taxa, cor: p.cor,
      txt: pct1(p.taxa), dica: `<b>${esc(p.rot)}</b><br>${pct1(p.taxa)} de reembolso<br><span class="l">${p.nb} reembolso${p.nb===1?"":"s"} · R$ ${nf(parte(p.v))} seus</span>`})))
    : "";
  const vids = R.vids.length ? listaVideos(R.vids.map(([id, x]) => ({id, m: (DADOS.videos||{})[id],
      val: `${x.nb} de ${x.nb + x.nv}`,
      sub: `${Math.round(x.nb / (x.nb + x.nv) * 100)}% voltou · R$ ${nf(parte(x.v))} seus`}))) : "";

  return `<section class="cart reemb${alto ? " alto" : ""}">
    <div class="cab"><div><h3>Reembolso</h3>
      <div class="leg">do que foi vendido ${frasePeriodo()}, quanto voltou · reembolso e chargeback</div></div>
      <span class="selo ${alto ? "ng" : "al"}">${ico("alerta")}</span></div>
    <div class="reemb-nums">
      <div><div class="rot">Voltou</div>
        <div class="val num neg">${pct1(R.taxa)}</div>
        <div class="sub">${nf(R.nB)} de ${nf(R.nB + R.nV)} pedidos${R.media && Math.abs(R.taxa - R.media) >= 0.001
          ? ` · sua média desde junho é <b style="color:var(--t1);font-weight:600">${pct1(R.media)}</b>` : ""}</div></div>
      <div><div class="rot">Sua parte que voltou</div>
        <div class="val num">R$ ${nf(parte(R.voltou))}</div>${deTotal(R.voltou)}</div>
      <div title="vendas que ficaram, com até 30 dias de idade, vezes a chance de cada uma voltar — calculada nas suas vendas antigas, pela idade da venda">
        <div class="rot">Ainda pode voltar</div>
        <div class="val num">~R$ ${nf(parte(R.pode))}</div>
        <div class="sub">das vendas recentes, pela sua própria taxa. ${Math.round(R.semana * 100)}% dos reembolsos
          saem na 1ª semana — R$ ${nf(parte(R.recente))} seus vendidos nos últimos 7 dias ainda estão nela.</div></div>
    </div>
    ${plats || vids ? `<div class="reemb-det">
      ${plats ? `<div><div class="rot" style="margin-bottom:8px">Por plataforma</div>${plats}</div>` : ""}
      ${vids ? `<div><div class="rot" style="margin-bottom:2px">Vídeos que mais têm reembolso</div>
        <div class="sub" style="margin:0 0 6px">desde ${dt(inicioTracking())}, quando a venda passou a trazer o vídeo</div>${vids}</div>` : ""}
    </div>` : ""}
  </section>`;
}

/* ════════ 1) VISÃO GERAL ════════ */
function telaVisao(){
  const L = linhas();
  const r = DADOS.resumo[periodo] || {};
  const g = k => r[k] || 0;
  const {lista: plats, total, compras} = porPlataforma();
  const temVendas = !!dadosVendasBrutos();
  const dV = deltaVendas();
  const ticket = compras.length ? total / compras.length : 0;
  const nVideos = new Set(compras.map(c => c.vid).filter(Boolean)).size;

  /* ——— o cartão escuro: o número que manda ——— */
  const heroi = `<section class="cart heroi">
    <div class="rot">${ico("vendas")} Sua parte ${frasePeriodo()}</div>
    <div class="val num">${temVendas ? dinheiro(parte(total)) : (VENDAS_CARREGANDO ? "…" : "–")}</div>
    ${temVendas ? deTotal(total) : ""}
    ${pilula(dV)}
    <div class="sub">${temVendas
      ? `${compras.length} venda${compras.length===1?"":"s"}`
        + (nVideos ? ` · ${nVideos} vídeo${nVideos===1?"":"s"} diferentes` : "")
        + (ticket ? ` · ticket médio R$ ${nf(parte(ticket))} seu (R$ ${nf(ticket)} no total)` : "")
      : (VENDAS_CARREGANDO ? "buscando no recebedor…" : "sem conexão com o recebedor")}</div>
    ${faisca(compras)}
  </section>`;

  /* ——— os três secundários ——— */
  const trio = [
    {rot:"Views", ic:"publico", cls:"", val:nf(g("views")),
     sub:(DADOS.janelas[periodo]||{}).dias > 1 ? nf(g("views")/((DADOS.janelas[periodo]||{}).dias||1)) + " por dia" : "",
     d:deltaCanal("views"), k:"publico"},
    {rot:"Inscritos", ic:"publico", cls:"ac",
     val:sinal(g("subscribersGained") - g("subscribersLost")),
     sub:`<span class="pos">+${nf(g("subscribersGained"))}</span> ganhos · <span class="neg">−${nf(g("subscribersLost"))}</span> perdidos`,
     d:deltaCanal("subscribersGained"), k:"publico"},
    {rot:"AdSense", ic:"vendas", cls:"",
     val:g("estimatedRevenue") ? din(g("estimatedRevenue")) : "–",
     sub:r.estimatedRevenueBRL != null
        ? `<span title="${esc(fonteDaTaxa())}">= R$ ${brl(r.estimatedRevenueBRL)}</span>`
        : (g("estimatedRevenue") ? emReal(g("estimatedRevenue")) : ""),
     d:deltaCanal("estimatedRevenue"), k:"publico"},
  ].map(c => `<button class="cart clic" data-tela="${c.k}">
      <div class="cab"><div class="rot">${c.rot}</div><span class="selo ${c.cls}">${ico(c.ic)}</span></div>
      <div class="val num">${c.val}</div>
      ${c.sub ? `<div class="sub">${c.sub}</div>` : ""}
      ${pilula(c.d)}</button>`).join("");

  /* ——— de onde veio: a resposta da pergunta que criou este painel ——— */
  const blocoPlat = bloco("De onde veio o dinheiro",
    `sua parte · de R$ ${nf(total)} no total`,
    total ? rosca(plats.map(p => ({...p, val: parte(p.val)})), parte(total), "sua parte")
          : `<div class="vaz-p">Sem venda registrada ${frasePeriodo()}.</div>`,
    `<button class="bt" data-tela="plat" title="abrir a tela de plataformas">${ico("seta")}</button>`);

  /* ——— o dinheiro dia a dia ——— */
  const blocoDia = bloco("Dia a dia", "reembolso e chargeback já descontados", graficoDinheiro());

  /* ——— a decisão do dia ——— */
  const decisao = cartaoDecisao(L, compras);

  /* ——— quem vendeu ——— */
  const porVid = {};
  compras.forEach(c => { if (!c.vid) return;
    (porVid[c.vid] = porVid[c.vid] || {n:0, r:0}); porVid[c.vid].n++; porVid[c.vid].r += (+c.valor||0); });
  const topVid = Object.entries(porVid).sort((a,b) => b[1].r - a[1].r).slice(0, 6)
    .map(([id,v]) => ({id, m:(DADOS.videos||{})[id], val:"R$ "+nf(parte(v.r)),
      sub:`de R$ ${nf(v.r)} · ${v.n} venda${v.n===1?"":"s"}`,
      mt:`<span class="selo-p yt"><span class="pto" style="background:currentColor"></span>YouTube</span>`}));

  const reemb = blocoReembolso();
  return avisos() + `<div class="grade g-h casc">${heroi}${blocoPlat}</div>`
    + (reemb ? `<div class="grade casc">${reemb}</div>` : "")
    + `<div class="grade g-3 casc">${trio}</div>`
    + (decisao ? `<div class="grade casc">${decisao}</div>` : "")
    + `<div class="grade g-h2 casc">`
      + bloco("Quem vendeu", "os seis primeiros · sua parte, e embaixo o total",
          listaVideos(topVid, {vazio:"Nenhuma venda atribuída a vídeo neste período."}),
          `<button class="bt" data-tela="vendas" title="ver todas">${ico("seta")}</button>`)
      + blocoDia
    + `</div>`;
}

/* o cartão de decisão: o que fazer hoje, com capa */
function cartaoDecisao(L, compras){
  const base = L.filter(v => v.views >= 500 && podeJulgarVenda(v.id));
  const cartoes = [];
  if (base.length){
    const comVenda = base.map(v => {
        const d = vendasDo(v.id) || {n:0, receita:0};
        const vr = viewsRastreadas(v.id) || 0;
        return {...v, _n:d.n, _r:d.receita, _p1k: vr ? d.receita/vr*1000 : 0, _vr:vr};
      }).filter(v => v._n > 0).sort((a,b) => b._p1k - a._p1k);
    if (comVenda[0]){
      const v = comVenda[0];
      cartoes.push(deco("ac", "troe", "Vende mais pro tamanho que tem", v.m, v.id,
        "R$ " + brl(parte(v._p1k)),
        `seus, por 1.000 views rastreadas (R$ ${brl(v._p1k)} no total) · ${v._n} venda${v._n===1?"":"s"} · R$ ${nf(parte(v._r))} seus.
         É o CTA deste vídeo que vale copiar pros outros.`));
    }
    const medV = mediana(base.map(v => viewsRastreadas(v.id) || 0).filter(x => x > 0));
    const parado = base.filter(v => (viewsRastreadas(v.id)||0) > medV && !(vendasDo(v.id)||{}).n)
                       .sort((a,b) => (viewsRastreadas(b.id)||0) - (viewsRastreadas(a.id)||0))[0];
    if (parado) cartoes.push(deco("ng", "alerta", "Dinheiro parado", parado.m, parado.id,
      nf(viewsRastreadas(parado.id)),
      "views desde que é rastreado, e nenhuma venda. O link está lá — o que precisa mudar é o CTA."));
  } else if (compras.length){
    /* a medição ainda é nova: "vende pouco pro tamanho" ainda não é frase verdadeira.
       Mas QUEM MAIS VENDEU é fato bruto — esse dá pra mostrar hoje. */
    const porV = {};
    compras.forEach(c => { if (!c.vid) return;
      (porV[c.vid] = porV[c.vid] || {n:0,r:0}); porV[c.vid].n++; porV[c.vid].r += (+c.valor||0); });
    const top = Object.entries(porV).sort((a,b) => b[1].r - a[1].r)[0];
    const m = top && (DADOS.videos||{})[top[0]];
    if (m) cartoes.push(deco("ac", "troe", "Quem mais vendeu " + frasePeriodo(), m, top[0],
      "R$ " + nf(parte(top[1].r)),
      `seus, de R$ ${nf(top[1].r)} no total, em ${top[1].n} venda${top[1].n===1?"":"s"}. Ainda é valor bruto: a conta de “vende pro tamanho
       que tem” liga com ${MIN_DIAS_RASTREIO} dias de medição, e hoje ${diasRastreados()===1?"é":"são"} ${diasRastreados()}.`));
  }
  if (!cartoes.length) return "";
  return `<div class="grade ${cartoes.length>1?"g-2":""}" style="margin:0">${cartoes.join("")}</div>`;
}
function deco(cls, icone, rotulo, m, id, valor, legenda){
  return `<button class="cart clic" data-vid="${esc(id)}" style="display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:start">
    <img src="${esc((m&&m.thumb)||"")}" alt="" loading="lazy"
      style="width:132px;height:74px;border-radius:12px;object-fit:cover;background:var(--carta-3)"
      onerror="this.style.visibility='hidden'">
    <span style="min-width:0;display:block">
      <span class="rot" style="margin-bottom:9px"><span class="selo ${cls}" style="width:24px;height:24px;border-radius:8px">${ico(icone)}</span>${rotulo}</span>
      <span style="display:block;font-size:14px;font-weight:600;line-height:1.35;margin-bottom:7px;
        overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc((m&&m.titulo)||"")}</span>
      <span class="val num" style="font-size:27px;display:block">${valor}</span>
      <span class="sub" style="display:block">${legenda}</span>
    </span></button>`;
}

/* ════════ 2) POR PLATAFORMA ════════
   YouTube · Instagram · TikTok, lado a lado, na mesma régua. É a tela que ele pediu:
   "o foco é de onde vieram as vendas — do YouTube, do Instagram e do TikTok". */
function telaPlataformas(){
  const {lista, total, compras} = porPlataforma();
  if (!compras.length)
    return avisos() + cart(vazioG(`Nenhuma venda registrada ${frasePeriodo()}.`,
      "Troque o período aí em cima, ou espere as próximas entrarem — elas chegam ao vivo."));

  const cartoes = ["youtube","instagram","tiktok","pdf","outra"].map(k => {
    const f = lista.find(x => x.k === k);
    const v = f ? f.val : 0, n = f ? f.n : 0;
    const pc = total ? Math.round(v/total*100) : 0;
    const desc = {
      youtube:  "vendas com utm_source de vídeo do canal",
      instagram:"link da bio e stories",
      tiktok:   "link da bio do TikTok",
      pdf:      "link de dentro dos materiais em PDF",
      outra:    "chegou sem etiqueta: link antigo, WhatsApp, link salvo",
    }[k];
    return `<div class="cart">
      <div class="cab"><div class="rot">${PLAT[k].rot}</div>
        <span class="selo ${PLAT[k].cls}" style="background:color-mix(in srgb,${PLAT[k].cor} 13%,transparent);color:${PLAT[k].cor}">
          ${ico(k==="outra" ? "alerta" : "plat")}</span></div>
      <div class="val num">${v ? dinheiro(parte(v)) : "–"}</div>
      ${v ? deTotal(v) : ""}
      <div class="sub">${n ? `${n} venda${n===1?"":"s"} · ${pc}% do total` : "sem venda no período"}</div>
      <div style="height:6px;border-radius:99px;background:var(--carta-3);margin-top:14px;overflow:hidden">
        <div class="ench" style="height:100%;width:${pc}%;background:${PLAT[k].cor};border-radius:99px"></div></div>
    </div>`;
  }).join("");

  /* por vídeo, mas separando o que não é vídeo (2.6) */
  const porVid = {};
  compras.forEach(c => { const k = c.vid || chaveSolta(c);
    (porVid[k] = porVid[k] || {n:0, r:0, vid:c.vid, orig:{}});
    porVid[k].n++; porVid[k].r += (+c.valor||0);
    const o = origemDe(c.origem); porVid[k].orig[o] = (porVid[k].orig[o]||0)+1; });
  const vids = [], fora = [];
  Object.entries(porVid).sort((a,b) => b[1].r - a[1].r).forEach(([k,d]) => {
    const id = d.vid || k, m = (DADOS.videos||{})[id];
    const dominante = Object.entries(d.orig).sort((a,b) => b[1]-a[1])[0];
    const it = {id, m, val:"R$ "+nf(parte(d.r)), sub:`de R$ ${nf(d.r)} · ${d.n} venda${d.n===1?"":"s"}`,
      mt: dominante ? `<span class="selo-p ${PLAT[dominante[0]].cls}">
            <span class="pto" style="background:currentColor"></span>${PLAT[dominante[0]].rot}</span>` : ""};
    if (m) vids.push(it); else fora.push({naoVideo:true, rotulo:nomeDaOrigemSolta(k), val:"R$ "+nf(parte(d.r)), sub:it.sub});
  });

  return avisos()
    + `<div class="grade g-auto casc">${cartoes}</div>`
    + `<div class="grade g-h2 casc">`
      + bloco("A divisão", `sua parte · de R$ ${nf(total)} no total`,
          total ? rosca(lista.map(p => ({...p, val: parte(p.val)})), parte(total), "sua parte") : "")
      + bloco("Quais vídeos venderam", "com a plataforma de onde veio a maior parte dos cliques",
          listaVideos(vids.slice(0, 12)) + (fora.length ? listaVideos(fora) : ""))
    + `</div>`
    + (window.semTracking ? "" : dobra("O que ainda chega sem etiqueta — e por quê", `
        <div class="vaz-p" style="padding:0">
        <b style="color:var(--t2)">Sem origem</b> não é uma plataforma: é a falta de uma. Acontece quando a
        venda chegou por um link que não tem marcação — a bio antiga, um link mandado no WhatsApp, um
        comentário fixado que ainda não foi trocado, ou um link que a pessoa salvou faz tempo.<br><br>
        Cada link trocado nos vídeos e nos comentários fixados encolhe esse pedaço. O botão
        <b>“8 - Trocar o link do comentario fixado”</b> é o que ataca o maior deles.</div>`));
}


/* ════════ 3) VENDAS ════════ */
function telaVendas(){
  const compras = comprasDoPeriodo();
  if (!compras.length)
    return avisos() + cart(vazioG(`Nenhuma venda registrada ${frasePeriodo()}.`,
      dadosVendasBrutos() ? "Troque o período aí em cima." : "O painel ainda está buscando no recebedor."));

  const total = compras.reduce((a,c) => a + (+c.valor||0), 0);
  const ticket = total / compras.length;
  const {lista: plats} = porPlataforma();
  const porProj = {};
  compras.forEach(c => { const p = c.projeto || "sem projeto"; porProj[p] = (porProj[p]||0) + (+c.valor||0); });

  const porVid = {};
  compras.forEach(c => { const k = c.vid || chaveSolta(c);
    (porVid[k] = porVid[k] || {n:0, r:0, vid:c.vid}); porVid[k].n++; porVid[k].r += (+c.valor||0); });
  const vids = [], fora = [];
  Object.entries(porVid).sort((a,b) => b[1].r - a[1].r).forEach(([k,d]) => {
    const id = d.vid || k, m = (DADOS.videos||{})[id];
    const it = {id, m, val:"R$ "+nf(parte(d.r)), sub:`de R$ ${nf(d.r)} · ${d.n} venda${d.n===1?"":"s"}`};
    if (m) vids.push(it); else fora.push({naoVideo:true, rotulo:nomeDaOrigemSolta(k), val:"R$ "+nf(parte(d.r)), sub:it.sub});
  });

  const kpis = [
    {r:"Sua parte", v:dinheiro(parte(total)), t:total, s:`${compras.length} venda${compras.length===1?"":"s"}`, d:deltaVendas(), ic:"vendas", cls:"ac"},
    {r:"Ticket médio (seu)", v:dinheiro(parte(ticket)), t:ticket, s:"por compra", ic:"troe", cls:""},
    {r:"Vídeos que venderam", v:nf(vids.length), s:"com pelo menos uma venda", ic:"videos", cls:""},
    {r:"Melhor horário", v:melhorHora(compras), s:"é quando o público compra", ic:"relogio", cls:""},
  ].map(c => `<div class="cart">
      <div class="cab"><div class="rot">${c.r}</div><span class="selo ${c.cls}">${ico(c.ic)}</span></div>
      <div class="val num">${c.v}</div>${c.t != null ? deTotal(c.t) : ""}<div class="sub">${c.s}</div>${pilula(c.d)}</div>`).join("");

  return avisos()
    + `<div class="grade g-4 casc">${kpis}</div>`
    + (blocoReembolso() ? `<div class="grade casc">${blocoReembolso()}</div>` : "")
    + `<div class="grade g-h2 casc">`
      + bloco("A que horas as pessoas compram", "hora local de São Paulo", barrasHora(compras))
      + bloco("Qual vídeo trouxe a venda", "pelo que entrou, não pela quantidade",
          listaVideos(vids.slice(0, 14)) + (fora.length ? listaVideos(fora) : ""))
    + `</div>`
    + `<div class="grade g-2 casc">`
      + bloco("O que entrou e o que voltou", "reembolso e chargeback já descontados", graficoDinheiro(),
          segmentoMini("gdinmodo", [["dia","por dia"],["acum","acumulado"]], gDin))
      + bloco("Quando a venda acontece", "em que altura da vida do vídeo", graficoMomento(),
          segmentoMini("gmommodo", [["dias","por idade"],["views","por views"]], gMom))
    + `</div>`
    + `<div class="grade g-2 casc">`
      + bloco("De qual plataforma veio o clique", "sua parte", barrasLado(plats.map(p =>
          ({rot:p.rot, val:p.val, cor:p.cor, txt:"R$ "+nf(parte(p.val))}))))
      + bloco("Em qual projeto da Assiny caiu", "sua parte · útil quando o dinheiro precisa ser conferido lá",
          barrasLado(Object.entries(porProj).sort((a,b)=>b[1]-a[1])
            .map(([k,v]) => ({rot:k, val:v, cor:"var(--ac)", txt:"R$ "+nf(parte(v))}))))
    + `</div>`
    + `<div class="grade casc">${blocoFunil()}</div>`
    + dobra(`Quem comprou — ${compras.length} compra${compras.length===1?"":"s"}, com nome e e-mail`,
        tabelaCompras(compras));
}
function melhorHora(compras){
  const h = {};
  compras.forEach(c => { const x = (c.data||"").slice(11,13); if (x) h[x] = (h[x]||0)+1; });
  const top = Object.entries(h).sort((a,b) => b[1]-a[1])[0];
  return top ? top[0] + "h" : "–";
}
function segmentoMini(id, opcoes, atual){
  return `<div class="seg" id="${id}" style="padding:2px">
    ${opcoes.map(([v,r]) => `<button data-g="${v}" class="${atual===v?"on":""}"
      style="padding:5px 10px;font-size:11.5px">${r}</button>`).join("")}</div>`;
}
function tabelaCompras(compras, canal){
  const ord = [...compras].sort((a,b) => (a.data < b.data ? 1 : -1));
  return `<div class="rolagem"><table class="compras"><thead><tr>
      <th>Quando</th><th>Quem</th><th>Produto</th><th>Veio de</th><th class="d">Sua parte</th></tr></thead><tbody>`
    + ord.map(c => {
        const m = c.vid ? (DADOS.videos||{})[c.vid] : null;
        const o = origemDe(c.origem);
        return `<tr><td>${esc(dt(c.data))} ${esc((c.data||"").slice(11,16))}</td>
          <td>${esc(c.nome||"—")}<div class="email">${esc(c.email||"")}</div></td>
          <td>${esc(corta(c.produto||"—", 34))}</td>
          <td><span class="selo-p ${PLAT[o].cls}"><span class="pto" style="background:currentColor"></span>${PLAT[o].rot}</span>
            ${m ? `<div class="email">${esc(corta(m.titulo, 34))}</div>` : ""}</td>
          <td class="d"><b>R$ ${brl(parte(c.valor, canal))}</b><div class="email">de R$ ${brl(c.valor)}</div></td></tr>`;
      }).join("") + `</tbody></table></div>`;
}

/* ════════ 4) TRÁFEGO PAGO e 5) RECUPERAÇÃO ════════ */
function telaCanal(canal){
  const compras = comprasDoPeriodo(canal);
  const total = compras.reduce((a,c) => a + (+c.valor||0), 0);
  const pct = pctCanal(canal);
  const minha = total * pct / 100;
  const meta = canal === "trafego" ? metaDoPeriodo() : null;

  const kpis = [];
  kpis.push({r:"Sua parte", v: compras.length ? dinheiro(minha) : "–", t: compras.length ? total : null,
             s:`${pct}% do líquido · ${compras.length} venda${compras.length===1?"":"s"} ${NOME_CANAL[canal]}${compras.length===1?"":"s"}`,
             ic:"vendas", cls:"ac", d:deltaVendas(canal)});
  if (meta){
    const roas = meta.gasto ? total / meta.gasto : 0;
    kpis.push({r:"Investido no Meta", v: meta.gasto ? dinheiro(meta.gasto) : "–",
               s:`${meta.dias} dia${meta.dias===1?"":"s"} com gasto · ${esc(meta.conta||"")}`, ic:"pago", cls:""});
    kpis.push({r:"ROAS", v: meta.gasto ? roas.toFixed(2).replace(".",",") + "×" : "–",
               s: meta.gasto ? (roas >= 1 ? "sobre o total da venda · cada real virou mais de um" : "sobre o total da venda · cada real voltou menos que um")
                             : "sem gasto no período",
               ic:"troe", cls: roas >= 1 ? "ac" : "ng"});
  }
  const cartoesKpi = kpis.map(c => `<div class="cart">
      <div class="cab"><div class="rot">${c.r}</div><span class="selo ${c.cls}">${ico(c.ic)}</span></div>
      <div class="val num">${c.v}</div>${c.t != null ? deTotal(c.t) : ""}<div class="sub">${c.s}</div>${pilula(c.d)}</div>`).join("");

  let corpo = "";
  if (!compras.length){
    corpo = cart(vazioG(`Nenhuma venda ${NOME_CANAL[canal]} ${frasePeriodo()}.`,
      canal === "recuperacao"
        ? "Se o time recuperou venda e ela não aparece aqui, o webhook do projeto Recuperação pode não estar ativo na Assiny."
        : "Se o gestor de tráfego rodou campanha no período, a venda pode estar caindo na Kirvano — ver as notas do projeto."));
  } else {
    const porVid = {};
    compras.forEach(c => { const k = c.vid || chaveSolta(c);
      (porVid[k] = porVid[k] || {n:0, r:0, vid:c.vid}); porVid[k].n++; porVid[k].r += (+c.valor||0); });
    const vids = [], fora = [];
    Object.entries(porVid).sort((a,b) => b[1].r - a[1].r).forEach(([k,d]) => {
      const id = d.vid || k, m = (DADOS.videos||{})[id];
      const it = {id, m, val:"R$ "+nf(parte(d.r, canal)), sub:`de R$ ${nf(d.r)} · ${d.n} venda${d.n===1?"":"s"}`};
      if (m) vids.push(it); else fora.push({naoVideo:true, rotulo:nomeDaOrigemSolta(k), val:"R$ "+nf(parte(d.r, canal)), sub:it.sub});
    });
    corpo = `<div class="grade g-h2 casc">`
      + bloco("A que horas", "", barrasHora(compras))
      + bloco("De onde veio", "", listaVideos(vids.slice(0,10)) + (fora.length ? listaVideos(fora) : ""))
      + `</div>`;
  }

  /* campanhas do Meta */
  let camp = "";
  if (meta && meta.camp && Object.keys(meta.camp).length){
    const lista = Object.values(meta.camp).sort((a,b) => b.gasto - a.gasto)
      .map(c => ({rot:c.nome || "(sem nome)", val:c.gasto, cor:"var(--ac)",
                  txt:"R$ "+nf(c.gasto),
                  pc:null}));
    camp = bloco("Onde o dinheiro foi gasto", "por campanha, no período escolhido", barrasLado(lista))
      + (meta.compras_pixel ? `<div class="sub" style="margin-top:-6px;padding:0 2px 14px">
          O pixel do Meta registrou <b style="color:var(--t1)">${nf(meta.compras_pixel)} compra${meta.compras_pixel===1?"":"s"}</b>
          (R$ ${nf(meta.valor_pixel)}). Esse número é do Meta, não do recebedor — os dois raramente batem,
          porque o pixel conta atribuição por visualização e o recebedor conta venda confirmada.</div>` : "");
  } else if (canal === "trafego"){
    camp = cart(vazioG("Meta Ads não conectado neste período.",
      "Rode o botão <b>10 - Conectar e puxar Meta Ads</b>, ou confira se o token ainda vale."));
  }
  /* o dado do Meta tem data própria: se ele parar de chegar, o painel DIZ há quanto tempo,
     em vez de mostrar o investimento de ontem como se fosse o de hoje. */
  let avisoMeta = "";
  if (canal === "trafego" && typeof META !== "undefined" && META && META.atualizado){
    const h = (Date.now() - new Date(META.atualizado).getTime()) / 3600000;
    if (h > 14) avisoMeta = `<div class="aviso grave"><span class="selo ng">${ico("alerta")}</span><div>
      <b>O investimento do Meta não atualiza há ${h >= 48 ? Math.floor(h/24) + " dias" : Math.round(h) + " horas"}.</b>
      A rotina tenta a cada rodada. Quando a Meta responde <i>“API access blocked”</i>, o problema
      não é aqui: é o acesso do app ou da conta de anúncios, e quem resolve é quem passou o token.
      O que está na tela é a última leitura boa, de ${dt(META.atualizado)} ${String(META.atualizado).slice(11,16)}.
      </div></div>`;
  }

  return avisos() + avisoMeta + `<div class="grade ${kpis.length>=4?"g-4":kpis.length===3?"g-3":"g-2"} casc">${cartoesKpi}</div>`
    + corpo + (camp ? `<div class="grade casc">${camp}</div>` : "")
    + (canal === "trafego" ? `<div class="grade casc">${funilPago(compras)}</div>` : "")
    + (compras.length ? dobra(`Quem comprou — ${compras.length} compra${compras.length===1?"":"s"}`,
        tabelaCompras(compras, canal)) : "");
}

/* ════════ HISTÓRICO (18/09/2026) ════════
   O dinheiro de antes do rastreio ao vivo, importado do extrato da Assiny por
   _motor/importar_historico.py. É CAIXA: o dinheiro que entrou e saiu da conta da
   Brainmax, por mês. Não é atribuição por vídeo — antes de 14/09 o link era o mesmo em
   todos, então venda antiga não tem vídeo de origem, e nunca vai ter. */
const MES_CURTO = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const MES_LONGO = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto",
                   "setembro","outubro","novembro","dezembro"];
const nomeMes = (k, longo) => { const [a, m] = k.split("-"); const i = (+m) - 1;
  return (longo ? MES_LONGO[i] : MES_CURTO[i]) + (longo ? " de " + a : "/" + a.slice(2)); };
const temHist = () => typeof HISTORICO !== "undefined" && HISTORICO && HISTORICO.caixa;
/* "mês passado" = o último mês INTEIRO que o arquivo cobre. O mês corrente nunca é
   "mês passado", mesmo que seja o último do arquivo — ele ainda não acabou. */
function ultimoMesFechado(){
  if (!temHist()) return null;
  const atual = isoLocal(new Date()).slice(0,7);
  const ks = Object.keys(HISTORICO.caixa.meses).filter(k => k < atual).sort();
  if (!ks.length) return null;
  const k = ks[ks.length-1];
  const ant = ks.length > 1 ? ks[ks.length-2] : null;
  return {k, m: HISTORICO.caixa.meses[k], ant, ma: ant ? HISTORICO.caixa.meses[ant] : null};
}
/* o mês está inteiro dentro do arquivo? (julho começou no dia 02; setembro vai até 16) */
function mesCompleto(k){
  const c = HISTORICO.caixa; const [a, m] = k.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  const ini = k + "-01", fim = k + "-" + String(ultimo).padStart(2, "0");
  return c.de <= ini && c.ate >= fim ? "inteiro"
       : `de ${dt(c.de > ini ? c.de : ini).slice(0,5)} a ${dt(c.ate < fim ? c.ate : fim).slice(0,5)}`;
}

/* o projeto da Assiny diz de qual plataforma era o link — é assim que dá pra separar o
   histórico por plataforma mesmo antes de o utm_source=youtube existir (antes vinha "organic"). */
const PROJETO_PLAT = {brainmax: "youtube", youtube: "youtube", instagram: "instagram", tiktok: "tiktok"};
const platDoProjeto = pj => PROJETO_PLAT[semAcento(pj)] || "outra";
const temVendasHist = () => temHist() && HISTORICO.vendas && HISTORICO.vendas.meses;
function ultimoMesVendas(){
  if (!temVendasHist()) return null;
  const atual = isoLocal(new Date()).slice(0,7);
  const ks = Object.keys(HISTORICO.vendas.meses).filter(k => k < atual).sort();
  if (!ks.length) return null;
  const k = ks[ks.length-1], ant = ks.length > 1 ? ks[ks.length-2] : null;
  return {k, m: HISTORICO.vendas.meses[k], ant, ma: ant ? HISTORICO.vendas.meses[ant] : null};
}
/* os meses com o dinheiro já convertido pra parte dele — pro gráfico de barras */
const mesesParte = meses => Object.fromEntries(Object.entries(meses).map(([k, m]) =>
  [k, {...m, liquido: parte(m.liquido), reemb_liquido: parte(m.reemb_liquido), bumps_liquido: parte(m.bumps_liquido)}]));
const pctReemb = m => { const t = m.pedidos + m.pedidos_reemb; return t ? m.pedidos_reemb / t * 100 : 0; };
const soMes = k => nomeMes(k, true).replace(/ de \d+/, "");

function telaHistorico(){
  if (!temHist() || (!HISTORICO.caixa && !temVendasHist()))
    return cart(vazioG("Ainda não tem histórico importado.",
      "Baixe o relatório de transações na Assiny, salve em <b>dados/vendas/historico/</b> e rode "
      + "<b>“14 - Importar historico da Assiny.command”</b>."));
  const H = HISTORICO, V = H.vendas, C = H.caixa;
  if (!V) return telaHistoricoCaixa();

  const ks = Object.keys(V.meses).sort();
  const u = ultimoMesVendas();
  const aviso = `<div class="aviso"><span class="selo al">${ico("calend")}</span><div>
    <b>Vendas de ${dt(V.de)} a ${dt(V.ate)}</b>, dos projetos ${V.projetos.join(", ")} da Assiny.
    ${C ? `O caixa (dinheiro que caiu na conta) vai de ${dt(C.de)} a ${dt(C.ate)}.` : ""}
    Antes de ${dt(V.de)} não há venda nesses arquivos. Se existir outro projeto ou período, é só exportar
    e rodar o importador de novo — ele junta sem contar nada duas vezes.</div></div>`;

  /* ——— o cartão escuro: o mês passado ——— */
  let heroi = "", quatro = "";
  if (u){
    const d = u.ma && u.ma.liquido ? {r: u.m.liquido / u.ma.liquido, base: soMes(u.ant)} : null;
    heroi = `<section class="cart heroi">
      <div class="rot">${ico("calend")} Sua parte · ${nomeMes(u.k, true)}</div>
      <div class="val num">${dinheiro(parte(u.m.liquido))}</div>
      ${deTotal(u.m.liquido)}
      ${pilula(d)}
      <div class="sub">${nf(u.m.pedidos)} pedidos · ticket médio R$ ${nf(parte(u.m.liquido / (u.m.pedidos||1)))} seu
        · ${nf(u.m.pedidos_reemb)} reembolsados (${pctReemb(u.m).toFixed(0)}%)</div>
      ${faiscaMeses(ks.map(k => parte(V.meses[k].liquido)), ks, "sua parte")}
    </section>`;
    const cx = C && C.meses[u.k];
    const base = u.ant ? soMes(u.ant) : "";
    quatro = [
      {r:"Pedidos que ficaram", v:nf(u.m.pedidos), s:`de ${nf(u.m.pedidos + u.m.pedidos_reemb)} feitos no mês`,
       d: u.ma ? {r: u.m.pedidos/(u.ma.pedidos||1), base} : null, ic:"troe", cls:"ac"},
      {r:"Taxa de reembolso", v:pctReemb(u.m).toFixed(1).replace(".",",") + "%",
       s:`R$ ${nf(parte(u.m.reemb_liquido))} seus voltaram (de R$ ${nf(u.m.reemb_liquido)})`,
       d: u.ma && pctReemb(u.ma) ? {r: pctReemb(u.m)/pctReemb(u.ma), base} : null, inv:true, ic:"recup", cls:"ng"},
      {r:"Order bumps (sua parte)", v:"R$ " + nf(parte(u.m.bumps_liquido)), t:u.m.bumps_liquido,
       s:`${nf(u.m.bumps)} vendidos · ${u.m.pedidos ? (u.m.bumps/u.m.pedidos).toFixed(2).replace(".",",") : "0"} por pedido`,
       d: u.ma && u.ma.bumps_liquido ? {r: u.m.bumps_liquido/u.ma.bumps_liquido, base} : null, ic:"mais", cls:""},
      {r:"Caiu na conta (sua parte)", v: cx ? "R$ " + nf(parte(cx.liquido)) : "–", t: cx ? cx.liquido : null,
       s: cx ? "caixa do mês, já sem reembolsos" : "o extrato não cobre este mês", ic:"vendas", cls:""},
    ].map(c => `<div class="cart">
        <div class="cab"><div class="rot">${c.r}</div><span class="selo ${c.cls}">${ico(c.ic)}</span></div>
        <div class="val num">${c.v}</div>${c.t != null ? deTotal(c.t) : ""}<div class="sub">${c.s}</div>${pilula(c.d, c.inv)}</div>`).join("");
  }

  /* ——— de onde veio: plataforma pelo projeto ——— */
  const porPlat = {};
  Object.values(V.por_projeto).forEach(pjs => Object.entries(pjs).forEach(([pj, m]) => {
    const k = platDoProjeto(pj); porPlat[k] = (porPlat[k] || 0) + m.liquido; }));
  const totPlat = Object.values(porPlat).reduce((a,b) => a+b, 0);
  const fatias = Object.entries(porPlat).sort((a,b) => b[1]-a[1])
    .map(([k,v]) => ({k, rot: PLAT[k].rot, cor: PLAT[k].cor, val: v}));

  /* ——— os produtos ——— */
  const prods = Object.entries(V.produtos).map(([p, x]) => ({
    rot: p, val: x.liquido, cor: p.toLowerCase() === "tokfy" ? "var(--ac)" : "var(--pdf)",
    txt: `R$ ${nf(parte(x.liquido))}`, pc: x.n ? Math.round(x.reemb / x.n * 100) : 0}));

  /* ——— a tabela mês a mês ——— */
  const plats = ["youtube","instagram","tiktok"].filter(k => porPlat[k]);
  const linhasT = ks.slice().reverse().map(k => {
    const m = V.meses[k], pj = V.por_projeto[k] || {};
    const pp = {}; Object.entries(pj).forEach(([n, x]) => { const p = platDoProjeto(n); pp[p] = (pp[p]||0) + x.liquido; });
    const cx = C && C.meses[k];
    const pr = pctReemb(m);
    return `<tr style="cursor:default">
      <td class="vid" style="min-width:150px"><b style="font-weight:600">${nomeMes(k, true)}</b>
        ${mesCobertoV(k) !== "inteiro" ? `<div class="email">${mesCobertoV(k)}</div>` : ""}</td>
      <td>${nf(m.pedidos)}</td>
      <td class="${pr >= 30 ? "neg" : ""}">${pr.toFixed(0)}%</td>
      <td><b style="font-weight:600">R$ ${nf(parte(m.liquido))}</b><div class="bruto">de R$ ${nf(m.liquido)}</div></td>
      <td>R$ ${nf(parte(m.liquido / (m.pedidos||1)))}<div class="bruto">de R$ ${nf(m.liquido / (m.pedidos||1))}</div></td>
      <td>R$ ${nf(parte(m.bumps_liquido))}<div class="bruto">de R$ ${nf(m.bumps_liquido)}</div></td>
      ${plats.map(p => `<td>${pp[p] ? "R$ " + nf(parte(pp[p])) + `<div class="bruto">de R$ ${nf(pp[p])}</div>` : '<span class="nd">–</span>'}</td>`).join("")}
      <td>${cx ? "R$ " + nf(parte(cx.liquido)) + `<div class="bruto">de R$ ${nf(cx.liquido)}</div>` : '<span class="nd">–</span>'}</td>
    </tr>`;
  }).join("");
  const th = t => `<th style="cursor:default">${t}</th>`;
  const tabela = `<div class="tab-caixa casc" style="margin-bottom:16px">
    <div class="tab-topo"><div><h3>Mês a mês</h3>
      <div class="leg">em cima, sua parte (${pctParte()}% do líquido); embaixo, o total · venda pela data da compra, com o status de hoje · “caiu na conta” é o caixa, pela data do dinheiro</div></div></div>
    <div class="rolagem"><table><thead><tr>
      <th class="vid" style="cursor:default">Mês</th>${th("Pedidos")}${th("Reemb.")}${th("Sua parte")}${th("Ticket")}${th("Bumps")}
      ${plats.map(p => th(PLAT[p].rot)).join("")}${th("Caiu na conta")}
    </tr></thead><tbody>${linhasT}</tbody></table></div></div>`;

  const explica = dobra("Como ler estes números", `<div class="vaz-p" style="padding:0">
    <b style="color:var(--t2)">Pedido</b> é a compra do Tokfy. Os order bumps (Treinamento, Comunidade, Suporte) entram
    no mesmo pedido e contam como receita, não como pedido novo.<br><br>
    <b style="color:var(--t2)">“Ficou”</b> é o status de hoje: uma venda de agosto reembolsada em setembro já não conta em
    agosto. Por isso um mês recente pode ainda perder um pouco nos próximos dias.<br><br>
    <b style="color:var(--t2)">Sua parte</b> é ${pctParte()}% do líquido — o número grande em cada lugar. Embaixo, pequeno, vem
    o total da venda antes da divisão. O percentual fica em <code>dados/vendas/canais.js</code>.<br><br>
    <b style="color:var(--t2)">Líquido</b> é depois da taxa da Assiny. <b>Não é lucro</b>: não desconta tráfego, custo da
    sociedade nem imposto.<br><br>
    <b style="color:var(--t2)">Vendido × caiu na conta.</b> São dois relógios. “Vendido” conta a venda no dia da compra.
    “Caiu na conta” conta o dinheiro no dia em que ele se mexeu — cartão parcelado cai depois, e o reembolso
    sai no mês em que acontece, mesmo que a venda seja do mês anterior. Os dois nunca batem mês a mês,
    e está certo que não batam.<br><br>
    <b style="color:var(--t2)">Plataforma</b> vem do projeto: Brainmax é o link do YouTube, Instagram e Tiktok são os das bios.
    Não dá pra saber o vídeo: antes de 14/09 o link era o mesmo em todos.<br><br>
    <b style="color:var(--t2)">Não some com a aba Vendas.</b> De 14/09 em diante as vendas chegam também ao vivo. São o mesmo
    dinheiro por dois caminhos.
  </div>`);

  return aviso
    + (heroi ? `<div class="grade g-h casc">${heroi}${bloco("Mês a mês", "sua parte · o que ficou e o que foi reembolsado", graficoMesesV(ks, mesesParte(V.meses)))}</div>` : "")
    + (quatro ? `<div class="grade g-4 casc">${quatro}</div>` : "")
    + `<div class="grade g-2 casc">`
      + bloco("De onde veio", `sua parte · de R$ ${nf(totPlat)} no total · pelo projeto da Assiny`,
          rosca(fatias.map(f => ({...f, val: parte(f.val)})), parte(totPlat), "sua parte"))
      + bloco("Os produtos", "sua parte do que ficou · % à direita é a taxa de reembolso", barrasLado(prods))
    + `</div>`
    + tabela
    + `<div class="grade g-h2 casc">`
      + bloco("A que horas vendia", `${nf(Object.values(V.horas).reduce((a,b)=>a+b,0))} pedidos que ficaram`, barrasHorasHist(V.horas))
      + bloco("Dia a dia", "sua parte do que ficou, por dia da compra",
          graficoDiasV(Object.fromEntries(Object.entries(V.dias).map(([d, x]) => [d, {...x, liquido: parte(x.liquido)}]))))
    + `</div>`
    + explica;
}
function mesCobertoV(k){
  const V = HISTORICO.vendas; const [a, m] = k.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  const ini = k + "-01", fim = k + "-" + String(ultimo).padStart(2, "0");
  return V.de <= ini && V.ate >= fim ? "inteiro"
       : `de ${dt(V.de > ini ? V.de : ini).slice(0,5)} a ${dt(V.ate < fim ? V.ate : fim).slice(0,5)}`;
}
/* barras: o que ficou (verde) e o que foi reembolsado (vermelho) */
function graficoMesesV(ks, meses){
  const W = 560, H = 230, PL = 50, PB = 30, PT = 14;
  const teto = Math.max(...ks.map(k => meses[k].liquido), 1);
  const passo = (W - PL) / ks.length, larg = Math.min(34, passo / 2 - 8);
  const py = v => PT + (1 - v/teto) * (H - PT - PB);
  let g = "", b = "", e = "", a = "";
  for (let i = 0; i <= 3; i++){ const v = teto*i/3, y = py(v);
    g += `<line class="lin-g" x1="${PL}" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}"/>
      <text x="${PL-9}" y="${(y+4).toFixed(1)}" text-anchor="end">${i ? "R$ " + curto(v) : "0"}</text>`; }
  ks.forEach((k, i) => {
    const m = meses[k], x0 = PL + i*passo + passo/2;
    const h1 = (m.liquido/teto)*(H-PT-PB), h2 = (m.reemb_liquido/teto)*(H-PT-PB);
    b += `<rect class="colu" x="${(x0-larg-2).toFixed(1)}" y="${(H-PB-h1).toFixed(1)}" width="${larg.toFixed(1)}"
        height="${h1.toFixed(1)}" rx="6" fill="var(--ac)" style="animation-delay:${(i*.08).toFixed(2)}s"/>
      <rect class="colu" x="${(x0+2).toFixed(1)}" y="${(H-PB-h2).toFixed(1)}" width="${larg.toFixed(1)}"
        height="${Math.max(h2,2).toFixed(1)}" rx="6" fill="var(--neg)" opacity=".85" style="animation-delay:${(i*.08+.04).toFixed(2)}s"/>`;
    e += `<text x="${x0.toFixed(1)}" y="${H-9}" text-anchor="middle">${nomeMes(k)}</text>`;
    a += `<rect class="alvo" data-i="${i}" x="${(PL+i*passo).toFixed(1)}" y="${PT}" width="${passo.toFixed(1)}"
      height="${H-PT-PB}" fill="transparent"/>`;
  });
  window._histMesesV = {ks, meses};
  return caixaGrafico("ghmesv", g + b + e + a, {w:W, h:H, max:260})
    + `<div class="leg-g"><span><i style="background:var(--ac)"></i>ficou (sua parte)</span>
       <span><i style="background:var(--neg)"></i>reembolsado</span></div>`;
}
function barrasHorasHist(horas){
  const cols = Array.from({length:24}, (_,h) => ({h, val: horas[String(h).padStart(2,"0")] || 0}));
  const teto = Math.max(...cols.map(c => c.val), 1);
  const pico = cols.reduce((a,b) => b.val > a.val ? b : a, cols[0]);
  const W = 720, H = 168, PB = 26, PT = 12, passo = W/24, larg = Math.min(20, passo - 7);
  let b = "", e = "", a = "";
  cols.forEach((c,i) => {
    const x = i*passo + (passo-larg)/2, alt = c.val ? Math.max(3, c.val/teto*(H-PT-PB)) : 2;
    b += `<rect class="colu" x="${x.toFixed(1)}" y="${(H-PB-alt).toFixed(1)}" width="${larg.toFixed(1)}" height="${alt.toFixed(1)}"
      rx="4" fill="${c === pico ? "var(--ac)" : "var(--carta-3)"}" style="animation-delay:${(i*.016).toFixed(3)}s"/>`;
    if (!(i % 3)) e += `<text x="${(x+larg/2).toFixed(1)}" y="${H-8}" text-anchor="middle">${String(i).padStart(2,"0")}</text>`;
    a += `<rect class="alvo" data-i="${i}" x="${(i*passo).toFixed(1)}" y="${PT}" width="${passo.toFixed(1)}" height="${H-PT-PB}" fill="transparent"/>`;
  });
  window._histHoras = cols;
  return caixaGrafico("ghhora", b + e + a, {w:W, h:H, max:180})
    + `<div class="sub">Pico às <b style="color:var(--t1)">${String(pico.h).padStart(2,"0")}h</b> — com
       ${nf(cols.reduce((x,c)=>x+c.val,0))} pedidos, esse horário já é padrão, não acaso.</div>`;
}
function graficoDiasV(dias){
  const conv = {}; Object.entries(dias).forEach(([d, x]) => conv[d] = {entrou: x.liquido, saiu: 0});
  return graficoDiasHist(conv);
}
/* o histórico só de caixa, pra quando não houver relatório de transações importado */
function telaHistoricoCaixa(){
  if (!temHist()) return cart(vazioG("Ainda não tem histórico importado.",
    "Baixe o extrato na Assiny, salve em <b>dados/vendas/historico/</b> e rode "
    + "<b>“14 - Importar historico da Assiny.command”</b>."));
  const H = HISTORICO, C = H.caixa, V = H.vendas_caixa || {meses:{}};
  const ks = Object.keys(C.meses).sort();
  const u = ultimoMesFechado();

  /* ——— cobertura: o que o arquivo tem e o que não tem ——— */
  const primeiroMes = ks[0];
  let aviso = `<div class="aviso"><span class="selo al">${ico("calend")}</span><div>
    <b>Este histórico cobre de ${dt(C.de)} a ${dt(C.ate)}.</b> É o que veio no arquivo exportado da
    Assiny. Se houve venda antes de ${nomeMes(primeiroMes, true).replace(/ de \d+/, "")}, ela não está aqui —
    é só exportar o período que falta e rodar o importador de novo: ele junta os arquivos sem contar
    nada duas vezes.</div></div>`;

  /* ——— o cartão escuro: o mês passado ——— */
  let heroi = "";
  if (u){
    const d = u.ma && u.ma.liquido ? {r: u.m.liquido / u.ma.liquido, base: nomeMes(u.ant, true).replace(/ de \d+/, "")} : null;
    const pctR = u.m.entrou ? Math.round(-u.m.reembolsos / u.m.entrou * 100) : 0;
    heroi = `<section class="cart heroi">
      <div class="rot">${ico("calend")} Sua parte · ${nomeMes(u.k, true)}</div>
      <div class="val num">${dinheiro(parte(u.m.liquido))}</div>
      ${deTotal(u.m.liquido)}
      ${pilula(d)}
      <div class="sub">entrou R$ ${nf(u.m.entrou)} · voltou R$ ${nf(-u.m.reembolsos)} em reembolso (${pctR}%)</div>
      ${faiscaMeses(ks.map(k => C.meses[k].liquido), ks, "líquido na conta")}
    </section>`;
  }

  /* ——— os números do mês passado ——— */
  const vu = u && V.meses[u.k];
  const trio = u ? [
    {r:"Entrou na conta", v:dinheiro(u.m.entrou), s:`${u.m.movimentos} movimentos no extrato`,
     d: u.ma ? {r: u.m.entrou / (u.ma.entrou||1), base: nomeMes(u.ant, true).replace(/ de \d+/, "")} : null, ic:"vendas", cls:"ac"},
    {r:"Reembolsos", v:dinheiro(-u.m.reembolsos),
     s:`${u.m.entrou ? Math.round(-u.m.reembolsos / u.m.entrou * 100) : 0}% do que entrou`,
     d: u.ma && u.ma.reembolsos ? {r: u.m.reembolsos / u.ma.reembolsos, base: nomeMes(u.ant, true).replace(/ de \d+/, "")} : null,
     inv:true, ic:"recup", cls:"ng"},
    {r:"Vendas que viraram dinheiro", v: vu ? nf(vu.n) : "–",
     s: vu && vu.n ? `ticket médio R$ ${nf(vu.bruto / vu.n)} · no cartão, só as já antecipadas` : "",
     ic:"troe", cls:""},
  ].map(c => `<div class="cart">
      <div class="cab"><div class="rot">${c.r}</div><span class="selo ${c.cls}">${ico(c.ic)}</span></div>
      <div class="val num">${c.v}</div>${c.t != null ? deTotal(c.t) : ""}<div class="sub">${c.s}</div>${pilula(c.d, c.inv)}</div>`).join("") : "";

  /* ——— as barras mês a mês ——— */
  const barras = graficoMeses(ks, C.meses);

  /* ——— a tabela ——— */
  const linhasT = ks.slice().reverse().map(k => {
    const m = C.meses[k], v = V.meses[k];
    const pctR = m.entrou ? Math.round(-m.reembolsos / m.entrou * 100) : 0;
    const pix = v && v.n ? Math.round((v.formas.pix || 0) / v.n * 100) : null;
    const cob = mesCompleto(k);
    return `<tr style="cursor:default">
      <td class="vid" style="min-width:150px"><b style="font-weight:600">${nomeMes(k, true)}</b>
        ${cob !== "inteiro" ? `<div class="email">${cob}</div>` : ""}</td>
      <td>R$ ${nf(m.entrou)}</td>
      <td class="neg">R$ ${nf(-m.reembolsos)}</td>
      <td class="${pctR >= 15 ? "neg" : ""}">${pctR}%</td>
      <td><b style="font-weight:600">R$ ${nf(m.liquido)}</b></td>
      <td>${v ? nf(v.n) : "–"}</td>
      <td>${v && v.n ? "R$ " + nf(v.bruto / v.n) : "–"}</td>
      <td>${pix == null ? "–" : pix + "%"}</td>
    </tr>`;
  }).join("");
  const tabela = `<div class="tab-caixa casc" style="margin-bottom:16px">
    <div class="tab-topo"><div><h3>Mês a mês</h3>
      <div class="leg">caixa pela data em que o dinheiro se mexeu · vendas pela data da compra</div></div></div>
    <div class="rolagem"><table><thead><tr>
      <th class="vid" style="cursor:default">Mês</th><th style="cursor:default">Entrou</th>
      <th style="cursor:default">Reembolsos</th><th style="cursor:default" title="reembolso ÷ o que entrou">% reemb.</th>
      <th style="cursor:default">Líquido</th>
      <th style="cursor:default" title="vendas que já viraram dinheiro na conta — no cartão, só as já antecipadas">Vendas*</th>
      <th style="cursor:default">Ticket</th><th style="cursor:default">PIX</th>
    </tr></thead><tbody>${linhasT}</tbody></table></div></div>`;

  /* ——— o dia a dia ——— */
  const dia = graficoDiasHist(C.dias);

  const explica = dobra("O que este histórico é — e o que ele não é", `<div class="vaz-p" style="padding:0">
    <b style="color:var(--t2)">É o caixa.</b> Veio do <i>extrato de movimentações</i> da Assiny: cada linha é
    dinheiro entrando ou saindo da conta da Brainmax. <b>Entrou</b> é o que foi creditado (PIX cai inteiro;
    cartão cai quando é antecipado). <b>Reembolsos</b> é o que voltou. <b>Líquido</b> é a diferença, já sem a
    taxa da Assiny. Conferido centavo por centavo contra o arquivo: R$ ${nf(ks.reduce((a,k)=>a+C.meses[k].entrou,0))} de entradas.<br><br>
    <b style="color:var(--t2)">Não é lucro.</b> Não desconta tráfego pago, coprodução, imposto nem custo nenhum —
    é o que passou pela conta.<br><br>
    <b style="color:var(--t2)">“Vendas” está por baixo.</b> Venda no cartão só aparece no extrato quando o dinheiro dela se
    move. Parcelada ainda não antecipada não está lá — em 03/09, 8 de 9 vendas no cartão faltavam. Pra ter a
    lista completa de vendas, o formato certo é o <i>relatório de transações</i> da Assiny; o importador já
    entende esse formato também.<br><br>
    <b style="color:var(--t2)">Não tem vídeo de origem.</b> Antes de 14/09 o link era o mesmo em todos os vídeos. Venda dessa
    época não tem como ser atribuída a um vídeo — por isso o histórico vive aqui, separado da atribuição.<br><br>
    <b style="color:var(--t2)">Não se soma com o ao vivo.</b> De 14/09 em diante as vendas também chegam pelo recebedor.
    As duas telas mostram o mesmo dinheiro por dois caminhos — somar daria em dobro.
  </div>`);

  return aviso
    + (heroi ? `<div class="grade g-h casc">${heroi}${bloco("Mês a mês", "o que entrou e o que voltou", barras)}</div>` : "")
    + (trio ? `<div class="grade g-3 casc">${trio}</div>` : "")
    + tabela
    + `<div class="grade casc">${bloco("Dia a dia", "o que entrou na conta em cada dia", dia)}</div>`
    + explica;
}

/* faísca de meses dentro do cartão escuro */
function faiscaMeses(vals, ks, rot){
  if (vals.length < 2) return "";
  const W = 560, H = 80, n = vals.length, teto = Math.max(...vals, 1);
  const px = i => i * W / (n - 1), py = v => 6 + (1 - v/teto) * (H - 12);
  const linha = "M" + vals.map((v,i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" L");
  const lg = W / (n - 1);
  const alvosM = ks ? vals.map((v,i) => `<rect class="alvo" data-i="${i}" x="${(px(i)-lg/2).toFixed(1)}" y="0"
    width="${lg.toFixed(1)}" height="${H}" fill="transparent"/>`).join("") : "";
  window._faiscaMeses = ks ? {ks, vals, rot: rot || "sua parte", pts: vals.map(v => py(v))} : null;
  return `<div style="margin-top:auto;padding-top:16px"><div class="svgb" id="gfm-box"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
    class="gsvg" id="gfm" style="height:80px;overflow:visible">
    <defs><linearGradient id="grd-fm" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--ac)" stop-opacity=".4"/>
    <stop offset="100%" stop-color="var(--ac)" stop-opacity="0"/></linearGradient></defs>
    <path class="area" d="${linha} L${W},${H} L0,${H} Z" fill="url(#grd-fm)"/>
    <path class="traco" d="${linha}" stroke="var(--ac)" stroke-width="2.4" style="--len:1400"/>
    ${vals.map((v,i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="3.5" fill="var(--ac)" stroke="var(--escuro)" stroke-width="2"/>`).join("")}${alvosM}
  </svg></div></div>`;
}

/* barras mês a mês: o que entrou (verde) e o que voltou (vermelho), lado a lado */
function graficoMeses(ks, meses){
  const W = 560, H = 230, PL = 50, PB = 30, PT = 14;
  const teto = Math.max(...ks.map(k => meses[k].entrou), 1);
  const passo = (W - PL) / ks.length, larg = Math.min(34, passo / 2 - 8);
  const py = v => PT + (1 - v/teto) * (H - PT - PB);
  let g = "", b = "", e = "", a = "";
  for (let i = 0; i <= 3; i++){ const v = teto*i/3, y = py(v);
    g += `<line class="lin-g" x1="${PL}" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}"/>
      <text x="${PL-9}" y="${(y+4).toFixed(1)}" text-anchor="end">${i ? "R$ " + curto(v) : "0"}</text>`; }
  ks.forEach((k, i) => {
    const m = meses[k], x0 = PL + i*passo + passo/2;
    const h1 = (m.entrou/teto)*(H-PT-PB), h2 = (-m.reembolsos/teto)*(H-PT-PB);
    b += `<rect class="colu" x="${(x0-larg-2).toFixed(1)}" y="${(H-PB-h1).toFixed(1)}" width="${larg.toFixed(1)}"
        height="${h1.toFixed(1)}" rx="6" fill="var(--ac)" style="animation-delay:${(i*.08).toFixed(2)}s"/>
      <rect class="colu" x="${(x0+2).toFixed(1)}" y="${(H-PB-h2).toFixed(1)}" width="${larg.toFixed(1)}"
        height="${Math.max(h2,2).toFixed(1)}" rx="6" fill="var(--neg)" opacity=".85" style="animation-delay:${(i*.08+.04).toFixed(2)}s"/>`;
    e += `<text x="${x0.toFixed(1)}" y="${H-9}" text-anchor="middle">${nomeMes(k)}</text>`;
    a += `<rect class="alvo" data-i="${i}" x="${(PL+i*passo).toFixed(1)}" y="${PT}" width="${passo.toFixed(1)}"
      height="${H-PT-PB}" fill="transparent"/>`;
  });
  window._histMeses = {ks, meses};
  return caixaGrafico("ghmes", g + b + e + a, {w:W, h:H, max:260})
    + `<div class="leg-g"><span><i style="background:var(--ac)"></i>entrou</span>
       <span><i style="background:var(--neg)"></i>voltou (reembolso)</span></div>`;
}

/* o dia a dia do caixa */
function graficoDiasHist(dias){
  const ks = Object.keys(dias).sort();
  if (ks.length < 2) return vazioG("Poucos dias pra desenhar.", "");
  // preenche os dias sem movimento com zero, senão a linha pula o fim de semana
  const tudo = [];
  for (let d = new Date(ks[0]+"T00:00:00"); isoLocal(d) <= ks[ks.length-1]; d = new Date(d.getTime()+86400000))
    tudo.push({d: isoLocal(d), v: (dias[isoLocal(d)] || {}).entrou || 0, s: (dias[isoLocal(d)] || {}).saiu || 0});
  const W = 760, H = 220, PL = 50, PB = 28, PT = 12, n = tudo.length, teto = Math.max(...tudo.map(x => x.v), 1);
  const px = i => PL + i*(W-PL-12)/(n-1), py = v => PT + (1 - v/teto)*(H-PT-PB);
  let g = "";
  for (let i = 0; i <= 3; i++){ const v = teto*i/3, y = py(v);
    g += `<line class="lin-g" x1="${PL}" y1="${y.toFixed(1)}" x2="${W-12}" y2="${y.toFixed(1)}"/>
      <text x="${PL-9}" y="${(y+4).toFixed(1)}" text-anchor="end">${i ? "R$ " + curto(v) : "0"}</text>`; }
  const linha = "M" + tudo.map((x,i) => `${px(i).toFixed(1)},${py(x.v).toFixed(1)}`).join(" L");
  let e = "", a = ""; const passo = Math.max(1, Math.ceil(n/8)), larg = (W-PL-12)/(n-1);
  tudo.forEach((x,i) => {
    if (!(i % passo)) e += `<text x="${px(i).toFixed(1)}" y="${H-8}" text-anchor="middle">${dm(x.d)}</text>`;
    a += `<rect class="alvo" data-i="${i}" x="${(px(i)-larg/2).toFixed(1)}" y="${PT}" width="${Math.max(larg,4).toFixed(1)}"
      height="${H-PT-PB}" fill="transparent"/>`;
    e += pontoMarco(px(i), H-PB, x.d);
  });
  tudo.forEach(x => x.y = py(x.v));
  window._histDias = tudo;
  return caixaGrafico("ghdia", `<defs><linearGradient id="grd-hd" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--ac)" stop-opacity=".25"/><stop offset="100%" stop-color="var(--ac)" stop-opacity="0"/></linearGradient></defs>
    ${g}<path class="area" d="${linha} L${px(n-1).toFixed(1)},${py(0).toFixed(1)} L${PL},${py(0).toFixed(1)} Z" fill="url(#grd-hd)"/>
    <path class="traco" d="${linha}" stroke="var(--ac)" stroke-width="2" style="--len:2400"/>${e}${a}`, {w:W, h:H, max:240});
}
function ligarHistorico(){
  if (window._histMesesV && $("#ghmesv")) ligarDica("ghmesv", i => {
    const k = window._histMesesV.ks[i], m = window._histMesesV.meses[k];
    return `<b>${nomeMes(k, true)}</b><br>sua parte <b>R$ ${nf(m.liquido)}</b> · ${nf(m.pedidos)} pedidos<br>`
      + `<span class="l">reembolsado R$ ${nf(m.reemb_liquido)} (${pctReemb(m).toFixed(0)}%)</span>` + resumoDoMes(k);
  }, {faixa:true});
  if (window._histHoras && $("#ghhora")) ligarDica("ghhora", i => {
    const c = window._histHoras[i];
    return `<b>${String(c.h).padStart(2,"0")}h</b><br>${nf(c.val)} pedido${c.val===1?"":"s"}`;
  }, {faixa:true});
  if (window._histMeses && $("#ghmes")) ligarDica("ghmes", i => {
    const k = window._histMeses.ks[i], m = window._histMeses.meses[k];
    return `<b>${nomeMes(k, true)}</b><br>entrou <b>R$ ${nf(m.entrou)}</b><br>`
      + `<span class="l">voltou R$ ${nf(-m.reembolsos)} · líquido R$ ${nf(m.liquido)}</span>` + resumoDoMes(k);
  }, {faixa:true});
  if (window._histDias && $("#ghdia")) ligarDica("ghdia", i => {
    const x = window._histDias[i];
    return resumoDoDia(x.d, {topo: `<div class="dd-t">No gráfico</div>` + (x.v ? `<b>R$ ${nf(x.v)}</b>` : '<span class="l">sem entrada</span>')
      + (x.s ? ` <span class="l">· saiu R$ ${nf(-x.s)}</span>` : "")});
  }, {pontos: i => [{y: window._histDias[i].y, cor: "var(--ac)"}]});
  ligarFaiscaMeses();
}

/* ════════ 6) AUDIÊNCIA ════════ */
function telaPublico(){
  const L = linhas();
  const r = DADOS.resumo[periodo] || {};
  const g = k => r[k] || 0;
  const dias = (DADOS.janelas[periodo]||{}).dias || 1;

  const kpis = [
    {r:"Views", v:nf(g("views")), s:dias>1 ? nf(g("views")/dias)+" por dia" : "", d:deltaCanal("views"), ic:"publico"},
    {r:"Inscritos", v:sinal(g("subscribersGained")-g("subscribersLost")),
     s:`<span class="pos">+${nf(g("subscribersGained"))}</span> · <span class="neg">−${nf(g("subscribersLost"))}</span>`,
     d:deltaCanal("subscribersGained"), ic:"publico"},
    {r:"Compartilhamentos", v:nf(g("shares")), s:"o que as pessoas mandam pros amigos",
     d:deltaCanal("shares"), ic:"seta"},
    {r:"Horas assistidas", v:nf(g("estimatedMinutesWatched")/60), s:"tempo real de atenção",
     d:deltaCanal("estimatedMinutesWatched"), ic:"relogio"},
  ].map(c => `<div class="cart">
      <div class="cab"><div class="rot">${c.r}</div><span class="selo">${ico(c.ic)}</span></div>
      <div class="val num">${c.v}</div>${c.s?`<div class="sub">${c.s}</div>`:""}${pilula(c.d)}</div>`).join("");

  /* de onde vem o público — agregado dos 40 vídeos que mais rodaram */
  const T = DADOS.trafego || {}, FORA = DADOS.titulos_fora || {};
  const somaF = {}, somaB = {}, somaS = {};
  Object.values(T).forEach(t => {
    (t.fontes||[]).forEach(([k,v]) => somaF[k] = (somaF[k]||0)+v);
    (t.busca||[]).forEach(([k,v]) => somaB[k] = (somaB[k]||0)+v);
    (t.sugerem||t.sugeriram||[]).forEach(([k,v]) => somaS[k] = (somaS[k]||0)+v);
  });
  const tot = k => Object.values(k).reduce((a,b)=>a+b,0);
  const topN = (o, n, nome) => Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,n)
    .map(([k,v]) => ({rot:nome?nome(k):k, val:v, cor:"var(--ac)", txt:nf(v),
                      pc: tot(o) ? Math.round(v/tot(o)*100) : 0}));

  const maisVistos = L.slice().sort((a,b)=>b.views-a.views).slice(0,8)
    .map(v => ({id:v.id, m:v.m, val:nf(v.views), sub:"views",
      mt:`${v.avg_pct.toFixed(0)}% assistido · ${v.ins_1k.toFixed(1)} insc/1k`}));
  const maisInsc = L.slice().sort((a,b)=>b.ins_1k-a.ins_1k).filter(v=>v.views>=800).slice(0,8)
    .map(v => ({id:v.id, m:v.m, val:v.ins_1k.toFixed(1), sub:"insc/1k",
      mt:`${nf(v.views)} views · ${sinal(v.inscritos)} inscritos`}));

  return avisos() + `<div class="grade g-4 casc">${kpis}</div>`
    + `<div class="grade g-2 casc">`
      + bloco("Mais vistos", "no período escolhido", listaVideos(maisVistos))
      + bloco("Melhor conversão em inscrito", "inscritos a cada 1.000 views — separa viralizar de converter",
          listaVideos(maisInsc))
    + `</div>`
    + `<div class="grade g-3 casc">`
      + bloco("De onde vem o público", "dos 40 vídeos que mais rodaram em 90 dias",
          barrasLado(topN(somaF, 7, nomeFonte)))
      + bloco("O que pesquisaram", "termo digitado na busca do YouTube",
          barrasLado(topN(somaB, 7), {vazio:"O YouTube não devolveu termo de busca neste recorte."}))
      + bloco("Quem sugeriu os seus", "vídeos de outros canais que levaram gente pra você",
          barrasLado(topN(somaS, 7, k => tituloDe(k).t || k), {vazio:"Sem sugestão registrada."}))
    + `</div>` + blocoCtaRetencao();
}
/* o CTA contra a retenção, vídeo a vídeo (22/09/2026): quanto do público ainda estava lá
   quando você falou do link — e quanto isso virou venda */
function blocoCtaRetencao(){
  if (typeof CTA === "undefined") return "";
  const V = DADOS.videos || {};
  const L = Object.keys(CTA).filter(id => V[id] && (DADOS.retencao || {})[id]).map(id => {
    const K = ctasDo(id, V[id].dur_s); if (!K.length) return null;
    const ult = K[K.length - 1], pri = K[0];
    const d = vendasDo(id), vr = viewsRastreadas(id);
    return {id, m: V[id], n: K.length, pri, ult, v1k: (d && vr) ? parte(d.receita) / vr * 1000 : null};
  }).filter(Boolean).sort((a, b) => (b.pri.ret || 0) - (a.pri.ret || 0));
  if (!L.length) return "";
  return `<div class="grade casc">` + bloco("Quanta gente ainda está lá quando você fala do link",
    "os 20 vídeos com curva de retenção · CTA de venda achado na transcrição (oferta → “link no comentário fixado / na descrição”) · clique pra abrir a curva",
    listaVideos(L.map(x => ({id: x.id, m: x.m,
      val: x.pri.ret != null ? Math.round(x.pri.ret * 100) + "%" : "–", sub: "ainda assistindo no link",
      mt: `${x.n} CTA${x.n === 1 ? "" : "s"} · 1º pitch ${hms(x.pri.i)} → link ${hms(x.pri.s)}` + (x.n > 1 ? ` · último link ${hms(x.ult.s)}` : "")
        + (x.v1k ? ` · R$ ${brl(x.v1k)} seus por mil views` : "")}))))
    + `</div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   PRÓXIMO VÍDEO · RADAR · STUDIO · RECEITA TOTAL · MARCOS (22/09/2026)
   Pedido dele: "quero 3 próximos vídeos, não 1 — eu escolho o que for mais fácil de
   gravar no clima do canal". E: "o sistema tem que se auto-alimentar, não só com os
   meus dados — os vídeos que o YouTube sugere e que mandam público pra mim viram dica".
   Os temas e formatos vêm de dados/temas.js (editável). Nada aqui inventa número:
   título sugerido leva [colchete] onde entra o valor real dele.
   ══════════════════════════════════════════════════════════════════════════ */
const TEMAS_ = (typeof TEMAS !== "undefined") ? TEMAS : [];
const FORMATOS_ = (typeof FORMATOS !== "undefined") ? FORMATOS : [];
const TEMA_OUTRO = {k:"outro", rot:"Outros assuntos", angulos:[], gravacao:"", oferta:false};
const normT = s => " " + semAcento(s).replace(/[^a-z0-9]+/g, " ").trim() + " ";
const _temaCache = new Map();
function temaDoTexto(txt){
  if (_temaCache.has(txt)) return _temaCache.get(txt);
  const t = normT(txt);
  const T = TEMAS_.find(T => (T.regra || []).every(g => g.some(p => t.includes(p)))) || TEMA_OUTRO;
  _temaCache.set(txt, T);
  return T;
}
/* 23/09/2026 — filtro de nicho (dados/fora-do-nicho.js): futebol, entretenimento e investimento nunca aparecem */
const FN_ = (typeof FORA_DO_NICHO !== "undefined") ? FORA_DO_NICHO : {canais:[], temas:["outro"], palavras:[]};
const _fnCanais = new Set((FN_.canais || []).map(c => semAcento(String(c)).trim()));
function doNicho(titulo, canal){
  const t = semAcento(titulo || "");
  const k = temaDoTexto(titulo || "").k, tt = " " + t + " ";
  if ((FN_.temas || []).includes(k)) return false;
  if (k === "outro" && !(FN_.nicho || []).some(p => tt.includes(semAcento(p)) || tt.includes(p))) return false;
  if ((FN_.palavras || []).some(p => t.includes(semAcento(p)))) return false;
  if (canal && _fnCanais.has(semAcento(String(canal)).trim())) return false;
  return true;
}
const temaDoVideo = id => temaDoTexto(((DADOS.videos || {})[id] || {}).titulo || "");
function formatosDoTexto(txt){
  const t = semAcento(txt);
  return FORMATOS_.filter(f => { try { return new RegExp(f.regex).test(t); } catch(e){ return false; } });
}
const temaPorK = k => TEMAS_.find(T => T.k === k) || TEMA_OUTRO;

/* ——— Studio: impressões e CTR ——— */
const STUDIO_ = (typeof STUDIO !== "undefined") ? STUDIO : null;
function janStudio(){ return ({"60":"90","90":"90","365":"365"})[periodo] || "28"; }
function studioDo(id, jan){
  const J = STUDIO_ && STUDIO_.janelas && STUDIO_.janelas[jan || janStudio()];
  return J && J.videos ? J.videos[id] || null : null;
}

/* ——— receita total do vídeo no período: sua parte das vendas + AdSense em R$ ——— */
let _vendPer = null, _vendPerDe = null;
function vendasPeriodoPorVideo(){
  const chave = periodo + "|" + (typeof dadosVendas === "function" ? (dadosVendas() || {}).total : 0);
  if (_vendPer && _vendPerDe === chave) return _vendPer;
  const P = {};
  comprasDoPeriodo().forEach(c => { if (!c.vid) return;
    (P[c.vid] = P[c.vid] || {n:0, r:0}); P[c.vid].n++; P[c.vid].r += +c.valor || 0; });
  _vendPer = P; _vendPerDe = chave;
  return P;
}
function rendeuDo(v){
  const fx = taxaDaJanela(periodo) || 0;
  const ads = v.adsense == null ? 0 : v.adsense * (MOEDA() === "USD" ? fx : 1);
  const ve = parte((vendasPeriodoPorVideo()[v.id] || {}).r || 0);
  return {ads, ve, tot: ads + ve};
}
Object.assign(COL, {
  imp:    {r:"Impressões", fmt:v => { const s = studioDo(v.id); return s ? nf(s[0]) : '<span class="nd">–</span>'; },
           get:v => { const s = studioDo(v.id); return s ? s[0] : -1; },
           aj:"quantas vezes a capa apareceu pra alguém (Studio) — só os 50 vídeos com mais impressões na janela"},
  ctr:    {r:"CTR capa",   fmt:v => { const s = studioDo(v.id); if (!s) return '<span class="nd">–</span>';
             const m = (STUDIO_.janelas[janStudio()].total || [])[1];
             return `<span class="${m && s[1] >= m*1.25 ? "pos" : m && s[1] <= m*0.75 ? "neg" : ""}">${s[1].toLocaleString("pt-BR")}%</span>`; },
           get:v => { const s = studioDo(v.id); return s ? s[1] : -1; },
           aj:"de cada 100 pessoas que viram a capa, quantas clicaram (Studio). Verde = 25% acima da média do canal, vermelho = 25% abaixo"},
  rendeu: {r:"Rendeu",     fmt:v => { const x = rendeuDo(v); return x.tot ? "R$ " + nf(x.tot) + `<span class="conv">vendas R$ ${nf(x.ve)} · AdSense R$ ${nf(x.ads)}</span>` : '<span class="nd">–</span>'; },
           get:v => rendeuDo(v).tot,
           aj:"quanto o vídeo te rendeu no período: SUA PARTE das vendas atribuídas a ele + o AdSense em reais"},
  rend_1k:{r:"R$/1k",      fmt:v => { const x = rendeuDo(v); return (x.tot && v.views) ? "R$ " + brl(x.tot / v.views * 1000) : '<span class="nd">–</span>'; },
           get:v => { const x = rendeuDo(v); return v.views ? x.tot / v.views * 1000 : -1; },
           aj:"o que cada 1.000 views desse vídeo virou em dinheiro pra você (venda + AdSense)"},
  tema:   {r:"Tema",       fmt:v => `<span class="tema-chip">${esc(temaDoVideo(v.id).rot)}</span>`,
           get:v => TEMAS_.indexOf(temaDoVideo(v.id)), aj:"assunto do vídeo, pelo título (dados/temas.js)"},
});
MODOS.principal = ["views","rendeu","ctr","ritmo","avg_pct","vendas","venda_1k","ins_1k"];
MODOS.tudo = ["views","rendeu","rend_1k","imp","ctr","ritmo","avg_pct","vendas","venda_1k","adsense","rpm","ins_1k","inscritos","avg_watch_s","watch_h","comentarios","shares","likes","eng_1k","tema"];

/* ——— cliques na página de vendas (22/09/2026) ———
   O recebedor (v4) conta quem chega na página pelo link de cada vídeo e devolve em
   VENDAS_LIVE.cliques = {marca: {dia: n}}. Enquanto o contador não estiver na página,
   tudo aqui fica "–" (não é zero: é "ainda não mede"). */
const temCliques = () => !!(VENDAS_LIVE && VENDAS_LIVE.cliques);
function cliquesDo(id, ini, fim){
  if (!temCliques()) return null;
  if (ini === undefined){ const j = janelaVendas(); ini = j.ini; fim = j.fim; }
  let n = 0;
  [...new Set([id, marcaDo(id)])].forEach(k => Object.entries(VENDAS_LIVE.cliques[k] || {}).forEach(([d, x]) => {
    if ((!ini || d >= ini) && (!fim || d <= fim)) n += x; }));
  return n;
}
function cliquesDoDia(iso){
  if (!temCliques()) return null;
  return Object.values(VENDAS_LIVE.cliques).reduce((a, m) => a + (m[iso] || 0), 0);
}
Object.assign(COL, {
  cliques: {r:"Cliques", fmt:v => { const c = cliquesDo(v.id); return c == null ? '<span class="nd">–</span>' : nf(c); },
            get:v => { const c = cliquesDo(v.id); return c == null ? -1 : c; },
            aj:"gente que chegou na página de vendas pelo link deste vídeo, no período (uma por visita)"},
  conv:    {r:"Clique→venda", fmt:v => { const c = cliquesDo(v.id), n = (vendasPeriodoPorVideo()[v.id] || {}).n || 0;
              return c ? (n / c * 100).toFixed(1).replace(".", ",") + "%" : '<span class="nd">–</span>'; },
            get:v => { const c = cliquesDo(v.id), n = (vendasPeriodoPorVideo()[v.id] || {}).n || 0; return c ? n / c : -1; },
            aj:"de cada 100 pessoas que clicaram no link deste vídeo, quantas compraram. Baixo aqui = problema na página/oferta; poucos cliques = problema no CTA"},
});
MODOS.tudo.splice(MODOS.tudo.indexOf("vendas"), 0, "cliques", "conv");
function blocoFunil(){
  const passo = (r, v, sub) => `<div class="funil-p"><b class="num">${v}</b><span>${r}</span>${sub ? `<em>${sub}</em>` : ""}</div>`;
  const pct = (a, b, k) => b ? (a / b * (k || 100)).toFixed(k ? 1 : 1).replace(".", ",") : "–";
  const nota = `<div class="sub">Poucos cliques por mil views = o CTA do vídeo não está chamando. Muito clique e pouca venda = o problema é a página ou a oferta.</div>`;
  if (!temCliques()){
    const L = (DADOS.janelas[periodo] || {}).videos || [];
    const vr = L.reduce((a, v) => a + (v.views || 0), 0);
    const ve = comprasDoPeriodo().filter(c => c.vid).length;
    return bloco("O funil do link", "views do YouTube → cliques na página de vendas → vendas atribuídas a vídeo",
      `<div class="funil">${passo("views no YouTube", nf(vr))}<i>→</i>${passo("cliques no link", "–", "o contador ainda não está na página")}<i>→</i>
       ${passo("vendas com vídeo de origem", nf(ve), vr ? pct(ve, vr, 1000) + " a cada mil views" : "")}</div>` + nota);
  }
  /* com contador: tudo medido a partir do primeiro clique registrado, pra régua ser a mesma */
  const dias = Object.values(VENDAS_LIVE.cliques).flatMap(m => Object.keys(m)).sort();
  const j = janelaVendas(), ini = [dias[0], j.ini].filter(Boolean).sort().pop(), fim = j.fim;
  const dentro = d => d >= ini && (!fim || d <= fim);
  const cl = Object.values(VENDAS_LIVE.cliques).reduce((a, m) => a + Object.entries(m).filter(([d]) => dentro(d)).reduce((b, [, x]) => b + x, 0), 0);
  const ve = comprasDoPeriodo().filter(c => c.vid && dentro((c.data || "").slice(0, 10))).length;
  /* views: só os dias que o YouTube já fechou, e os cliques dos MESMOS dias */
  const cd = DADOS.canal_dia || {}, fechados = Object.keys(cd).filter(dentro);
  const vw = fechados.reduce((a, d) => a + cd[d][0], 0);
  const clF = Object.values(VENDAS_LIVE.cliques).reduce((a, m) => a + fechados.reduce((b, d) => b + (m[d] || 0), 0), 0);
  return bloco("O funil do link", `desde ${dt(ini)}, quando o contador de cliques começou`,
    `<div class="funil">${passo("views do canal", fechados.length ? nf(vw) : "–", fechados.length ? `${fechados.length} dia(s) já fechados pelo YouTube` : "o YouTube ainda não fechou esses dias")}<i>→</i>
      ${passo("cliques no link", nf(cl), vw ? pct(clF, vw, 1000) + " a cada mil views" : "")}<i>→</i>
      ${passo("vendas com vídeo de origem", nf(ve), cl ? pct(ve, cl) + "% de quem clicou" : "")}</div>` + nota);
}

/* funil da página do TRÁFEGO PAGO: cliques (contador com t=pago) → vendas do canal pago */
function funilPago(compras){
  const C = VENDAS_LIVE && VENDAS_LIVE.cliques_pago;
  if (!C) return bloco("Cliques na página do tráfego pago", "",
    `<div class="vaz-p">Aparece quando o contador estiver colado na página do tráfego pago (arquivo
     <b>_motor/webhook-vendas/snippet-pagina-PAGO.html</b>) e o recebedor v4 publicado.</div>`);
  const j = janelaVendas(), dentro = d => (!j.ini || d >= j.ini) && (!j.fim || d <= j.fim);
  const porC = Object.entries(C).map(([k, m]) => [k, Object.entries(m).filter(([d]) => dentro(d)).reduce((a, [, x]) => a + x, 0)])
    .filter(x => x[1]).sort((a, b) => b[1] - a[1]);
  const cl = porC.reduce((a, x) => a + x[1], 0), n = compras.length;
  return bloco("Cliques na página do tráfego pago", "por campanha (utm_campaign) · no período",
    `<div class="funil"><div class="funil-p"><b class="num">${nf(cl)}</b><span>cliques na página</span></div><i>→</i>
      <div class="funil-p"><b class="num">${nf(n)}</b><span>vendas do tráfego pago</span>
      <em>${cl ? (n / cl * 100).toFixed(1).replace(".", ",") + "% de quem clicou" : ""}</em></div></div>`
    + barrasLado(porC.slice(0, 8).map(([k, x]) => ({rot: k === "(sem marca)" ? "sem campanha" : k, val: x, cor: "var(--ac)", txt: nf(x) + " cliques"}))));
}

/* ——— marcos ——— */
const MARCOS_ = (typeof MARCOS !== "undefined") ? MARCOS : [];
const marcosDoDia = iso => MARCOS_.filter(m => m.data === iso);
function pontoMarco(x, y, iso){
  const ms = marcosDoDia(iso); if (!ms.length) return "";
  return `<rect class="marco" x="${(x-4).toFixed(1)}" y="${(y-4).toFixed(1)}" width="8" height="8" rx="2" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
}

/* ══════ as contas por tema ══════ */
function statsTemas(){
  const J365 = (DADOS.janelas["365"] || {}).videos || [], J90 = (DADOS.janelas["90"] || {}).videos || [];
  const V = DADOS.videos || {};
  const hoje = DADOS.dado_ate || isoLocal(new Date());
  const menos90 = isoLocal(new Date(new Date(hoje + "T00:00:00").getTime() - 90*86400000));
  const S = {};
  const pega = k => S[k] = S[k] || {k, T: temaPorK(k), n:0, views:0, ins:0, ret:[], vmed:[], ads:0, imp:0, cliques:0,
      views90:0, n90:0, ultimo:"", vids:[], vn:0, vr:0, vrastr:0, nb:0, busca:0, termos:[], radar:0, radarVids:[], vizinhosVd:0, vizinhos:[]};
  J365.forEach(v => {
    const m = V[v.id]; if (!m || m.curto || v.views < 1000) return;
    const x = pega(temaDoVideo(v.id).k);
    x.n++; x.views += v.views; x.ins += v.inscritos || 0; x.ret.push(v.avg_pct); x.vmed.push(v.views);
    x.ads += v.adsense || 0; x.vids.push({...v, m});
    const s = studioDo(v.id, "365"); if (s){ x.imp += s[0]; x.cliques += s[0] * s[1] / 100; }
  });
  J90.forEach(v => { const m = V[v.id]; if (!m || m.curto) return; pega(temaDoVideo(v.id).k).views90 += v.views; });
  Object.entries(V).forEach(([id, m]) => {
    if (m.curto || !m.publicado) return;
    const x = pega(temaDoVideo(id).k);
    if (m.publicado >= menos90) x.n90++;
    if (m.publicado > x.ultimo) x.ultimo = m.publicado;
  });
  /* vendas atribuídas (desde o rastreio) e reembolsos por tema */
  const d = dadosVendas();
  if (d){
    Object.entries(d.por_marca || {}).forEach(([marca, dd]) => {
      const vid = marca === MARCA_HIST ? null : idDaMarca(marca); if (!vid) return;
      const x = pega(temaDoVideo(vid).k);
      (dd.compras || []).forEach(c => { x.vn++; x.vr += +c.valor || 0; });
    });
    (d.movimento || []).forEach(mv => { if (mv.tipo !== "baixa" || !mv.marca || mv.marca === MARCA_HIST) return;
      const vid = idDaMarca(mv.marca); if (vid) pega(temaDoVideo(vid).k).nb++; });
    const jr = janelaRastreada();
    ((jr && jr.videos) || []).forEach(v => { if (V[v.id]) pega(temaDoVideo(v.id).k).vrastr += v.views || 0; });
  }
  /* demanda de fora: o que digitaram na busca do YouTube */
  const B = {};
  Object.values(DADOS.trafego || {}).forEach(t => (t.busca || []).forEach(([q, n]) => B[q] = (B[q] || 0) + n));
  Object.entries(B).forEach(([q, n]) => { const x = pega(temaDoTexto(q).k); x.busca += n; x.termos.push([q, n]); });
  /* radar: vídeos de OUTROS canais que mandam público pra você */
  radarVideos().forEach(r => { const x = pega(r.tema.k); x.radar += r.mandou; x.radarVids.push(r); });
  (DADOS.vizinhos || []).filter(z => doNicho(z.titulo, z.canal)).forEach(z => { const x = pega(temaDoTexto(z.titulo).k); x.vizinhosVd += z.vd || 0; x.vizinhos.push(z); });

  Object.values(S).forEach(x => {
    x.ins1k = x.views ? x.ins / x.views * 1000 : 0;
    x.retMed = mediana(x.ret);
    x.viewsMed = mediana(x.vmed);
    x.ctr = x.imp ? x.cliques / x.imp * 100 : null;
    x.rpm = x.views ? x.ads / x.views * 1000 : 0;
    x.venda1k = x.vrastr && x.vn >= 3 ? parte(x.vr) / x.vrastr * 1000 : null;
    x.reemb = (x.vn + x.nb) >= 5 ? x.nb / (x.vn + x.nb) * 100 : null;
    x.momento = x.views ? (x.views90 / (x.views * 90 / 365)) : 0;
    x.lacuna = (x.busca + x.radar) / (1 + x.n90);
    x.termos.sort((a, b) => b[1] - a[1]);
    x.vids.sort((a, b) => (b.ins_1k * Math.log10(b.views)) - (a.ins_1k * Math.log10(a.views)));
  });
  return S;
}

/* os vídeos de fora do canal que o YouTube usa pra te sugerir */
function radarVideos(){
  const F = DADOS.titulos_fora || {}, V = DADOS.videos || {}, soma = {}, pra = {};
  Object.entries(DADOS.trafego || {}).forEach(([meu, t]) => (t.sugerem || t.sugeriram || []).forEach(([id, n]) => {
    if (V[id] || !F[id]) return;
    soma[id] = (soma[id] || 0) + n; (pra[id] = pra[id] || []).push([meu, n]);
  }));
  const hoje = new Date();
  return Object.entries(soma).map(([id, mandou]) => {
    const f = F[id], idade = f.publicado ? Math.max(1, (hoje - new Date(f.publicado + "T00:00:00")) / 86400000) : null;
    return {id, mandou, titulo: f.titulo, canal: f.canal || "", views: f.views ?? null, publicado: f.publicado || null,
            vd: (f.views != null && idade) ? f.views / idade : null, tema: temaDoTexto(f.titulo),
            pra: pra[id].sort((a, b) => b[1] - a[1])};
  }).filter(r => doNicho(r.titulo, r.canal)).sort((a, b) => b.mandou - a.mandou);
}

/* nota 0..1 pela posição entre os temas (robusta a número estranho) */
function rankear(lista, campo){
  const vals = lista.map(x => x[campo]).filter(v => v != null && isFinite(v));
  const ord = [...vals].sort((a, b) => a - b);
  lista.forEach(x => { const v = x[campo];
    x["r_" + campo] = (v == null || !isFinite(v) || ord.length < 2) ? 0.3 : ord.indexOf(v) / (ord.length - 1); });
}
function melhoresFormatos(){
  const J = (DADOS.janelas["365"] || {}).videos || [], V = DADOS.videos || {};
  const F = {};
  J.forEach(v => { const m = V[v.id]; if (!m || m.curto || v.views < 3000) return;
    const s = studioDo(v.id, "365");
    formatosDoTexto(m.titulo).forEach(f => { const x = F[f.k] = F[f.k] || {f, n:0, views:0, ins:0, imp:0, cl:0};
      x.n++; x.views += v.views; x.ins += v.inscritos || 0; if (s){ x.imp += s[0]; x.cl += s[0]*s[1]/100; } }); });
  return Object.values(F).filter(x => x.n >= 3).map(x => ({...x, ins1k: x.ins / x.views * 1000, ctr: x.imp ? x.cl / x.imp * 100 : null}))
    .sort((a, b) => b.ins1k - a.ins1k);
}

function escolherTres(S){
  const L = Object.values(S).filter(x => x.k !== "outro");
  ["ins1k","viewsMed","ctr","momento","venda1k","busca","radar","lacuna","retMed"].forEach(c => rankear(L.filter(x => x.n >= 2 || c === "busca" || c === "radar" || c === "lacuna"), c));
  const temVenda = L.filter(x => x.venda1k != null).length >= 2;
  L.forEach(x => {
    const base = x.n >= 2 ? 1 : 0.55;           // tema com 1 vídeo só ainda é aposta
    x.p_cresce  = base * (0.45*(x.r_ins1k||0) + 0.25*(x.r_viewsMed||0) + 0.15*(x.r_ctr||0) + 0.15*(x.r_momento||0));
    x.p_vende   = temVenda
      ? base * (0.55*(x.venda1k != null ? x.r_venda1k : 0.15) + 0.2*(x.r_viewsMed||0) + 0.15*(x.r_ctr||0) + 0.1*(x.T.oferta ? 1 : 0))
      : base * (0.45*(x.T.oferta ? 1 : 0) + 0.25*(x.r_viewsMed||0) + 0.15*(x.r_ctr||0) + 0.15*(x.r_retMed||0));
    x.p_descobre = 0.4*(x.r_busca||0) + 0.35*(x.r_radar||0) + 0.25*(x.r_lacuna||0);
  });
  const usados = new Set(), pega = (campo) => {
    const x = L.filter(y => !usados.has(y.k)).sort((a, b) => b[campo] - a[campo])[0];
    if (x) usados.add(x.k); return x;
  };
  return {vende: pega("p_vende"), cresce: pega("p_cresce"), descobre: pega("p_descobre"), temVenda, L};
}

/* ——— o clima do canal: os últimos 7 dias contra os 7 de antes ——— */
function climaDoCanal(){
  const cd = DADOS.canal_dia || {}, ks = Object.keys(cd).sort();
  const soma = (arr, i) => arr.reduce((a, k) => a + (cd[k] ? cd[k][i] : 0), 0);
  const itens = [];
  if (ks.length >= 14){
    const a = ks.slice(-7), b = ks.slice(-14, -7);
    const va = soma(a, 0), vb = soma(b, 0), ia = soma(a, 1) - soma(a, 2), ib = soma(b, 1) - soma(b, 2);
    itens.push({r:"Views (7 dias)", v:nf(va), d: vb ? va/vb : null});
    itens.push({r:"Inscritos (7 dias)", v:sinal(ia), d: ib > 0 ? ia/ib : null});
  } else {
    const r = DADOS.resumo["7"] || {};
    itens.push({r:"Views (7 dias)", v:nf(r.views), d: (deltaCanal("views") || {}).r ?? null});
  }
  const sd = (STUDIO_ && STUDIO_.dias) || {}, sk = Object.keys(sd).sort();
  if (sk.length >= 14){
    const ctr = arr => { let im = 0, cl = 0; arr.forEach(k => { im += sd[k][0]; cl += sd[k][0]*sd[k][1]/100; }); return im ? cl/im*100 : 0; };
    const a = ctr(sk.slice(-7)), b = ctr(sk.slice(-14, -7));
    itens.push({r:"CTR da capa (7 dias)", v:a.toFixed(1).replace(".", ",") + "%", d: b ? a/b : null});
  }
  const d = dadosVendas();
  if (d){
    const hoje = new Date(), cut = n => isoLocal(new Date(hoje.getTime() - n*86400000));
    let a = 0, b = 0;
    Object.values(d.por_marca || {}).forEach(x => (x.compras || []).forEach(c => { const k = (c.data||"").slice(0,10);
      if (k > cut(7)) a += +c.valor || 0; else if (k > cut(14)) b += +c.valor || 0; }));
    itens.push({r:"Vendas, sua parte (7 dias)", v:"R$ " + nf(parte(a)), d: b ? a/b : null});
  }
  return itens;
}

/* ══════ A TELA: PRÓXIMO VÍDEO ══════ */
function telaIdeias(){
  if (!TEMAS_.length) return cart(vazioG("Falta o arquivo de temas.", "dados/temas.js não carregou."));
  const S = statsTemas(), E = escolherTres(S), FM = melhoresFormatos();
  const clima = climaDoCanal().map(c => `<div class="cart"><div class="rot">${c.r}</div>
      <div class="val num" style="font-size:26px">${c.v}</div>${c.d != null ? pilula({r:c.d, base:"7 dias antes"}) : ""}</div>`).join("");

  const cartao = (x, obj, ic, cls, porque) => {
    if (!x) return "";
    const fmt = FM[0];
    const rk = t => { const ks = formatosDoTexto(t).map(g => g.k); const i = FM.findIndex(q => ks.includes(q.f.k)); return i < 0 ? 99 : i; };
    const ang = (x.T.angulos || []).slice().sort((a, b) => rk(a) - rk(b));
    const refs = x.vids.filter(v => v.views >= 3000).slice(0, 2);
    const fora = x.radarVids[0] || null;
    const ev = porque(x).filter(Boolean).map(t => `<li>${t}</li>`).join("");
    return `<section class="cart ideia ${cls}">
      <div class="rot"><span class="selo ${cls === "vende" ? "ac" : cls === "cresce" ? "" : "al"}">${ico(ic)}</span>${obj}</div>
      <h3 class="ideia-t">${esc(x.T.rot)}</h3>
      <div class="ideia-chips">
        ${x.T.gravacao ? `<span class="tema-chip" data-dica="${esc("o que dá trabalho gravar esse assunto: tela = tutorial de tela; câmera = falado; misto = os dois")}">grava: ${x.T.gravacao === "camera" ? "câmera" : x.T.gravacao}</span>` : ""}
        ${x.T.oferta ? `<span class="tema-chip ac" data-dica="leva direto pro que você vende (TikTok Shop / TokFy)">leva pra oferta</span>` : ""}
        ${x.ultimo ? `<span class="tema-chip">último vídeo: ${dt(x.ultimo)}</span>` : ""}
      </div>
      <ul class="ideia-ev">${ev}</ul>
      ${ang.length ? `<div class="ideia-sub">Títulos pra partir (troque os [colchetes] pelo seu número real)</div>
        <ol class="ideia-ang">${ang.slice(0, 3).map(a => `<li>${esc(a)}</li>`).join("")}</ol>` : ""}
      ${refs.length ? `<div class="ideia-sub">Os seus que mais funcionaram nesse assunto</div>` + listaVideos(refs.map(v => ({id:v.id, m:v.m,
          val: v.ins_1k.toFixed(1), sub:"insc/1k", mt:`${nf(v.views)} views · ${v.avg_pct.toFixed(0)}% assistido` +
          (studioDo(v.id, "365") ? ` · CTR ${studioDo(v.id, "365")[1].toLocaleString("pt-BR")}%` : "")}))) : ""}
      ${fora ? `<div class="ideia-sub">De fora do canal, puxando público pra você</div>
        <a class="ideia-fora" href="https://youtu.be/${esc(fora.id)}" target="_blank" rel="noopener">
          <img src="https://i.ytimg.com/vi/${esc(fora.id)}/mqdefault.jpg" alt="" loading="lazy">
          <span><b>${esc(corta(fora.titulo, 80))}</b><span>${esc(fora.canal)} · te mandou ${nf(fora.mandou)} views</span></span></a>` : ""}
    </section>`;
  };
  const f = (n, d) => n == null ? "–" : n.toFixed(d == null ? 1 : d).replace(".", ",");
  const tres = cartao(E.vende, "Pra vender", "vendas", "vende", x => [
      x.venda1k != null ? `<b>R$ ${brl(x.venda1k)}</b> seus a cada mil views rastreadas (${x.vn} venda${x.vn===1?"":"s"})`
        : (E.temVenda ? "Ainda sem venda rastreada suficiente nesse tema" : "Venda por vídeo ainda é recente — aqui pesou o assunto levar pra oferta, o alcance e a capa"),
      `<b>${nf(x.viewsMed)}</b> views no vídeo típico (365 dias, ${x.n} vídeo${x.n===1?"":"s"})`,
      x.ctr != null ? `CTR da capa <b>${f(x.ctr)}%</b>` : "",
      x.reemb != null ? `reembolso <b>${f(x.reemb, 0)}%</b> nesse tema` : ""])
    + cartao(E.cresce, "Pra crescer o canal", "publico", "cresce", x => [
      `<b>${f(x.ins1k)}</b> inscritos a cada mil views (365 dias)`,
      `<b>${nf(x.viewsMed)}</b> views no vídeo típico · retenção ${f(x.retMed, 0)}%`,
      x.ctr != null ? `CTR da capa <b>${f(x.ctr)}%</b>` : "",
      x.momento ? `últimos 90 dias: <b>${x.momento >= 1 ? "▲" : "▼"} ${f(x.momento)}×</b> o ritmo do ano` : ""])
    + cartao(E.descobre, "Pra trazer público novo", "seta", "descobre", x => [
      x.busca ? `<b>${nf(x.busca)}</b> views vindas de busca (“${esc(x.termos.slice(0,2).map(t => t[0]).join("”, “"))}”)` : "",
      x.radar ? `<b>${nf(x.radar)}</b> views que vídeos de OUTROS canais desse tema te mandaram` : "",
      `você publicou <b>${x.n90}</b> vídeo${x.n90===1?"":"s"} disso nos últimos 90 dias`,
      x.vizinhos.length ? `os vizinhos postaram ${x.vizinhos.length} vídeo${x.vizinhos.length===1?"":"s"} disso agora` : ""]);

  /* a tabela dos temas */
  const lin = E.L.filter(x => x.n || x.busca || x.radar).sort((a, b) => Math.max(b.p_vende, b.p_cresce, b.p_descobre) - Math.max(a.p_vende, a.p_cresce, a.p_descobre));
  const cel = (v, dica) => `<td${dica ? ` data-dica="${esc(dica)}"` : ""}>${v}</td>`;
  const tabela = `<div class="tab-caixa casc" style="margin-bottom:16px"><div class="tab-topo"><div><h3>Todos os temas</h3>
      <div class="leg">365 dias · só vídeos longos com mais de mil views · passe o mouse pra ver os termos e os vídeos</div></div></div>
    <div class="rolagem"><table><thead><tr><th class="vid" style="cursor:default">Tema</th>
      <th>Vídeos</th><th>Views típ.</th><th>Insc/1k</th><th>Retenção</th><th>CTR</th><th>Venda/1k</th><th>Reemb.</th>
      <th>Busca</th><th>Radar</th><th>Últimos 90d</th></tr></thead><tbody>${lin.map(x => `<tr style="cursor:default">
      <td class="vid"><b style="font-weight:600">${esc(x.T.rot)}</b></td>
      ${cel(x.n)}${cel(nf(x.viewsMed))}${cel(f(x.ins1k))}${cel(x.retMed ? f(x.retMed,0) + "%" : "–")}
      ${cel(x.ctr != null ? f(x.ctr) + "%" : "–")}${cel(x.venda1k != null ? "R$ " + brl(x.venda1k) : "–")}
      ${cel(x.reemb != null ? f(x.reemb,0) + "%" : "–")}
      ${cel(nf(x.busca), x.termos.slice(0,6).map(t => `${esc(t[0])} · ${nf(t[1])}`).join("<br>"))}
      ${cel(nf(x.radar), x.radarVids.slice(0,4).map(r => `${esc(corta(r.titulo,50))} <span class='l'>${esc(r.canal)}</span>`).join("<br>"))}
      ${cel(x.n90 + " vídeo" + (x.n90===1?"":"s"))}</tr>`).join("")}</tbody></table></div></div>`;

  const formatos = FM.length ? bloco("Os ganchos que mais funcionam no canal", "formato do título · 365 dias · insc/1k e CTR somados de todos os vídeos com esse gancho",
    barrasLado(FM.map(x => ({rot: x.f.rot, val: x.ins1k, cor: "var(--ac)",
      txt: f(x.ins1k) + " insc/1k" + (x.ctr != null ? " · CTR " + f(x.ctr) + "%" : ""),
      dica: `<b>${esc(x.f.rot)}</b><br>${x.n} vídeos · ${nf(x.views)} views<br>${f(x.ins1k)} inscritos a cada mil views` + (x.ctr != null ? `<br>CTR da capa ${f(x.ctr)}%` : "")})))) : "";

  const explica = dobra("Como as 3 opções são escolhidas", `<div class="vaz-p" style="padding:0">
    Cada vídeo ganha um <b>tema</b> pelo título (regras em <i>dados/temas.js</i>, dá pra editar). Por tema o painel soma os
    últimos 365 dias e dá uma nota em três objetivos — e pega o melhor tema de cada um, sem repetir:<br><br>
    <b>Pra vender</b> — venda por mil views rastreadas (quando já tem venda suficiente), assunto que leva pra oferta, alcance e CTR.<br>
    <b>Pra crescer</b> — inscritos por mil views (o que mais pesa), views do vídeo típico, CTR e se o tema está subindo nos últimos 90 dias.<br>
    <b>Pra trazer público novo</b> — o que as pessoas buscam no YouTube e chega em você, o que vídeos de OUTROS canais do tema te mandam
    (o Radar) e o quanto você anda deixando esse assunto de lado.<br><br>
    Os títulos são pontos de partida no seu estilo; os <b>[colchetes]</b> são pra você pôr o seu número real — o painel não inventa valor.
    A cada coleta (a rotina de 6 em 6 horas) as notas mudam sozinhas.</div>`);

  return avisos() + `<div class="grade g-4 casc">${clima}</div>`
    + `<div class="grade g-3 casc ideias">${tres}</div>` + tabela
    + (formatos ? `<div class="grade casc">${formatos}</div>` : "") + explica;
}

/* ══════ A TELA: RADAR ══════ */
function telaRadar(){
  const R = radarVideos();
  if (!R.length) return cart(vazioG("O radar ainda está vazio.", "Ele se enche na próxima coleta do YouTube."));
  const total = R.reduce((a, r) => a + r.mandou, 0);
  /* por canal */
  const C = {};
  R.forEach(r => { const c = C[r.canal] = C[r.canal] || {canal: r.canal, mandou: 0, n: 0, temas: {}};
    c.mandou += r.mandou; c.n++; c.temas[r.tema.rot] = (c.temas[r.tema.rot] || 0) + r.mandou; });
  const canais = Object.values(C).sort((a, b) => b.mandou - a.mandou);
  /* por tema */
  const T = {};
  R.forEach(r => { const t = T[r.tema.k] = T[r.tema.k] || {T: r.tema, mandou: 0, n: 0, canais: new Set()};
    t.mandou += r.mandou; t.n++; t.canais.add(r.canal); });
  const temas = Object.values(T).sort((a, b) => b.mandou - a.mandou);
  /* o quanto cada tema já é seu: vídeos nos últimos 90 dias */
  const V = DADOS.videos || {}, hoje = DADOS.dado_ate || isoLocal(new Date());
  const menos90 = isoLocal(new Date(new Date(hoje + "T00:00:00").getTime() - 90*86400000));
  const meus90 = {};
  Object.entries(V).forEach(([id, m]) => { if (!m.curto && m.publicado >= menos90) { const k = temaDoVideo(id).k; meus90[k] = (meus90[k] || 0) + 1; } });

  /* as dicas escritas */
  const dicas = [];
  temas.slice(0, 3).forEach(t => {
    const c = [...t.canais].slice(0, 2).join(" e ");
    const meu = meus90[t.T.k] || 0;
    dicas.push(`<b>${esc(t.T.rot)}</b>: vídeos de ${esc(c)} te mandaram <b>${nf(t.mandou)}</b> views (${Math.round(t.mandou/total*100)}% do que vem de fora).`
      + (meu <= 1 ? ` Você fez ${meu} vídeo disso em 90 dias — <b>espaço aberto</b>.` : ` Você já fez ${meu} nos últimos 90 dias.`));
  });
  const quentes = (DADOS.vizinhos || []).filter(z => doNicho(z.titulo, z.canal)).filter(z => z.vd).sort((a, b) => b.vd - a.vd);
  if (quentes[0]) dicas.push(`O que mais está rodando agora nos vizinhos: <b>${esc(corta(quentes[0].titulo, 70))}</b> (${esc(quentes[0].canal)}) —
    ${nf(quentes[0].vd)} views por dia. Tema: ${esc(temaDoTexto(quentes[0].titulo).rot)}.`);

  const top = R.slice(0, 12).map(r => `<a class="ideia-fora" href="https://youtu.be/${esc(r.id)}" target="_blank" rel="noopener"
      data-dica="${esc(`<b>${esc(corta(r.titulo, 70))}</b><br>levou gente pra:<br>` + r.pra.slice(0,3).map(([id, n]) => `${esc(corta(tituloDe(id).t, 45))} · ${nf(n)}`).join("<br>"))}">
      <img src="https://i.ytimg.com/vi/${esc(r.id)}/mqdefault.jpg" alt="" loading="lazy">
      <span><b>${esc(corta(r.titulo, 90))}</b><span>${esc(r.canal)} · <span class="tema-chip">${esc(r.tema.rot)}</span>
        ${r.vd != null ? ` · ${nf(r.vd)} views/dia` : ""}</span></span>
      <em>${nf(r.mandou)}</em></a>`).join("");

  const agora = quentes.slice(0, 10).map(z => `<a class="ideia-fora" href="https://youtu.be/${esc(z.id)}" target="_blank" rel="noopener">
      <img src="https://i.ytimg.com/vi/${esc(z.id)}/mqdefault.jpg" alt="" loading="lazy">
      <span><b>${esc(corta(z.titulo, 90))}</b><span>${esc(z.canal)} · ${dt(z.publicado)} · <span class="tema-chip">${esc(temaDoTexto(z.titulo).rot)}</span></span></span>
      <em>${nf(z.vd)}<small>/dia</small></em></a>`).join("");

  return avisos()
    + `<div class="grade casc"><section class="cart"><div class="cab"><div><h3>O que o radar está dizendo</h3>
        <div class="leg">vídeos de outros canais que o YouTube usa pra sugerir os seus — se um tema traz esse público, ele é um público que já te assiste</div></div></div>
        <ul class="ideia-ev" style="font-size:14px">${dicas.map(t => `<li>${t}</li>`).join("")}</ul></section></div>`
    + `<div class="grade g-2 casc">`
      + bloco("Temas que trazem público de fora", "views que vídeos de outros canais te mandaram, por assunto",
          barrasLado(temas.slice(0, 8).map(t => ({rot: t.T.rot, val: t.mandou, cor: "var(--ac)", txt: nf(t.mandou),
            pc: Math.round(t.mandou / total * 100),
            dica: `<b>${esc(t.T.rot)}</b><br>${t.n} vídeos de ${t.canais.size} canais<br>${nf(t.mandou)} views pra você<br>você fez ${meus90[t.T.k] || 0} vídeo(s) disso em 90 dias`}))))
      + bloco("Canais vizinhos", "quem mais te empresta público",
          barrasLado(canais.slice(0, 8).map(c => ({rot: c.canal, val: c.mandou, cor: "var(--t2)", txt: nf(c.mandou),
            pc: Math.round(c.mandou / total * 100),
            dica: `<b>${esc(c.canal)}</b><br>${c.n} vídeo(s) te sugerindo<br>` + Object.entries(c.temas).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t, n]) => `${esc(t)} · ${nf(n)}`).join("<br>")}))))
    + `</div>`
    + `<div class="grade g-2 casc">`
      + bloco("Os vídeos de fora que mais te mandam gente", "número à direita = views que chegaram em você por sugestão", `<div class="lista-fora">${top}</div>`)
      + bloco("Rodando agora nos vizinhos", "vídeos novos desses canais, por views por dia — atualiza a cada coleta",
          agora ? `<div class="lista-fora">${agora}</div>` : `<div class="vaz-p">Aparece depois da próxima coleta do YouTube (o coletor passou a buscar os vídeos novos dos canais vizinhos em 22/09/2026).</div>`)
    + `</div>`;
}

/* ══════ A TELA: CONCORRÊNCIA (22/09/2026) ══════
   Lê dados/concorrencia.js (CONC). Tudo que aparece aqui é conta em cima de número real:
   views do vídeo ÷ mediana do próprio canal, views por dia, tema/gancho pelo título (dados/temas.js). */
const CONC_ = (typeof CONC !== "undefined") ? CONC : null;
function concVideos(){
  if (!CONC_) return [];
  const hoje = new Date((CONC_.atualizado || isoLocal(new Date())) + "T00:00:00");
  const out = [];
  Object.entries(CONC_.canais || {}).forEach(([canal, c]) => {
    const longos = (c.v || []).filter(v => v[4] == null || v[4] > 180);
    const med = mediana(longos.map(v => v[2]).filter(n => n > 0));
    longos.forEach(([id, titulo, views, pub, dur]) => {
      if (!views) return;
      const idade = pub ? Math.max(1, Math.round((hoje - new Date(pub + "T00:00:00")) / 86400000)) : null;
      out.push({id, titulo, views, pub, dur, idade, canal, inscritos: c.inscritos || 0, medCanal: med,
        mult: med ? views / med : null, vd: idade ? views / idade : null,
        tema: temaDoTexto(titulo), forms: formatosDoTexto(titulo)});
    });
  });
  return out;
}
function meusPorTema(dias){
  const V = DADOS.videos || {}, hoje = DADOS.dado_ate || isoLocal(new Date());
  const corte = isoLocal(new Date(new Date(hoje + "T00:00:00").getTime() - dias*86400000));
  const M = {};
  Object.entries(V).forEach(([id, m]) => {
    if (m.curto || !m.publicado || m.publicado < corte) return;
    const k = temaDoTexto(m.titulo || "").k, x = M[k] = M[k] || {n:0, vids:[]};
    x.n++; x.vids.push({id, t: m.titulo, views: (m.vitalicio || {}).views || 0, pub: m.publicado, dur: m.dur_s, forms: formatosDoTexto(m.titulo || "")});
  });
  Object.values(M).forEach(x => { x.vids.sort((a, b) => b.views - a.views); x.med = mediana(x.vids.map(v => v.views)); });
  return M;
}
/* por que deu bom: só fatos medidos, em frases curtas */
function porQueDeuBom(v, meu, usoForm, termosTema){
  const r = [];
  if (v.mult) r.push(v.mult >= 1.5 ? `<b>${v.mult.toFixed(1).replace(".", ",")}×</b> a mediana do ${esc(v.canal)} (${nf(v.medCanal)}) — o assunto/título puxou mais que o normal do canal`
                                   : `${v.mult.toFixed(1).replace(".", ",")}× a mediana do canal`);
  if (v.inscritos && v.views > v.inscritos) r.push(`views = <b>${Math.round(v.views / v.inscritos * 100)}%</b> dos inscritos do canal (${nf(v.inscritos)}) — furou a bolha, foi pra quem não é inscrito`);
  if (meu && meu.vids.length){
    const b = meu.vids[0];
    if (v.views > b.views) r.push(`passou o seu melhor desse tema nos últimos 6 meses (<b>${nf(b.views)}</b>: ${esc(corta(b.t, 50))})`);
    else r.push(`seu melhor desse tema: ${nf(b.views)} — a mediana dos seus é ${nf(meu.med)}`);
  }
  const novos = v.forms.filter(f => !(usoForm[f.k] > 0));
  if (v.forms.length) r.push(`gancho: ${v.forms.map(f => novos.includes(f) ? `<b>${esc(f.rot)}</b> (você não usou em 6 meses)` : esc(f.rot)).join(" + ")}`);
  const par = (v.titulo.match(/\(([^)]{4,60})\)/) || [])[1];
  if (par) r.push(`promessa extra no parêntese: “${esc(par)}”`);
  if (v.dur) r.push(`${Math.round(v.dur / 60)} min` + (meu && meu.vids.length ? ` (os seus desse tema: ~${Math.round(mediana(meu.vids.map(x => x.dur || 0)) / 60)} min)` : ""));
  if (v.tema.k !== "outro" && termosTema && termosTema.length) r.push(`no seu canal já buscaram: ${termosTema.slice(0, 2).map(([q]) => "“" + esc(q) + "”").join(", ")}`);
  return r;
}
function cartaoConc(v, linhas){
  return `<div class="conc-v">
    <a class="ideia-fora" href="https://youtu.be/${esc(v.id)}" target="_blank" rel="noopener">
      <img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" loading="lazy">
      <span><b>${esc(corta(v.titulo, 95))}</b><span>${esc(v.canal)} · ${v.pub ? "há " + v.idade + " dias" : ""} · <span class="tema-chip">${esc(v.tema.rot)}</span></span></span>
      <em>${nf(v.views)}${v.vd ? `<small><br>${nf(Math.round(v.vd))}/dia</small>` : ""}</em></a>
    <ul class="ideia-ev">${linhas.map(l => `<li>${l}</li>`).join("")}</ul></div>`;
}
function telaConcorrencia(){
  const C = concVideos();
  if (!C.length) return cart(vazioG("Sem dados da concorrência ainda.", "O arquivo dados/concorrencia.js aparece na próxima coleta do YouTube."));
  const meu180 = meusPorTema(180);
  const usoForm = {};
  Object.values(meu180).forEach(x => x.vids.forEach(v => v.forms.forEach(f => usoForm[f.k] = (usoForm[f.k] || 0) + 1)));
  const S = statsTemas();
  const termos = k => (S[k] || {}).termos || [];
  const valeu = v => v.mult != null && (v.mult >= 1.5 || (meu180[v.tema.k] && v.views > meu180[v.tema.k].vids[0].views));
  const nota = v => (v.mult || 0) * Math.log10(v.views + 10);
  const recente = v => v.idade == null || v.idade <= 120;

  /* coluna A: temas que você JÁ fez nos últimos 6 meses */
  const A = C.filter(recente).filter(v => meu180[v.tema.k] && v.tema.k !== "outro" && valeu(v)).sort((a, b) => nota(b) - nota(a));
  /* coluna B: temas que você NÃO fez em 6 meses */
  const B = C.filter(recente).filter(v => !meu180[v.tema.k] || v.tema.k === "outro").filter(v => (v.mult || 0) >= 1.2).sort((a, b) => nota(b) - nota(a));
  const umPorCanal = (L, n) => { const vis = {}, out = []; L.forEach(v => { if (out.length < n && (vis[v.canal] || 0) < 2){ vis[v.canal] = (vis[v.canal] || 0) + 1; out.push(v); } }); return out; };
  const colA = umPorCanal(A, 10).map(v => cartaoConc(v, porQueDeuBom(v, meu180[v.tema.k], usoForm, termos(v.tema.k)))).join("");
  const colB = umPorCanal(B, 10).map(v => cartaoConc(v, porQueDeuBom(v, null, usoForm, termos(v.tema.k))
      .concat(v.tema.k === "outro" ? [] : [`você não posta sobre <b>${esc(v.tema.rot)}</b> há mais de 6 meses` + (S[v.tema.k] && S[v.tema.k].ultimo ? ` (último: ${dt(S[v.tema.k].ultimo)})` : " (nunca)")]))).join("");

  /* temas em alta na concorrência */
  const T = {};
  C.filter(v => v.idade != null && v.idade <= 45).forEach(v => { const t = T[v.tema.k] = T[v.tema.k] || {T: v.tema, vd: 0, n: 0, canais: new Set(), mult: []};
    t.vd += v.vd || 0; t.n++; t.canais.add(v.canal); if (v.mult) t.mult.push(v.mult); });
  const temas = Object.values(T).sort((a, b) => b.vd - a.vd);
  /* ganchos que mais puxam */
  const F = {};
  C.forEach(v => v.forms.forEach(f => { const x = F[f.k] = F[f.k] || {f, mult: [], n: 0}; x.n++; if (v.mult) x.mult.push(v.mult); }));
  const ganchos = Object.values(F).filter(x => x.n >= 5).map(x => ({...x, med: mediana(x.mult)})).sort((a, b) => b.med - a.med);
  /* canais */
  const porCanal = {};
  C.forEach(v => { const c = porCanal[v.canal] = porCanal[v.canal] || {canal: v.canal, ins: v.inscritos, med: v.medCanal, v30: 0, top: null, temas: {}};
    if (v.idade != null && v.idade <= 30) c.v30++; if (!c.top || v.mult > c.top.mult) c.top = v; c.temas[v.tema.rot] = (c.temas[v.tema.rot] || 0) + 1; });
  const meuMed = mediana(Object.values(meu180).flatMap(x => x.vids.filter(v => v.pub <= isoLocal(new Date(Date.now() - 14*86400000))).map(v => v.views)));
  const canais = Object.values(porCanal).sort((a, b) => b.med - a.med);
  const tabCanais = `<div class="tab-conc"><table><thead><tr><th>Canal</th><th>Inscritos</th><th>Mediana de views</th><th>Vídeos no último mês</th><th>Assunto principal</th><th>Maior acerto recente</th></tr></thead><tbody>`
    + canais.map(c => `<tr><td><b>${esc(c.canal)}</b></td><td>${nf(c.ins)}</td><td>${nf(c.med)}</td><td>${c.v30}</td>
        <td>${esc(Object.entries(c.temas).sort((a, b) => b[1] - a[1])[0][0])}</td>
        <td><a href="https://youtu.be/${esc(c.top.id)}" target="_blank" rel="noopener">${esc(corta(c.top.titulo, 55))}</a> · ${c.top.mult.toFixed(1).replace(".", ",")}×</td></tr>`).join("")
    + `</tbody></table></div>`
    + (meuMed ? `<div class="sub">Sua mediana (vídeos longos dos últimos 6 meses, com 14+ dias de vida): <b>${nf(meuMed)}</b> views.</div>` : "");

  const quantos = Object.keys(CONC_.canais || {}).length;
  const leg = `${quantos} canais · últimos ~30 vídeos de cada · coletado em ${dt(CONC_.atualizado)}`
    + (CONC_.fonte && /aprox/.test(CONC_.fonte) ? " · idade dos vídeos aproximada (o YouTube mostra “há X dias/meses”)" : "");
  return avisos()
    + `<div class="grade casc"><section class="cart"><div class="cab"><div><h3>Como ler</h3><div class="leg">${leg} · as colunas mostram vídeos de até 4 meses</div></div></div>
        <ul class="ideia-ev" style="font-size:14px">
          <li>“<b>2,5×</b> a mediana” = o vídeo fez 2,5 vezes o que aquele canal costuma fazer. É o melhor sinal de que o <b>assunto ou o título</b> puxou, e não o tamanho do canal.</li>
          <li>Coluna da esquerda: temas que você <b>já gravou</b> nos últimos 6 meses — veja o que o concorrente fez diferente (gancho, promessa, duração).</li>
          <li>Coluna da direita: temas que você <b>não gravou</b> em 6 meses e que estão rendendo acima do normal lá — candidatos pra testar.</li>
        </ul></section></div>`
    + `<div class="grade g-2 casc">`
      + bloco("Temas que você já fez — e o concorrente fez melhor", "por que o vídeo dele deu bom",
          colA ? `<div class="conc-lista">${colA}</div>` : `<div class="vaz-p">Nenhum vídeo da concorrência passou do normal nos seus temas agora.</div>`)
      + bloco("Temas que você não fez em 6 meses — pra testar", "rendendo acima do normal nos canais deles",
          colB ? `<div class="conc-lista">${colB}</div>` : `<div class="vaz-p">Nada fora dos seus temas está acima do normal agora.</div>`)
    + `</div>`
    + `<div class="grade g-2 casc">`
      + bloco("Temas em alta na concorrência", "soma de views por dia dos vídeos dos últimos 45 dias",
          barrasLado(temas.slice(0, 8).map(t => ({rot: t.T.rot, val: t.vd, cor: meu180[t.T.k] ? "var(--t2)" : "var(--ac)", txt: nf(Math.round(t.vd)) + "/dia",
            dica: `<b>${esc(t.T.rot)}</b><br>${t.n} vídeos de ${t.canais.size} canais<br>mediana ${mediana(t.mult).toFixed(1).replace(".", ",")}× o normal do canal<br>você: ${meu180[t.T.k] ? meu180[t.T.k].n + " vídeo(s) em 6 meses" : "nenhum vídeo em 6 meses"}`})))
          + `<div class="sub">Barra colorida = tema que você não gravou em 6 meses.</div>`)
      + bloco("Ganchos de título que mais puxam", "mediana de “× o normal do canal” dos vídeos que usam cada gancho",
          barrasLado(ganchos.slice(0, 8).map(g => ({rot: g.f.rot, val: g.med, cor: usoForm[g.f.k] ? "var(--t2)" : "var(--ac)", txt: g.med.toFixed(2).replace(".", ",") + "×",
            dica: `<b>${esc(g.f.rot)}</b><br>${g.n} vídeos da concorrência usam<br>você usou em ${usoForm[g.f.k] || 0} vídeo(s) nos últimos 6 meses`})))
          + `<div class="sub">Barra colorida = gancho que você não usou em 6 meses.</div>`)
    + `</div>`
    + `<div class="grade casc">${bloco("Os canais", "quem são, o tamanho e o ritmo de cada um", tabCanais)}</div>`;
}


/* ════════ 7) VÍDEOS (a tabela) ════════ */
function telaVideos(){
  const L = linhas();
  const cols = MODOS[modo];
  if (!L.length) return avisos() + cart(vazioG("Nenhum vídeo com dado nesse filtro.",
    "Troque o período, ou limpe o filtro de título."));

  const vals = L.map(v => COL[ordem].get(v));
  const max = Math.max(...vals.map(Math.abs), 1);
  const med = mediana(vals.filter(x => x > 0));
  const vis = L.slice(0, limite);

  const cab = `<th class="mini">#</th><th class="mini" title="o link de venda deste vídeo">Link</th>
    <th class="vid">Vídeo</th>` + cols.map(k =>
    `<th data-c="${k}" class="${k===ordem?"on":""}"${COL[k].aj?` title="${esc(COL[k].aj)}"`:""}>
      ${COL[k].r}<span class="seta">↓</span></th>`).join("");

  const corpo = vis.map((v,i) => {
    const cels = cols.map(k => {
      const txt = COL[k].fmt(v);
      const val = COL[k].get(v);
      if (k !== ordem) return `<td>${txt}</td>`;
      const pct = Math.max(0, Math.min(100, Math.abs(val)/max*100));
      const mp  = Math.max(0, Math.min(100, med/max*100));
      return `<td><span class="barra-cel">${txt}
        <span class="tr"></span>
        <span class="pr" style="width:${pct.toFixed(1)}%;animation-delay:${(i*.015).toFixed(2)}s"></span>
        <span class="md" style="left:${mp.toFixed(1)}%"></span></span></td>`;
    }).join("");
    const u = linkDo(v.id);
    return `<tr data-vid="${esc(v.id)}">
      <td class="mini nd">${i+1}</td>
      <td class="mini">${u ? `<a class="lk" href="${esc(u)}" target="_blank" rel="noopener"
        title="abrir o link de venda deste vídeo" onclick="event.stopPropagation()">${ico("seta")}</a>`
        : '<span class="nd" title="este vídeo ainda não tem link de venda próprio">–</span>'}</td>
      <td class="vid"><div class="vcel">
        <img src="${esc(v.m.thumb)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div><div class="t">${esc(v.m.titulo)}</div>
        <div class="d">${dt(v.m.publicado)} · ${hms(v.m.dur_s)}</div></div>
      </div></td>${cels}</tr>`;
  }).join("");

  return avisos() + `<div class="tab-caixa casc" style="animation:sobe var(--lento) backwards">
    <div class="tab-topo">
      <div><h3>${nf(L.length)} vídeo${L.length===1?"":"s"} com dado ${frasePeriodo()}</h3>
        <div class="leg">a barrinha embaixo do número compara com o maior da lista;
          o risquinho é a mediana do canal</div></div>
      ${segmentoMini("modos", [["principal","Essenciais"],["tudo","Todas"]], modo)}
    </div>
    <div class="rolagem"><table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table></div>
    ${L.length > limite ? `<button class="mais" id="btMais">mostrar mais
      ${Math.min(60, L.length-limite)} (de ${nf(L.length)})</button>` : ""}
  </div>`;
}


/* ══════════════════════════════════════════════════════════════════════════
   O MODAL DO VÍDEO — a ficha completa, com a curva de retenção clicável
   ══════════════════════════════════════════════════════════════════════════ */
const RW=700, RH=210, RPL=44, RPR=16, RPT=16, RPB=30;

function palcoThumb(id){
  const m = (DADOS.videos||{})[id] || {};
  return `<img src="${esc(m.thumb || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`)}" alt="">
    <button class="play" title="tocar"><i></i></button>`;
}

function abrir(id){
  const v = (linhas().find(x => x.id === id)) ||
            {id, m:(DADOS.videos||{})[id], views:0, inscritos:0, ins_1k:0, avg_pct:0,
             avg_watch_s:0, watch_h:0, comentarios:0, shares:0, likes:0, eng_1k:0, adsense:null};
  const m = v.m; if (!m) return;
  videoAberto = id;
  const d = semSaber(id), u = linkDo(id), rit = ritmoDo(id);

  const nums = [
    ["Views", nf(v.views), comparativo(v.views, "views")],
    ["Inscritos", sinal(v.inscritos), comparativo(v.inscritos, "inscritos")],
    ["Insc/1k", v.ins_1k.toFixed(1), comparativo(v.ins_1k, "ins_1k")],
    ["% assistido", v.avg_pct.toFixed(1)+"%", comparativo(v.avg_pct, "avg_pct")],
    ["Tempo médio", hms(v.avg_watch_s), comparativo(v.avg_watch_s, "avg_watch_s")],
    ["Horas", nf(v.watch_h), comparativo(v.watch_h, "watch_h")],
    ["Comentários", nf(v.comentarios), comparativo(v.comentarios, "comentarios")],
    ["Compart.", nf(v.shares), comparativo(v.shares, "shares")],
    ["Vendas", d === null ? '<span class="nd">–</span>' : nf(d.n),
      d && d.n ? `<em class="acima">R$ ${nf(parte(d.receita))} seus</em>` : ""],
    ["AdSense", v.adsense == null ? '<span class="nd">–</span>' : din(v.adsense), ""],
    ["RPM", (v.adsense == null || !v.views) ? '<span class="nd">–</span>' : din(v.adsense/v.views*1000), ""],
    ["Rendeu", (() => { const x = rendeuDo(v); return x.tot ? "R$ " + nf(x.tot) : '<span class="nd">–</span>'; })(),
      (() => { const x = rendeuDo(v); return x.tot ? `<em>vendas R$ ${nf(x.ve)} · AdSense R$ ${nf(x.ads)}</em>` : ""; })()],
    ["Impressões", studioDo(id) ? nf(studioDo(id)[0]) : '<span class="nd">–</span>', ""],
    ["CTR capa", studioDo(id) ? studioDo(id)[1].toLocaleString("pt-BR") + "%" : '<span class="nd">–</span>',
      studioDo(id) && STUDIO_.janelas[janStudio()].total ? `<em>canal ${String(STUDIO_.janelas[janStudio()].total[1]).replace(".", ",")}%</em>` : ""],
    ["Cliques", cliquesDo(id) == null ? '<span class="nd">–</span>' : nf(cliquesDo(id)), ""],
    ["Tema", `<span style="font-size:13px">${esc(temaDoVideo(id).rot)}</span>`, ""],
  ].map(([r, val, cmp]) => `<div${r === "Tema" ? ' style="grid-column:span 4"' : ""}><b class="num">${val}</b><span>${r}</span>${cmp||""}</div>`).join("");

  $("#folhaVideo").innerHTML = `
    <div class="palco" id="palco">${palcoThumb(id)}</div>
    <button class="fecha" onclick="modalVideo.close()" title="fechar (Esc)">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="mcab">
      <h3>${esc(m.titulo)}</h3>
      <div class="mt">
        <span>${dt(m.publicado)}</span><span>${hms(m.dur_s)}</span>
        ${rit ? `<span class="ritmo ${rit.cls}" title="${esc(rit.dica)}">${rit.txt}</span>` : ""}
        <a href="https://youtu.be/${esc(id)}" target="_blank" rel="noopener">abrir no YouTube</a>
        ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">link de venda</a>
               <a href="#" onclick="event.preventDefault();copiar('${esc(u)}',this)">copiar</a>` : ""}
        ${d && d.n ? `<a href="#" onclick="event.preventDefault();abrirVendas('${esc(id)}')">ver as ${d.n} compra${d.n===1?"":"s"}</a>` : ""}
      </div>
    </div>
    <div class="mnums">${nums}</div>
    <div class="mcorpo">
      <div class="retn">▲▼ quantas vezes a mediana dos seus vídeos no período — passe o mouse pra ver o valor</div>
      ${curvaRet(id, m.dur_s)}
      ${blocoTraf(id)}
    </div>`;
  modalVideo.showModal();
  const p = $("#palco .play");
  if (p) p.onclick = () => tocar(id, 0);
  ligarCurva(id, m.dur_s);
}

/* curva de retenção: este vídeo contra a média do canal */
/* a curva vem do coletor como {x:[...], y:[...]}; o desenho usa pares [x, y].
   Até 22/09/2026 o painel lia como se já fossem pares — a curva nunca aparecia. */
const pares = o => Array.isArray(o) ? o
  : (o && o.x ? o.x.map((x, i) => [x, o.y[i]]).filter(p => typeof p[1] === "number") : null);
/* retenção num ponto qualquer (0..1), interpolando */
function retEm(arr, r){
  if (!arr || !arr.length) return null;
  if (r <= arr[0][0]) return arr[0][1];
  for (let i = 1; i < arr.length; i++) if (arr[i][0] >= r){
    const a = arr[i-1], b = arr[i], t = (r - a[0]) / ((b[0] - a[0]) || 1);
    return a[1] + (b[1] - a[1]) * t;
  }
  return arr[arr.length-1][1];
}
/* as menções de link/oferta do vídeo (dados/youtube/cta.js), com a retenção naquele ponto */
function ctasDo(id, dur){
  const L = (typeof CTA !== "undefined" && CTA[id]) || [];
  const c = pares((DADOS.retencao||{})[id]), cn = pares(curvaCanal());
  /* formato novo (22/09, 2ª versão): [início do pitch, momento do link, trecho]. O antigo era [s, trecho]. */
  return L.map(x => x.length >= 3 ? x : [x[0], x[0], x[1]])
    .filter(([i, s]) => dur && s < dur).map(([i, s, txt]) => ({i, s, txt, r: s / dur, ri: i / dur,
      ret: retEm(c, s / dur), reti: retEm(c, i / dur), canal: retEm(cn, s / dur)}));
}
function curvaRet(id, dur){
  const c = pares((DADOS.retencao||{})[id]);
  if (!c || !c.length) return `<div class="vaz-p">A curva de retenção só é baixada dos 20 vídeos que mais
    rodaram nos últimos 90 dias — este não está entre eles.</div>`;
  const canal = pares(curvaCanal());
  const px = r => RPL + r * (RW-RPL-RPR);
  const py = v => RPT + (1 - Math.min(v,1.2)/1.2) * (RH-RPT-RPB);
  let grade = "";
  [0, .25, .5, .75, 1].forEach(p => {
    const y = py(p);
    grade += `<line class="lin-g" x1="${RPL}" y1="${y.toFixed(1)}" x2="${RW-RPR}" y2="${y.toFixed(1)}"/>
      <text x="${RPL-9}" y="${(y+4).toFixed(1)}" text-anchor="end">${Math.round(p*100)}%</text>`;
  });
  let eixo = "";
  [0,.25,.5,.75,1].forEach(p => {
    eixo += `<text x="${px(p).toFixed(1)}" y="${RH-8}" text-anchor="middle">${hms(p*(dur||0))}</text>`;
  });
  const cam = arr => "M" + arr.map(pt => `${px(pt[0]).toFixed(1)} ${py(pt[1]).toFixed(1)}`).join(" L");
  const linhaCanal = canal && canal.length
    ? `<path d="${cam(canal)}" fill="none" stroke="var(--t3)" stroke-width="1.8" stroke-dasharray="5 4"/>` : "";
  const d = cam(c);
  const area = d + ` L${px(c[c.length-1][0]).toFixed(1)} ${py(0).toFixed(1)} L${px(c[0][0]).toFixed(1)} ${py(0).toFixed(1)} Z`;
  return `<div class="msec"><h4>Retenção de público</h4>
    <div class="serie"><span><i style="background:var(--ac)"></i>este vídeo</span>
      ${canal&&canal.length?`<span><i style="background:var(--t3)"></i>média do canal</span>`:""}</div>
    <div class="retn">clique em qualquer ponto da curva pra pular o vídeo pra aquele momento</div>
    <div class="svgb" id="ret-box">
      <svg viewBox="0 0 ${RW} ${RH}" class="gsvg" id="svgret" style="cursor:crosshair;max-height:230px">
        <defs><linearGradient id="grdret" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--ac)" stop-opacity=".22"/>
          <stop offset="100%" stop-color="var(--ac)" stop-opacity="0"/></linearGradient></defs>
        ${grade}
        <path class="area" d="${area}" fill="url(#grdret)"/>
        ${linhaCanal}
        <path class="traco" d="${d}" stroke="var(--ac)" stroke-width="2.6" style="--len:1400"/>
        ${ctasDo(id, dur).map(k => k.i < k.s ? `<rect x="${px(k.ri).toFixed(1)}" y="${RPT}" width="${(px(k.r)-px(k.ri)).toFixed(1)}" height="${RH-RPT-RPB}"
          fill="var(--alerta)" opacity=".10"/>` : "").join("")}
        ${ctasDo(id, dur).map((k, i) => `<line x1="${px(k.r).toFixed(1)}" y1="${RPT}" x2="${px(k.r).toFixed(1)}" y2="${RH-RPB}"
          stroke="var(--alerta)" stroke-width="1.4" stroke-dasharray="3 3"/>
          <text x="${(px(k.r)+3).toFixed(1)}" y="${RPT+10}" style="fill:var(--alerta);font-weight:700">${i+1}</text>`).join("")}
        <line id="retlinha" x1="0" y1="${RPT}" x2="0" y2="${RH-RPB}" stroke="var(--t3)" stroke-width="1" opacity="0"/>
        ${eixo}
        <rect id="rethit" x="${RPL}" y="${RPT}" width="${RW-RPL-RPR}" height="${RH-RPT-RPB}" fill="transparent"/>
      </svg><div class="dica" id="retdica"></div></div>
    ${(() => { const K = ctasDo(id, dur); if (!K.length) return "";
      return `<div class="cta-lista"><div class="ideia-sub" style="margin-top:12px">CTA de venda — faixa laranja = o pitch (da oferta até o link), linha = quando você diz onde está o link</div>`
        + K.map((k, i) => `<div class="cta-l" onclick="tocar('${esc(id)}', ${k.s})" title="tocar desse ponto">
            <b>${i+1}</b><span class="t">${k.i < k.s ? hms(k.i) + " → " : ""}${hms(k.s)}</span>
            <span class="f">“${esc(k.txt)}”</span>
            <span class="p">${k.reti != null && k.i < k.s ? Math.round(k.reti*100) + "% → " : ""}${k.ret != null ? Math.round(k.ret*100) + "% no link" : ""}${k.canal != null ? ` <em>canal ${Math.round(k.canal*100)}%</em>` : ""}</span></div>`).join("")
        + `</div>`; })()}</div>`;
}
function ligarCurva(id, dur){
  const c = pares((DADOS.retencao||{})[id]); if (!c || !c.length) return;
  const svg = $("#svgret"), hit = $("#rethit"), dica = $("#retdica"),
        box = $("#ret-box"), linha = $("#retlinha");
  if (!svg || !hit) return;
  const canal = pares(curvaCanal());
  const razao = ev => {
    const r = svg.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * RW;
    return Math.max(0, Math.min(1, (x - RPL) / (RW - RPL - RPR)));
  };
  const perto = (arr, p) => arr.reduce((a,b) => Math.abs(b[0]-p) < Math.abs(a[0]-p) ? b : a, arr[0]);
  hit.onmousemove = ev => {
    const p = razao(ev), pt = perto(c, p);
    const x = RPL + pt[0]*(RW-RPL-RPR);
    linha.setAttribute("x1", x); linha.setAttribute("x2", x); linha.setAttribute("opacity", ".5");
    const cc = canal && canal.length ? perto(canal, p) : null;
    dica.innerHTML = `<b>${hms(pt[0]*(dur||0))}</b><br>${Math.round(pt[1]*100)}% ainda assistindo`
      + (cc ? `<br><span class="l">canal: ${Math.round(cc[1]*100)}%</span>` : "");
    dica.classList.add("ver");
    const rb = box.getBoundingClientRect();
    const xr = x / RW * rb.width;
    dica.style.left = Math.min(Math.max(xr - dica.offsetWidth/2, 4), rb.width - dica.offsetWidth - 4) + "px";
    dica.style.top = "6px";
  };
  hit.onmouseleave = () => { dica.classList.remove("ver"); linha.setAttribute("opacity", "0"); };
  hit.onclick = ev => tocar(id, razao(ev) * (dur || 0));
}
/* de onde veio o público DESTE vídeo */
function blocoTraf(id){
  const t = (DADOS.trafego||{})[id];
  if (!t) return "";
  const cx = (arr, nome) => {
    if (!arr || !arr.length) return `<div class="tl"><span class="t" style="color:var(--t3)">sem dado</span></div>`;
    const tot = arr.reduce((a,b) => a + b[1], 0) || 1;
    return arr.slice(0,6).map(([k,v],i) => `<div class="tl">
      <span class="t">${esc(nome ? (nome(k) || k) : k)}</span><span class="n">${nf(v)}</span>
      <span class="b" style="width:${(v/tot*100).toFixed(1)}%;animation-delay:${(i*.05).toFixed(2)}s"></span></div>`).join("");
  };
  return `<div class="msec"><h4>De onde veio o público deste vídeo</h4>
    <div class="msub">
      <div><h4 style="margin-bottom:8px">Fonte</h4>${cx(t.fontes, nomeFonte)}</div>
      <div><h4 style="margin-bottom:8px">Pesquisaram por</h4>${cx(t.busca)}</div>
      <div><h4 style="margin-bottom:8px">Vídeos que sugeriram este</h4>${cx(t.sugerem || t.sugeriram, k => tituloDe(k).t)}</div>
    </div></div>`;
}
function copiar(txt, el){
  navigator.clipboard.writeText(txt).then(() => {
    const antes = el.textContent; el.textContent = "copiado ✓";
    setTimeout(() => el.textContent = antes, 1600);
  }).catch(() => {});
}

/* as compras de um vídeo */
function abrirVendas(id){
  const d = vendasDo(id) || {n:0, receita:0, compras:[]};
  const m = (DADOS.videos||{})[id] || {};
  const cs = [...(d.compras||[])].sort((a,b) => (a.data < b.data ? 1 : -1));
  $("#folhaVendas").innerHTML = `
    <button class="fecha" style="top:16px;right:16px;background:var(--carta-3);color:var(--t2)"
      onclick="modalVendas.close()"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="mcab"><h3>${esc(corta(m.titulo || id, 72))}</h3>
      <div class="mt"><span>${d.n} compra${d.n===1?"":"s"} atribuída${d.n===1?"":"s"} a este vídeo</span>
      <span>desde ${dt(inicioTracking())}</span></div></div>
    <div class="mnums">
      <div><b class="num">${nf(d.n)}</b><span>Compras</span></div>
      <div><b class="num">R$ ${nf(parte(d.receita))}</b><span>Sua parte</span></div>
      <div><b class="num">R$ ${nf(d.receita)}</b><span>Total da venda</span></div>
      <div><b class="num">R$ ${d.n ? nf(parte(d.receita/d.n)) : "–"}</b><span>Ticket (seu)</span></div>
    </div>
    <div class="mcorpo">${cs.length ? tabelaCompras(cs.map(c => ({...c, vid:id})))
      : `<div class="vaz-p">Nenhuma compra registrada ainda para este vídeo.</div>`}</div>`;
  if (modalVideo.open) modalVideo.close();
  modalVendas.showModal();
}

/* ══════════════════════════════════════════════════════════════════════════
   AVISOS — o painel diz quando alguma coisa está errada, em vez de mostrar
   número velho com cara de número novo
   ══════════════════════════════════════════════════════════════════════════ */
/* quando os ${MIN_DIAS_RASTREIO} dias fecham: o atraso de hoje do YouTube somado ao que falta */
function ligaEm(iniR, dR){
  const hoje = new Date(isoLocal(new Date()) + "T00:00:00");
  const ultimoFechado = new Date(new Date(iniR + "T00:00:00").getTime() + (Math.max(dR,1) - 1) * 86400000);
  const atraso = Math.max(1, Math.round((hoje - ultimoFechado) / 86400000));
  const alvo = new Date(new Date(iniR + "T00:00:00").getTime() + (MIN_DIAS_RASTREIO - 1 + atraso) * 86400000);
  return dt(isoLocal(alvo));
}
function avisos(){
  let out = "";
  const horas = (Date.now() - new Date(DADOS.gerado_em).getTime()) / 3600000;
  if (horas > 26) out += `<div class="aviso grave"><span class="selo ng">${ico("alerta")}</span><div>
    <b>A coleta do YouTube está com ${Math.floor(horas/24)} dia(s) e ${Math.round(horas%24)}h.</b>
    A rotina roda quatro vezes por dia, mas não roda com o Mac dormindo — e a autorização do Google
    vence sozinha a cada 7 dias enquanto o projeto estiver em modo “Testing”.
    Pra atualizar agora: dois cliques em <b>“13 - Atualizar titulos e metricas agora.command”</b>.
    As vendas continuam ao vivo — só as métricas do YouTube é que estão nessa idade.</div></div>`;
  const dR = diasRastreados(), iniR = inicioTracking();
  if (iniR && dR < MIN_DIAS_RASTREIO) out += `<div class="aviso"><span class="selo al">${ico("alerta")}</span><div>
    <b>A venda por vídeo começa a contar em ${dt(iniR)}.</b>
    O YouTube fechou ${dR === 0 ? "nenhum dia" : dR + " dia" + (dR>1?"s":"")} desde então
    (ele entrega as views com 2–3 dias de atraso), e <b>Venda/1k</b> e o alerta de “nenhuma venda”
    precisam de ${MIN_DIAS_RASTREIO}. Ligam sozinhos por volta de <b>${ligaEm(iniR, dR)}</b>.
    As vendas em si são reais e entram ao vivo.</div></div>`;
  const jan = DADOS.janelas[periodo] || {};
  if (jan.calendario && !(jan.videos||[]).length) out += `<div class="aviso"><span class="selo al">${ico("relogio")}</span><div>
    <b>Sem métrica do YouTube neste período.</b> O YouTube não fecha o dia na hora — as métricas saem
    com 1 a 3 dias de atraso. As <b>vendas</b> deste período, essas, são reais: elas não esperam o
    YouTube fechar nada.</div></div>`;
  if (ARQUIVO) out += `<div class="aviso"><span class="selo al">${ico("alerta")}</span><div>
    <b>O painel foi aberto direto do arquivo.</b> O player de vídeo não vai funcionar (o YouTube bloqueia).
    Abra pelo <b>“Abrir Painel.command”</b>, na mesma pasta.</div></div>`;
  return out;
}



/* ══════════════════════════════════════════════════════════════════════════
   ▓▓ MOTOR ▓▓ — as contas, não a tela.

   Este bloco vem inteiro da versão anterior, sem uma vírgula mudada: é o
   código que já estava rodando e conferido contra os números reais. Ele faz as
   contas de venda por canal, o relógio próprio das vendas (que não espera o
   YouTube fechar o dia), a conversão do dólar dia a dia, o carimbo de views na
   venda nova, o ritmo por idade do vídeo, a mediana da retenção do canal, a
   cota da API e o CSV.

   Regra: se um número estiver errado, o erro está AQUI. Se o desenho estiver
   errado, está lá em cima. Os dois não se misturam de propósito.
   ══════════════════════════════════════════════════════════════════════════ */
function taxaDaJanela(k){
  const j = (DADOS && DADOS.janelas) ? DADOS.janelas[k || periodo] : null;
  if (j && j.cambio_efetivo) return j.cambio_efetivo;
  const c = CAMBIO();
  return (c && c.usd_brl) || null;
}

/* de onde veio a taxa — vai no hover, pra nunca ficar um numero sem procedencia */
function fonteDaTaxa(k){
  const j = (DADOS && DADOS.janelas) ? DADOS.janelas[k || periodo] : null;
  const c = CAMBIO() || {};
  if (j && j.cambio_efetivo)
    return `convertido dia a dia, cada dia pela cotacao dele — media do periodo: US$ 1,00 = R$ ${brl(j.cambio_efetivo)}`;
  return c.usd_brl ? `cotacao unica de ${dt(c.em||"")}: US$ 1,00 = R$ ${brl(c.usd_brl)}` : "";
}

function faixaDoPeriodo(k){
  const j = DADOS.janelas[k] || {};
  if (!j.inicio || !j.fim) return "";
  return j.inicio === j.fim ? dt(j.fim) : dt(j.inicio) + " a " + dt(j.fim);
}

function faixaVendas(){
  if (typeof dadosVendasBrutos !== "function" || !dadosVendasBrutos()) return "";
  const {ini, fim} = janelaVendas();
  if (!ini || !fim) return "";
  const hoje = isoLocal(new Date());
  const f = x => x === hoje ? "hoje" : dt(x);
  return ini === fim ? f(fim) : dt(ini) + " a " + f(fim);
}

function rotuloPill(k){
  const j = DADOS.janelas[k] || {};
  return NOME_PERIODO[k] || j.rotulo || (k + " dias");
}

/* o que o painel usa: o que veio ao vivo manda; se nao houver, o arquivo importado */
/* ═══ UM PAINEL SÓ (18/09/2026) ═══
   "Tudo é um painel só." As vendas de ANTES do rastreio ao vivo (importadas da Assiny por
   _motor/importar_historico.py) entram aqui, no mesmo formato das ao vivo — e a partir daí
   Visão geral, Vendas, Por plataforma e os gráficos enxergam o período inteiro.

   O CORTE é a primeira venda que chegou ao vivo (14/09/2026 14:00). Antes dele, vale o
   histórico; dele em diante, vale o ao vivo. Não dá pra juntar só pelo id da transação: o
   recebedor, quando uma venda é reembolsada, muda o status da MESMA linha e ela some das
   compras — o id do reembolso não volta pro painel. Com o corte por horário, cada venda vem
   de um lugar só e nunca conta duas vezes. Conferido em 18/09: de 15/09 em diante o ao vivo
   tem todas as vendas do histórico; em 14/09 faltavam as 11 da manhã — que vêm do histórico.

   A venda do histórico não tem vídeo de origem (antes de 14/09 o link era o mesmo em todos).
   A plataforma vem do projeto da Assiny: Brainmax = YouTube, Instagram, Tiktok. */
const PROJ_ORIGEM = {brainmax: "youtube", youtube: "youtube", instagram: "instagram", tiktok: "tiktok"};
const MARCA_HIST = "antes-do-rastreio";
let _fundido = null, _fundidoDe;
function dadosVendasBrutos(){
  const vivo = (VENDAS_LIVE && VENDAS_LIVE.por_marca) ? VENDAS_LIVE
             : ((typeof VENDAS !== "undefined" && VENDAS && VENDAS.por_marca) ? VENDAS : null);
  const P = (typeof HISTORICO !== "undefined" && HISTORICO && HISTORICO.pedidos) ? HISTORICO.pedidos : null;
  if (!P || !P.length) return vivo;
  if (_fundido && _fundidoDe === vivo) return _fundido;       // monta uma vez por atualização

  let corte = "9999";
  Object.values((vivo && vivo.por_marca) || {}).forEach(dd => (dd.compras || []).forEach(c => {
    if (c.data && c.data < corte) corte = c.data; }));
  const por_marca = {};
  Object.entries((vivo && vivo.por_marca) || {}).forEach(([k, dd]) =>
    por_marca[k] = {n: dd.n, receita: dd.receita, compras: (dd.compras || []).slice()});
  const movimento = ((vivo && vivo.movimento) || []).slice();
  const h = por_marca[MARCA_HIST] = {n: 0, receita: 0, compras: []};
  let total = (vivo && vivo.total) || 0;
  P.forEach(([id, quando, liq, projeto, st, baixa, forma]) => {
    if (quando >= corte) return;                              // dali em diante manda o ao vivo
    const origem = PROJ_ORIGEM[semAcento(projeto)] || "";
    if (st === "p"){
      h.compras.push({id, data: quando, valor: liq, origem, projeto, forma, views: null, dias: null, historico: true});
      h.n++; h.receita += liq; total++;
      movimento.push({tipo: "venda", data: quando.slice(0,10), valor: liq, marca: MARCA_HIST, origem, projeto});
    } else if (st === "r"){
      movimento.push({tipo: "baixa", data: baixa || quando.slice(0,10), valor: liq, marca: MARCA_HIST, origem, projeto});
    }
  });
  h.receita = Math.round(h.receita * 100) / 100;
  _fundido = Object.assign({}, vivo || {}, {por_marca, movimento, total, corte_historico: corte});
  _fundidoDe = vivo;
  return _fundido;
}

const CANAIS = (typeof CANAIS_CFG !== "undefined") ? CANAIS_CFG : {
  recuperacao: {projetos:["recuperacao"], comissao:20},
  trafego: {projetos:["trafego"], fontes_trafego:["fb","facebook","meta"], comissao:50}};

function canalDe(x){
  const pj = semAcento(x.projeto), o = semAcento(x.origem);
  const tem = (lista, t) => t && (lista||[]).some(k => t.includes(semAcento(k)));
  if (tem(CANAIS.recuperacao.projetos, pj)) return "recuperacao";
  if (tem(CANAIS.trafego.projetos, pj)) return "trafego";
  if (o && (CANAIS.trafego.fontes_trafego||[]).some(k => o === semAcento(k))) return "trafego";
  return "organico";
}

function vendasDoCanal(canal){
  const d = dadosVendasBrutos(); if (!d) return null;
  const chave = canal;
  const c0 = _canalCache.get(chave);
  if (c0 && c0.fonte === d) return c0.v;
  const por_marca = {}; let total = 0, receita = 0;
  Object.entries(d.por_marca || {}).forEach(([marca, dd]) => {
    const cs = (dd.compras || []).filter(c => canalDe({...c, marca}) === canal);
    if (!cs.length) return;
    const r = cs.reduce((a,c) => a + (+c.valor||0), 0);
    por_marca[marca] = {n: cs.length, receita: Math.round(r*100)/100, compras: cs};
    total += cs.length; receita += r;
  });
  const movimento = (d.movimento || []).filter(m => canalDe(m) === canal);
  const v = {...d, por_marca, movimento, total, receita: Math.round(receita*100)/100};
  _canalCache.set(chave, {fonte: d, v});
  return v;
}

/* o que o painel inteiro usa (vídeo, gráfico, tabela): só o orgânico */
function dadosVendas(){ return vendasDoCanal("organico"); }

function lerCache(){
  try {
    const cru = localStorage.getItem(CACHE_VENDAS);
    if (!cru) return null;
    const c = JSON.parse(cru);
    return (c && c.d && c.d.por_marca) ? c : null;
  } catch(e){ return null; }
}

function gravarCache(d){
  try { localStorage.setItem(CACHE_VENDAS, JSON.stringify({em: Date.now(), d})); } catch(e){}
}

function vendasDoCache(){
  const c = lerCache();
  if (!c) return false;
  VENDAS_LIVE = normalizaOrigens(c.d);
  window.semVendas = false;
  VENDAS_CARREGANDO = false;
  const h = (c.d.atualizado || "").slice(11,16);
  marcarAoVivo(`${c.d.total} venda${c.d.total===1?"":"s"} · ${h} · atualizando…`, "");
  return true;
}

async function buscarVendas(silencioso){
  if (typeof VENDAS_AO_VIVO === "undefined" || !VENDAS_AO_VIVO
      || VENDAS_AO_VIVO.indexOf("SEU_ID_AQUI") >= 0){
    VENDAS_CARREGANDO = false;
    marcarAoVivo("vendas: sem conexão configurada", "off"); return;
  }
  if (!silencioso) marcarAoVivo("buscando vendas…", "");
  try {
    const r = await fetch(VENDAS_AO_VIVO, {cache: "no-store"});
    const d = await r.json();
    if (!d || !d.por_marca) throw new Error("resposta sem por_marca");
    const cru = JSON.stringify(d), igual = window._vivoCru === cru; window._vivoCru = cru;
    VENDAS_LIVE = normalizaOrigens(d);
    window.semVendas = false;
    gravarCache(d);
    const h = (d.atualizado || "").slice(11,16);
    marcarAoVivo(`${d.total} venda${d.total===1?"":"s"} · ao vivo ${h}`, "on");
    VENDAS_CARREGANDO = false;
    if (!igual) desenhar();          // nada mudou? não repinta a tela inteira à toa
    carimbar(d);
  } catch(e){
    // já tem venda na tela (veio do cache): não apaga nada, só avisa que a busca falhou
    VENDAS_CARREGANDO = false;
    marcarAoVivo(VENDAS_LIVE ? "vendas: mostrando a última cópia" : "vendas: não consegui buscar agora", "off");
    try { desenhar(); } catch(e2){}   // tira o "buscando…" da tela inicial
  }
}

async function carimbar(d){
  if (carimbando || typeof VENDAS_AO_VIVO === "undefined" || !VENDAS_AO_VIVO) return;
  const seg = (typeof LINK_VENDA !== "undefined" && LINK_VENDA && LINK_VENDA.segredo) || null;
  const itens = [];
  Object.entries(d.por_marca || {}).forEach(([marca, dd]) => {
    const vid = idDaMarca(marca);
    const m = vid ? (DADOS.videos || {})[vid] : null;
    (dd.compras || []).forEach(c => {
      if (c.views != null || !m) return;           // já carimbada, ou vídeo que não é do canal
      if (m.so_titulo) return;                     // ainda sem métricas: carimba na próxima coleta
      itens.push({id: c.id, views: viewsDe(vid), dias: diasDeVida(m.publicado, c.data)});
    });
  });
  if (!itens.length) return;
  carimbando = true;
  try {
    await fetch(VENDAS_AO_VIVO + "?carimbo=1" + (seg ? "&k=" + encodeURIComponent(seg) : ""), {
      method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"},
      body: JSON.stringify({itens})
    });
  } catch(e){ /* sem rede agora; tenta na próxima busca */ }
  carimbando = false;
}

/* a marca é o ID do vídeo; se não for um vídeo do canal, não dá pra carimbar */
function idDaMarca(marca){
  if ((DADOS.videos || {})[marca]) return marca;
  const achado = Object.keys(TRACKING || {}).find(k => TRACKING[k] && TRACKING[k].marca === marca);
  return achado || null;
}

function viewsDe(vid){
  const j = DADOS.janelas || {};
  for (const k of ["365","90","60","28"]){
    const v = (j[k]?.videos || []).find(x => x.id === vid);
    if (v) return v.views;
  }
  return null;
}

function diasDeVida(publicado, dataVenda){
  if (!publicado || !dataVenda) return null;
  const a = new Date(publicado + "T00:00:00"), b = new Date(dataVenda.replace(" ", "T"));
  const d = Math.floor((b - a) / 86400000);
  return (isFinite(d) && d >= 0) ? d : null;
}

/* --- 1) o dinheiro por dia, uma linha por origem --- */
const ORIGENS = [
  {k:"youtube",   rot:"YouTube",   cor:"var(--yt)",    forma:"circulo"},
  {k:"instagram", rot:"Instagram", cor:"var(--ig)",    forma:"quadrado"},
  {k:"tiktok",    rot:"TikTok",    cor:"var(--tk)",    forma:"losango"},
  {k:"pdf",       rot:"PDF",       cor:"var(--pdf)",   forma:"quadrado"},
  /* NoTrack = a venda chegou sem etiqueta nenhuma. Não é uma origem: é a falta dela.
     Vem de link sem marcação (bio antiga, WhatsApp, comentário fixado, link salvo). */
  {k:"outra",     rot:"NoTrack",   cor:"var(--outra)", forma:"triangulo", tracejado:true},
];

function janelaVendas(){
  const hoje = new Date();
  const fim = isoLocal(hoje);
  if (periodo === "hoje") return {ini: fim, fim};
  if (periodo === "ontem"){
    // venda nao tem atraso: "ontem" aqui e ontem MESMO, o dia do calendario
    const o = isoLocal(new Date(hoje.getTime() - 86400000));
    return {ini: o, fim: o};
  }
  if (periodo === "mes")  return {ini: isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim};
  const n = parseInt(periodo, 10);
  if (!n) return {ini: null, fim: null};
  return {ini: isoLocal(new Date(hoje.getTime() - (n-1)*86400000)), fim};
}

/* toda compra do período escolhido, já com o vídeo de origem junto */
function comprasDoPeriodo(canal){
  const d = canal ? vendasDoCanal(canal) : dadosVendas(); if (!d) return [];
  const {ini, fim} = janelaVendas();
  const fora = [];
  Object.entries(d.por_marca || {}).forEach(([marca, dd]) => {
    (dd.compras || []).forEach(c => {
      const dia = (c.data || "").slice(0,10);
      if (ini && dia < ini) return;
      if (fim && dia > fim) return;
      fora.push({...c, marca, vid: idDaMarca(marca)});
    });
  });
  return fora;
}

function dadosDinheiro(){
  const d = dadosVendas();
  const mov = (d && d.movimento) || [];
  if (!mov.length) return null;
  const {ini, fim} = janelaVendas();
  const usados = mov.filter(m => (!ini || m.data >= ini) && (!fim || m.data <= fim));
  if (!usados.length) return {vazioPeriodo: true};
  const todas = [...new Set(usados.map(m => m.data))].sort();
  const de = todas[0], ate = todas[todas.length-1];
  const n = Math.min(Math.max(diasEntre(de, ate) + 1, 1), 400);   // era 92: cortava o fim com histórico longo
  const dias = [];
  for (let i = 0; i < n; i++){
    const dt = new Date(new Date(de+"T00:00:00").getTime() + i*86400000).toISOString().slice(0,10);
    const linha = {data: dt, voltou: 0, nb: 0, total: 0, nv: 0};
    ORIGENS.forEach(o => linha[o.k] = 0);
    dias.push(linha);
  }
  const idx = Object.fromEntries(dias.map((x,i) => [x.data, i]));
  let entrou = 0, voltou = 0;
  const usadas = new Set();
  usados.forEach(m => {
    const i = idx[m.data]; if (i == null) return;
    if (m.tipo === "baixa"){ dias[i].voltou += m.valor; dias[i].nb++; voltou += m.valor; return; }
    const k = origemDe(m.origem);
    dias[i][k] += m.valor; dias[i].total += m.valor; dias[i].nv++;
    entrou += m.valor; usadas.add(k);
  });
  // "Outras" só entra no gráfico se pesar: linha cinza de 2% só suja o desenho
  const soma = k => dias.reduce((t,d) => t + d[k], 0);
  const relevante = o => o.k !== "outra" || (entrou > 0 && soma("outra")/entrou >= 0.05);
  return {dias, entrou, voltou, usadas: ORIGENS.filter(o => usadas.has(o.k) && relevante(o))};
}

function dadosMomento(){
  const d = dadosVendas(); if (!d) return null;
  const compras = [];
  Object.values(d.por_marca || {}).forEach(x => (x.compras||[]).forEach(c => compras.push(c)));
  if (!compras.length) return null;
  const campo = gMom === "dias" ? "dias" : "views";
  const com = compras.filter(c => c[campo] != null);
  const faixas = (gMom === "dias" ? FAIXAS_DIAS : FAIXAS_VIEWS)
    .map(([a,b,rot]) => ({rot, a, b, n: com.filter(c => c[campo] >= a && c[campo] <= b).length}));
  return {faixas, com: com.length, total: compras.length,
          valores: com.map(c => c[campo]).sort((x,y) => x-y)};
}

function ritmoDo(id){
  if (id in ritmoCache) return ritmoCache[id];
  const c = (typeof DADOS!=="undefined" && DADOS.ritmo) ? DADOS.ritmo[id] : null;
  const ref = (typeof DADOS!=="undefined" && DADOS.ritmo_referencia) || [];
  let out = null;
  if (c && c.length && ref.length){
    const d = Math.min(c.length, ref.length) - 1;      // último dia de vida com referência
    if (d >= 0 && ref[d] > 0){
      const r = c[d] / ref[d];
      const num = r >= 10  ? String(Math.round(r))
                : r >= 0.1  ? r.toFixed(1).replace(".", ",")
                : r >= 0.01 ? r.toFixed(2).replace(".", ",")
                :             "0";
      out = {r, dia: d+1, num,
        txt: (r>=1.05 ? "▲ " : r<=0.95 ? "▼ " : "= ") + num + "× · " + (d+1) + "d",
        cls: r>=1.05 ? "rup" : r<=0.95 ? "rdn" : "rmid",
        dica: "mediana do canal aos " + (d+1) + " dias: " + nf(ref[d]) + " views · este: " + nf(c[d])};
    }
  }
  return (ritmoCache[id] = out);
}

/* --- de onde vem o público --- */
function nomeFonte(c){ return ((typeof DADOS!=="undefined" && DADOS.nomes_fonte) || {})[c] || c; }

function tituloDe(vid){
  const v = ((typeof DADOS!=="undefined" && DADOS.videos) || {})[vid];
  if (v) return {t: v.titulo, c: "seu canal"};
  const f = ((typeof DADOS!=="undefined" && DADOS.titulos_fora) || {})[vid];
  return f ? {t: f.titulo, c: f.canal || "", fora: true} : {t: vid, c: "", fora: true};
}

/* --- tracking e vendas --- */
function trackDo(id){
  const t = (typeof TRACKING !== "undefined" && TRACKING) ? TRACKING[id] : null;
  return t || null;
}

function marcaDo(id){
  const t = trackDo(id);
  return (t && t.marca) ? String(t.marca) : id;
}

function linkDo(id){
  const t = trackDo(id);
  if (t && t.url) return t.url;
  if (t && t.ok && typeof LINK_VENDA !== "undefined" && LINK_VENDA && LINK_VENDA.modelo)
    return LINK_VENDA.modelo.replace("__ID__", t.marca || id);
  return null;
}

function vendasDo(id){
  const VD = dadosVendas();
  if (!VD) return null;
  // soma as duas marcações possíveis: o ID do vídeo e o número do card.
  // Assim venda antiga não fica órfã se a marcação do vídeo mudar.
  const chaves = [...new Set([id, marcaDo(id)])];
  const junto = {n:0, receita:0, compras:[]};
  chaves.forEach(k => {
    const d = VD.por_marca[k];
    if (!d) return;
    junto.n += d.n; junto.receita += d.receita;
    junto.compras = junto.compras.concat(d.compras || []);
  });
  junto.receita = Math.round(junto.receita * 100) / 100;
  return junto;
}

function semSaber(id){
  const d = vendasDo(id);
  if (!d) return null;                      // nenhum CSV importado ainda
  const t = trackDo(id);
  if (!d.n && !(t && t.ok)) return null;    // não está marcado: zero aqui seria mentira
  return d;
}

function janelaRastreada(){
  const j = (DADOS && DADOS.janelas) ? DADOS.janelas.rastreado : null;
  return j || null;
}

function diasRastreados(){
  const j = janelaRastreada();
  return j ? (j.dias_reais || 0) : 0;
}

function inicioTracking(){
  const j = janelaRastreada();
  return (j && j.desde) ? j.desde : INICIO_TRACKING_PADRAO;
}

function viewsRastreadas(id){
  const j = janelaRastreada();
  if (!j || !j.dias_reais) return null;        // nenhum dia medido: não dá pra dividir
  if (!_mapaRastreado){
    _mapaRastreado = {};
    (j.videos || []).forEach(v => { _mapaRastreado[v.id] = v.views || 0; });
  }
  return _mapaRastreado[id] || 0;
}

/* o vídeo já foi medido tempo suficiente pra que "não vendeu" signifique alguma coisa? */
function podeJulgarVenda(id){
  if (diasRastreados() < MIN_DIAS_RASTREIO) return false;
  const t = trackDo(id);
  if (!(t && t.ok)) return false;              // sem link próprio não há o que medir
  return (viewsRastreadas(id) || 0) >= 500;    // e precisa ter tido público no período medido
}

function pctCanal(canal){ return +((CANAIS[canal] || {}).comissao) || 0; }

function metaDoPeriodo(){
  if (typeof META === "undefined" || !META || !META.diario) return null;
  const {ini, fim} = janelaVendas();
  const rows = META.diario.filter(x => (!ini || x.data >= ini) && (!fim || x.data <= fim));
  const s = {gasto:0, impressoes:0, cliques:0, compras_pixel:0, valor_pixel:0, camp:{}};
  rows.forEach(x => {
    ["gasto","impressoes","cliques","compras_pixel","valor_pixel"].forEach(k => s[k] += (+x[k] || 0));
    const c = s.camp[x.campanha_id] = s.camp[x.campanha_id] ||
      {nome: x.campanha, gasto:0, cliques:0, impressoes:0, compras_pixel:0};
    c.gasto += +x.gasto || 0; c.cliques += +x.cliques || 0;
    c.impressoes += +x.impressoes || 0; c.compras_pixel += +x.compras_pixel || 0;
  });
  s.dias = rows.length; s.atualizado = META.atualizado; s.conta = META.conta_nome || META.conta;
  return s;
}

function deltaCanal(chave){
  const J = DADOS.janelas || {}, R = DADOS.resumo || {};
  const jk = J[periodo], j365 = J["365"], r = R[periodo], r365 = R["365"];
  if (!jk || !j365 || !r || !r365 || periodo === "365") return null;
  const dk = jk.dias || 0, d365 = j365.dias || 0;
  const vk = +r[chave] || 0, v365 = +r365[chave] || 0;
  const dResto = d365 - dk, vResto = v365 - vk;
  if (dk <= 0 || dResto <= 13 || vResto <= 0) return null;   // base curta demais pra significar algo
  const agora = vk / dk, antes = vResto / dResto;
  if (!antes) return null;
  return {r: agora/antes, base: "o resto do ano"};
}

function deltaVendas(canal){
  const d = canal ? vendasDoCanal(canal) : dadosVendas();
  if (!d) return null;
  const {ini, fim} = janelaVendas();
  if (!ini || !fim) return null;
  const n = diasEntre(ini, fim) + 1;
  if (n < 2) return null;
  const antesFim = isoLocal(new Date(new Date(ini+"T00:00:00").getTime() - 86400000));
  const antesIni = isoLocal(new Date(new Date(ini+"T00:00:00").getTime() - n*86400000));
  /* só compara se o período anterior INTEIRO tem dado. Com o histórico começando em 01/06,
     "90 dias" comparava com um período que começa em março e dava "▲ 798%" — número falso. */
  let primeira = "9999";
  Object.values(d.por_marca || {}).forEach(dd => (dd.compras || []).forEach(c => {
    if (c.data && c.data.slice(0,10) < primeira) primeira = c.data.slice(0,10); }));
  if (antesIni < primeira) return null;
  let ag = 0, an = 0;
  Object.values(d.por_marca || {}).forEach(dd => (dd.compras || []).forEach(c => {
    const dia = (c.data || "").slice(0,10);
    if (dia >= ini && dia <= fim) ag += (+c.valor || 0);
    else if (dia >= antesIni && dia <= antesFim) an += (+c.valor || 0);
  }));
  if (!an) return null;
  return {r: ag/an, base: `os ${n} dias anteriores`};
}

function curvaCanal(){
  if (baseRet !== undefined) return baseRet;
  const cs = Object.values(DADOS.retencao || {});
  if (cs.length < 3) return (baseRet = null);
  const n = Math.min(...cs.map(c => c.y.length));
  const y = [];
  for (let i = 0; i < n; i++){
    const col = cs.map(c => c.y[i]).filter(v => typeof v === "number");
    y.push(mediana(col));
  }
  baseRet = {x: cs[0].x.slice(0, n), y, n: cs.length};
  return baseRet;
}

function medCanal(chave){
  const k = periodo + "|" + chave;
  if (k in medCache) return medCache[k];
  const vs = (DADOS.janelas[periodo]?.videos || []).filter(v => v.views >= 500);
  const pega = {views:v=>v.views, inscritos:v=>v.inscritos, ins_1k:v=>v.ins_1k,
                avg_pct:v=>v.avg_pct, avg_watch_s:v=>v.avg_watch_s, watch_h:v=>v.watch_h,
                comentarios:v=>v.comentarios, shares:v=>v.shares}[chave];
  return (medCache[k] = pega ? mediana(vs.map(pega).filter(x => x > 0)) : 0);
}

function comparativo(valor, chave){
  const m = medCanal(chave);
  if (!m || !isFinite(valor) || valor <= 0) return '<em class="igual">–</em>';
  const r = valor / m;
  const fmt = r >= 10  ? String(Math.round(r))
            : r >= 0.1 ? r.toFixed(1).replace(".", ",")
            :            r.toFixed(2).replace(".", ",");   // evita mostrar "0,0×"
  if (r >= 1.05) return `<em class="acima" title="mediana do canal no período: ${nf(m)}">▲ ${fmt}×</em>`;
  if (r <= 0.95) return `<em class="abaixo" title="mediana do canal no período: ${nf(m)}">▼ ${fmt}×</em>`;
  return `<em class="igual" title="mediana do canal no período: ${nf(m)}">= mediana</em>`;
}

function matarPlayer(){
  if (vigia){ clearTimeout(vigia); vigia = null; }
  try { if (player && player.destroy) player.destroy(); } catch(e){}
  player = null;
}

/* plano B: iframe puro. Funciona em qualquer situacao, so recarrega a cada pulo. */
function iframeSimples(id, seg){
  matarPlayer();
  videoAberto = id;
  $("#palco").innerHTML =
    `<iframe src="https://www.youtube.com/embed/${id}?start=${seg}&autoplay=1&rel=0&playsinline=1"
       title="player do vídeo" allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
       referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

function tocar(id, segundos){
  segundos = Math.max(0, Math.round(segundos || 0));
  /* v22: o palco nasce baixo (só a capa) e só ganha altura cheia quando o vídeo toca —
     assim o primeiro número do modal aparece sem precisar rolar. */
  const _p = $("#palco"); if (_p) _p.classList.add("tocando");
  if (ARQUIVO){   // o YouTube recusa tocar video em pagina aberta como arquivo
    $("#palco").innerHTML =
      `<div class="aviso-arquivo">
         <b>O player não funciona assim.</b>
         <p>Você abriu o painel com duplo clique no arquivo. O YouTube só toca vídeo em página
         servida por um endereço — por isso a tela fica preta.</p>
         <p>Feche esta janela e abra pelo <b>“Abrir Painel.command”</b> (ou pelo
         “Atualizar Painel.command”), que estão na mesma pasta. Deixe o Terminal aberto.</p>
         <a href="https://youtu.be/${id}?t=${segundos}" target="_blank" rel="noopener">ver este vídeo no YouTube →</a>
       </div>`;
    return;
  }
  // já está tocando este vídeo pela API: só pula, sem recarregar
  if (player && videoAberto === id && typeof player.seekTo === "function"){
    try { player.seekTo(segundos, true); player.playVideo(); return; } catch(e){}
  }
  if (!(window.apiPronta && window.YT && YT.Player)) return iframeSimples(id, segundos);

  matarPlayer();
  videoAberto = id;
  $("#palco").innerHTML = '<div id="yt"></div>';
  let resolvido = false;
  const cair = () => { if (!resolvido){ resolvido = true; iframeSimples(id, segundos); } };
  vigia = setTimeout(cair, 4000);   // se a API não responder, não deixa a tela preta
  try {
    player = new YT.Player("yt", {
      width: "100%", height: "100%", videoId: id,
      playerVars: Object.assign({start: segundos, autoplay: 1, rel: 0, modestbranding: 1,
                   playsinline: 1},
                   /^https?:/.test(location.origin) ? {origin: location.origin} : {}),
      events: {
        onReady: e => { resolvido = true; clearTimeout(vigia); vigia = null;
                        try { e.target.playVideo(); } catch(x){} },
        onError: () => cair()
      }
    });
  } catch(e){ cair(); }
}

function baixarCSV(){
  const L = linhas();
  if (!L.length){ alert("Não há vídeo nenhum nesse filtro pra exportar."); return; }
  const cols = MODOS[modo];
  /* -1 e o codigo interno de "nao da pra saber" — no CSV isso e celula VAZIA, nunca zero.
     E numero sai arredondado: 40,88 e um numero; 40,88273195876289 e ruido. */
  const cru = (k, v) => {
    const x = COL[k].get(v);
    if (x == null || x === -1) return "";
    if (typeof x !== "number") return String(x);
    if (!isFinite(x)) return "";
    const arred = Math.abs(x) >= 1000 ? Math.round(x)
                : Math.abs(x) >= 1    ? Math.round(x * 100) / 100
                :                       Math.round(x * 10000) / 10000;
    return String(arred).replace(".", ",");
  };
  const cab = ["#", "ID", "Título", "Publicado", "Duração (s)", "Link de venda"]
              .concat(cols.map(k => COL[k].r));
  const linhasCSV = [cab].concat(L.map((v, i) => [
    i + 1, v.id, (v.m.titulo || "").replace(/;/g, ","), v.m.publicado || "", v.m.dur_s || 0,
    linkDo(v.id) || ""
  ].concat(cols.map(k => cru(k, v)))));
  const txt = "﻿" + linhasCSV.map(l => l.map(c => {
    const t = String(c == null ? "" : c);
    return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }).join(";")).join("\r\n");
  const nome = `painel-${periodo}d-${new Date().toISOString().slice(0,10)}.csv`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], {type: "text/csv;charset=utf-8"}));
  a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function abasOff(){
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_ABAS) || "[]")); }
  catch(e){ return new Set(); }
}

function gravarAbasOff(set){
  try { localStorage.setItem(CHAVE_ABAS, JSON.stringify([...set])); } catch(e){}
}

/* ══════════════════════════════════════════════════════════════════════════
   O MOTOR DA TELA — navegação, desenho, movimento
   ══════════════════════════════════════════════════════════════════════════ */

/* a pílula da lateral desliza até o item aberto, em vez de cada botão acender o próprio fundo.
   É o detalhe que faz a navegação parecer uma peça só se movendo. */
function moveBolha(){
  const nav = $("#nav"); if (!nav) return;
  const bolha = nav.querySelector(".bolha");
  const alvo = nav.querySelector(".item.on");
  if (!bolha) return;
  if (!alvo || window.innerWidth <= 720){ bolha.style.opacity = 0; return; }
  const rn = nav.getBoundingClientRect(), ra = alvo.getBoundingClientRect();
  bolha.style.height = ra.height + "px";
  bolha.style.transform = `translateY(${ra.top - rn.top}px)`;
  bolha.style.opacity = 1;
}
/* o mesmo truque no controle segmentado dos períodos */
function moveDeslizante(id){
  const seg = $("#"+id); if (!seg) return;
  const d = seg.querySelector(".desl"), a = seg.querySelector("button.on");
  if (!d) return;
  if (!a){ d.style.opacity = 0; return; }
  const rs = seg.getBoundingClientRect(), ra = a.getBoundingClientRect();
  d.style.opacity = 1;
  d.style.width = ra.width + "px";
  d.style.transform = `translateX(${ra.left - rs.left}px)`;
}

function montaNav(){
  const off = secoesOff();
  let grupo = null, html = `<div class="nav"><span class="bolha"></span>`;
  SECOES.filter(s => secaoLigada(s.k)).forEach(s => {
    if (s.grupo !== grupo){
      if (grupo !== null) html += `</div><div class="nav">`;
      html += `</div><div class="grupo">${s.grupo}</div><div class="nav"><span class="bolha" style="display:none"></span>`;
      grupo = s.grupo;
    }
    const atual = (tela || "visao") === s.k;
    html += `<button class="item${atual?" on":""}" data-tela="${s.k}" title="${esc(TIT[s.k][1])}">
      <span class="ic">${ico(s.ic)}</span><span class="rot">${s.rot}</span>
      ${IND[s.k] ? `<span class="vl">${IND[s.k]}</span>` : ""}</button>`;
  });
  html += `</div>`;
  /* uma bolha só: a do grupo que contém o item aberto */
  $("#nav").innerHTML = html.replace(/^<\/div>/, "");
  $$("#nav .nav").forEach(n => {
    const b = n.querySelector(".bolha"), a = n.querySelector(".item.on");
    if (!b) return;
    if (!a){ b.style.display = "none"; return; }
    b.style.display = "";
    const rn = n.getBoundingClientRect(), ra = a.getBoundingClientRect();
    b.style.height = ra.height + "px";
    b.style.transform = `translateY(${ra.top - rn.top}px)`;
    b.style.opacity = 1;
  });
  $("#chaves").innerHTML = SECOES.filter(s => !FIXAS.has(s.k)).map(s =>
    `<button class="chave${off.has(s.k)?"":" on"}" data-sec="${s.k}">${s.rot}</button>`).join("");
}

/* os números que aparecem ao lado do nome de cada seção */
let IND = {};
function montaIndicadores(){
  const r = DADOS.resumo[periodo] || {};
  const compras = comprasDoPeriodo();
  const total = compras.reduce((a,c) => a + (+c.valor||0), 0);
  const cRec = comprasDoPeriodo("recuperacao"), cPag = comprasDoPeriodo("trafego");
  IND = {
    vendas: dadosVendasBrutos() ? "R$ " + curto(parte(total)) : (VENDAS_CARREGANDO ? "…" : "–"),
    plat:   dadosVendasBrutos() ? String(new Set(compras.map(c => origemDe(c.origem))).size) : "",
    pago:   cPag.length ? "R$ " + curto(parte(cPag.reduce((a,c)=>a+(+c.valor||0),0), "trafego")) : "0",
    recup:  cRec.length ? "R$ " + curto(parte(cRec.reduce((a,c)=>a+(+c.valor||0),0), "recuperacao")) : "0",
    publico: curto(r.views || 0),
    videos: nf(linhas().length),
    hist:   (() => { const u = ultimoMesVendas() || ultimoMesFechado(); return u ? "R$ " + curto(parte(u.m.liquido)) : ""; })(),
  };
}

function montaPeriodos(){
  const ORDEM = ["hoje","ontem","mes","7","28","60","90","365"];
  const vis = k => DADOS.janelas[k] && !DADOS.janelas[k].oculta;
  const chaves = ORDEM.filter(vis)
    .concat(Object.keys(DADOS.janelas).filter(k => !ORDEM.includes(k) && vis(k)));
  if (!chaves.includes(periodo)) periodo = chaves.includes("90") ? "90" : chaves[chaves.length-1];
  $("#periodos").innerHTML = `<span class="desl"></span>` + chaves.map(k =>
    `<button data-p="${k}" class="${k===periodo?"on":""}" title="${esc(faixaDoPeriodo(k))}">
      ${NOME_PERIODO[k] || k}</button>`).join("");
  requestAnimationFrame(() => moveDeslizante("periodos"));
}

/* ——— o desenho ——— */
const TELAS = {
  visao: telaVisao, vendas: telaVendas, hist: telaHistorico, plat: telaPlataformas,
  pago: () => telaCanal("trafego"), recup: () => telaCanal("recuperacao"),
  publico: telaPublico, videos: telaVideos, ideias: telaIdeias, radar: telaRadar, conc: telaConcorrencia,
};
function desenhar(){
  if (typeof DADOS === "undefined") return semDados();
  const k = tela || "visao";
  montaIndicadores();
  montaNav();
  montaPeriodos();

  const [t, s] = TIT[k] || TIT.visao;
  $("#tituloTela").textContent = t;
  /* Duas réguas, e as duas aparecem: a venda chega na hora, o YouTube fecha o dia com 2–3 dias
     de atraso. Antes só aparecia a do YouTube ("até 15/09") em cima de um gráfico de vendas
     que ia até hoje (18/09) — parecia erro. */
  const fv = faixaVendas(), fy = faixaDoPeriodo(periodo);
  $("#subTela").textContent = s + " · " + (NOME_PERIODO[periodo] || periodo)
    + (fv ? " · vendas " + fv : "") + (fy ? " · YouTube " + fy : "");
  $("#subTela").title = "As vendas chegam na hora. O YouTube só fecha cada dia com 2 a 3 dias de atraso"
    + " — por isso a régua dele termina antes.";

  const alvo = $("#tela");
  alvo.classList.remove("entra");
  void alvo.offsetWidth;                       // força o navegador a reiniciar a animação
  window._faisca = window._faiscaMeses = window._histDias = null;
  alvo.innerHTML = (TELAS[k] || telaVisao)();
  alvo.classList.add("entra");

  /* religa o que nasceu junto com o HTML */
  ligarDinheiro(); ligarHoras(); ligarMomento(); ligarHistorico(); ligarFaisca();
  ligaSegmento("gdinmodo", v => { gDin = v; desenhar(); });
  ligaSegmento("gmommodo", v => { gMom = v; desenhar(); });
  ligaSegmento("modos", v => { modo = v; ordem = ORDEM_PADRAO[v]; limite = 40;
                               guardar("painel-modo", v); desenhar(); });
  $$("#tela [data-tela]").forEach(b => b.onclick = () => irPara(b.dataset.tela));
  $$("#tela [data-vid]").forEach(b => b.onclick = e => {
    if (e.target.closest("a")) return;
    abrir(b.dataset.vid);
  });
  $$("#tela th[data-c]").forEach(th => th.onclick = () => { ordem = th.dataset.c; limite = 40; desenhar(); });
  const bm = $("#btMais"); if (bm) bm.onclick = () => { limite += 60; desenhar(); };
  animaNumeros();
  gravarURL();
}
function ligaSegmento(id, fn){
  const seg = $("#"+id); if (!seg) return;
  seg.querySelectorAll("button").forEach(b => b.onclick = () => {
    fn(b.dataset.g || b.dataset.modo || b.textContent.trim());
  });
}
function irPara(k){
  if (!k || !TELAS[k]) return;
  tela = (k === "visao") ? null : k;
  limite = 40;
  desenhar();
  if (window.scrollY > 0) window.scrollTo({top:0, behavior:"smooth"});
}

/* ——— números que contam até o valor, como no iOS ——— */
function animaNumeros(){
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  $$("#tela .val.num").forEach(el => {
    const txt = el.textContent.trim();
    const m = txt.match(/^(\D*)([\d.]+)(,\d+)?(.*)$/);
    if (!m) return;
    const alvo = parseInt(m[2].replace(/\./g, ""), 10);
    if (!isFinite(alvo) || alvo < 10) return;
    const html = el.innerHTML;
    const dur = 620, t0 = performance.now();
    const passo = agora => {
      const p = Math.min(1, (agora - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);                       // desacelera no fim
      if (p < 1){
        el.textContent = m[1] + Math.round(alvo * e).toLocaleString("pt-BR") + (m[3]||"") + (m[4]||"");
        requestAnimationFrame(passo);
      } else el.innerHTML = html;
    };
    requestAnimationFrame(passo);
  });
}

function semDados(){
  $("#subCanal").textContent = "sem dado ainda";
  $("#tela").innerHTML = `<div class="cart">${vazioG("Ainda não tem dado coletado.",
    "Dê dois cliques em <b>“0 - ATUALIZAR TUDO.command”</b>, na pasta do projeto.")}</div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   ENDEREÇO, ATALHOS E CONTROLES
   ══════════════════════════════════════════════════════════════════════════ */
function gravarURL(){
  const alvo = "#" + (tela || "visao") + "/" + periodo;
  if (location.hash === alvo) return;
  _mexendoURL = true;
  try { history.replaceState(null, "", alvo); } catch(e){}
  _mexendoURL = false;
}
function lerURL(){
  const h = (location.hash || "").replace(/^#/, "");
  if (!h) return false;
  const [k, p] = h.split("/");
  let mudou = false;
  if (k && TELAS[k] && secaoLigada(k)){ tela = (k === "visao") ? null : k; mudou = true; }
  if (p && DADOS.janelas && DADOS.janelas[p]){ periodo = p; guardar("painel-periodo", p); mudou = true; }
  return mudou;
}

function ligarAtalhos(){
  const ORDEM_P = ["hoje","ontem","mes","7","28","60","90","365"];
  document.addEventListener("keydown", ev => {
    const alvo = ev.target;
    const digitando = alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable);
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "Escape" && digitando && alvo.id === "busca"){
      alvo.value = ""; $("#busca").hidden = true; $("#btBusca").classList.remove("on"); desenhar(); return;
    }
    if (digitando) return;
    if (document.querySelector("dialog[open]")) return;
    if (ev.key === "/"){ ev.preventDefault(); $("#btBusca").click(); return; }
    if (ev.key === "e" || ev.key === "E"){ baixarCSV(); return; }
    if (ev.key === "t" || ev.key === "T"){ trocarTema(); return; }
    if (ev.key === "?"){ abrirAjuda(); return; }
    const n = parseInt(ev.key, 10);
    if (n >= 1 && n <= 8){
      const k = ORDEM_P[n-1];
      if (DADOS.janelas && DADOS.janelas[k] && !DADOS.janelas[k].oculta){
        periodo = k; limite = 40; guardar("painel-periodo", k); desenhar();
      }
      return;
    }
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft"){
      const vis = SECOES.filter(s => secaoLigada(s.k)).map(s => s.k);
      const i = vis.indexOf(tela || "visao");
      irPara(vis[(i + (ev.key === "ArrowRight" ? 1 : -1) + vis.length) % vis.length]);
    }
  });
}

function trocarTema(){
  const atual = document.documentElement.dataset.tema
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro");
  const novo = atual === "escuro" ? "claro" : "escuro";
  document.documentElement.dataset.tema = novo;
  guardar("painel-tema", novo);
  pintaIconeTema();
  if (typeof DADOS !== "undefined") desenhar();
}
function pintaIconeTema(){
  const escuro = (document.documentElement.dataset.tema
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro")) === "escuro";
  const el = $("#icTema");
  if (el) el.innerHTML = ico(escuro ? "sol" : "lua");
}

function abrirAjuda(){
  $("#folhaAjuda").innerHTML = `
    <button class="fecha" style="top:16px;right:16px;background:var(--carta-3);color:var(--t2)"
      onclick="modalAjuda.close()"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="mcab"><h3>Como ler este painel</h3>
      <div class="mt">o que cada número quer dizer, e o que ele não diz</div></div>
    <div class="mcorpo" style="font-size:13.5px;line-height:1.65;color:var(--t2)">
      <div class="msec" style="margin-top:4px;padding-top:0;border:0">
        <h4>A pergunta que este painel responde</h4>
        De onde veio a venda. Toda venda que entra carrega o <code style="font-size:12px">utm_content</code>
        do vídeo e o <code style="font-size:12px">utm_source</code> da plataforma. É isso que permite dizer
        “esta venda veio deste vídeo, no YouTube” — e não só “vendeu”.
      </div>
      <div class="msec"><h4>Sua parte</h4>
        Todo dinheiro de venda aparece com <b>a sua parte em cima, grande</b> — ${pctParte()}% do líquido da Assiny —
        e <b>o total da venda embaixo</b>, pequeno. O percentual fica em <code>dados/vendas/canais.js</code>.
        AdSense não é dividido: ele é todo seu.
      </div>
      <div class="msec"><h4>Comparação</h4>
        Tudo é comparado contra o próprio canal. A pílula ao lado de cada número mostra a variação:
        para <b>vendas</b>, contra o mesmo número de dias imediatamente anterior; para <b>métricas do
        YouTube</b>, contra o ritmo por dia do resto do ano. Abaixo de 3% de diferença, o painel diz
        “igual” em vez de pintar de verde ou vermelho.
      </div>
      <div class="msec"><h4>Dois relógios diferentes</h4>
        A <b>venda</b> chega ao vivo, hoje. A <b>métrica do YouTube</b> fecha com 1 a 3 dias de atraso.
        Por isso “Hoje” quase sempre mostra venda e não mostra view — e isso não é erro.
      </div>
      <div class="msec"><h4>Moeda</h4>
        O AdSense fica no valor original que o YouTube entrega (dólar). O real é convertido
        <b>dia a dia, cada dia pela cotação daquele dia</b> — não pela cotação de hoje aplicada ao ano
        inteiro. Passe o mouse no valor pra ver a taxa usada.
      </div>
      <div class="msec"><h4>“–” não é zero</h4>
        Traço quer dizer <b>não dá pra saber</b>: o vídeo não está marcado, ou a medição ainda não tem
        tempo de estrada. Zero quer dizer zero mesmo. Os dois nunca se misturam.
      </div>
      <div class="msec"><h4>Atalhos</h4>
        <b>1</b>…<b>8</b> trocam o período · <b>←</b> <b>→</b> andam entre as seções ·
        <b>/</b> abre o filtro · <b>E</b> baixa o CSV · <b>T</b> troca o tema ·
        <b>?</b> abre este texto · <b>Esc</b> fecha.
      </div>
      <div class="msec"><h4>Seções</h4>
        Cada seção liga e desliga no botão <b>⋯ → Seções visíveis</b>. Desligar só tira da tela:
        a coleta continua rodando e o dado continua sendo guardado.
      </div>
      <div class="msec"><h4>O que este painel não tem</h4>
        Impressões e CTR de capa não existem na API do YouTube — só no export manual do Studio.
        E venda anterior a ${dt(inicioTracking())} não tem como ser atribuída a vídeo nenhum:
        antes dessa data o link era o mesmo em todos.
      </div>
    </div>`;
  modalAjuda.showModal();
}

/* ══════════════════════════════════════════════════════════════════════════
   PARTIDA
   ══════════════════════════════════════════════════════════════════════════ */
function iniciar(){
  (function tema(){
    let t = null; try { t = localStorage.getItem("painel-tema"); } catch(e){}
    if (t) document.documentElement.dataset.tema = t;
    pintaIconeTema();
  })();

  if (typeof DADOS === "undefined") return semDados();
  const c = DADOS.canal;
  $("#nomeCanal").textContent = c.titulo;
  /* a foto do canal entra no lugar das iniciais. Se a coleta ainda for antiga (sem foto)
     ou a imagem não carregar, as iniciais voltam sozinhas — nunca fica um buraco. */
  if (c.foto){
    const sig = document.querySelector(".marca .sig");
    if (sig){
      const img = new Image();
      img.src = c.foto; img.alt = ""; img.loading = "eager";
      img.onload = () => { sig.classList.add("foto"); sig.innerHTML = ""; sig.appendChild(img); };
    }
  }
  $("#subCanal").textContent = nf(c.inscritos) + " inscritos";
  $("#subCanal").title = `${nf(c.videos)} vídeos na contagem pública do canal · `
    + `dados até ${dt(DADOS.dado_ate)} · coleta de ${dt(DADOS.gerado_em.slice(0,10))} ${DADOS.gerado_em.slice(11,16)}`;

  $("#btTema").onclick  = trocarTema;
  $("#mitTema").onclick = () => { trocarTema(); fecharMenu(); };
  $("#btAjuda").onclick = abrirAjuda;
  $("#mitAjuda").onclick = () => { abrirAjuda(); fecharMenu(); };
  $("#btBaixar").onclick = baixarCSV;
  $("#mitBaixar").onclick = () => { baixarCSV(); fecharMenu(); };
  $("#vivo").onclick = () => buscarVendas(false);

  $("#btBusca").onclick = () => {
    const b = $("#busca");
    b.hidden = !b.hidden;
    $("#btBusca").classList.toggle("on", !b.hidden);
    if (!b.hidden) b.focus(); else { b.value = ""; desenhar(); }
  };
  let tBusca;
  $("#busca").oninput = () => { clearTimeout(tBusca); tBusca = setTimeout(() => {
    limite = 40; if (!tela) tela = "videos"; desenhar(); }, 180); };

  $("#btMenu").onclick = ev => {
    ev.stopPropagation();
    const m = $("#menu");
    m.hidden = !m.hidden;
    $("#btMenu").classList.toggle("on", !m.hidden);
    if (!m.hidden) marcaModo();
  };
  document.addEventListener("click", ev => {
    const m = $("#menu");
    if (m && !m.hidden && !m.contains(ev.target) && ev.target !== $("#btMenu")) fecharMenu();
  });
  $("#menu").addEventListener("click", ev => {
    const sec = ev.target.closest("[data-sec]");
    if (sec){ alternarSecao(sec.dataset.sec); marcaModo(); return; }
    const md = ev.target.closest("[data-modo]");
    if (md){ modo = md.dataset.modo; ordem = ORDEM_PADRAO[modo]; limite = 40;
             guardar("painel-modo", modo); marcaModo(); desenhar(); }
  });

  $("#periodos").onclick = ev => {
    const b = ev.target.closest("[data-p]"); if (!b) return;
    periodo = b.dataset.p; limite = 40; guardar("painel-periodo", periodo);
    desenhar();
  };
  $("#nav").onclick = ev => {
    const b = ev.target.closest("[data-tela]"); if (!b) return;
    irPara(b.dataset.tela);
  };

  [modalVideo, modalVendas, modalAjuda].forEach(d => {
    d.addEventListener("click", e => { if (e.target === d) d.close(); });
  });
  modalVideo.addEventListener("close", () => {
    matarPlayer(); videoAberto = null;
    const p = $("#palco"); if (p){ p.innerHTML = ""; p.classList.remove("tocando"); }
  });

  ordem = ORDEM_PADRAO[modo] || "views";
  lerURL();
  window.addEventListener("hashchange", () => { if (!_mexendoURL && lerURL()) desenhar(); });
  window.addEventListener("resize", () => { moveDeslizante("periodos"); montaNav(); });
  ligarAtalhos();
  desenhar();
}
function fecharMenu(){ $("#menu").hidden = true; $("#btMenu").classList.remove("on"); }
function marcaModo(){
  const v = `<span style="color:var(--ac);font-weight:700">✓</span>`;
  $("#chkPrincipal").innerHTML = modo === "principal" ? v : "";
  $("#chkTudo").innerHTML      = modo === "tudo" ? v : "";
}

/* vendas ao vivo: cache primeiro (a tela abre com dado), busca depois */
(function aoVivo(){
  if (vendasDoCache()) setTimeout(() => { try { desenhar(); } catch(e){} }, 0);
  setTimeout(() => buscarVendas(true), 60);
  setInterval(() => buscarVendas(true), 120000);
})();

/* rede de segurança: se alguma coisa quebrar, o painel DIZ o que quebrou
   em vez de ficar numa tela branca */
try { iniciar(); }
catch (e){
  const el = document.getElementById("tela");
  if (el) el.innerHTML = `<div class="cart"><div class="vaz">
    <b>O painel não conseguiu abrir.</b>
    <div style="font-family:ui-monospace,monospace;font-size:12px;color:var(--neg);margin:10px 0;
      text-align:left;background:var(--carta-2);padding:12px;border-radius:10px">${
      String(e && e.message || e)}</div>
    Isso costuma ser dado faltando ou pela metade. Rode
    <b>“0 - ATUALIZAR TUDO.command”</b> e abra de novo.</div></div>`;
  console.error(e);
}
