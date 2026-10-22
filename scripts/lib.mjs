export const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const STOP = new Set('de la el en y a los las del se que por con un una para su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto antes algunos unos yo otro otras otra tanto esa estos mucho nada muchos cual poco ella estar estas algunas algo tras segun'.split(' '));
export const tokens = t => new Set(norm(t).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));
const shared = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
const jacc = (a, b) => { const i = shared(a, b); return i / (a.size + b.size - i || 1); };

// Agrupa noticias que hablan del mismo hecho (titulares con vocabulario muy parecido).
export function cluster(items, th = 0.34) {
  const out = [];
  for (const it of [...items].sort((a, b) => b.fecha - a.fecha)) {
    const tk = tokens(it.titulo);
    let best = null, bs = 0;
    for (const c of out) for (const t of c.tk) {
      const s = jacc(tk, t);
      if (s > bs && shared(tk, t) >= 2) { bs = s; best = c; }
    }
    if (best && bs >= th) { best.items.push(it); best.tk.push(tk); } else out.push({ items: [it], tk: [tk] });
  }
  return out.map(c => c.items);
}

const IZQ = ['izq', 'cen-izq'], DER = ['der', 'cen-der'];
// Reparto por orientación editorial. Un voto por medio; sin clasificar = "desconocido", nunca "centro".
export function bias(items, feeds) {
  const seen = new Map();
  for (const it of items) if (!seen.has(it.medio)) seen.set(it.medio, feeds.find(f => f.name === it.medio)?.bias || 'desconocido');
  const c = { izquierda: 0, centro: 0, derecha: 0, desconocido: 0 };
  for (const b of seen.values()) IZQ.includes(b) ? c.izquierda++ : DER.includes(b) ? c.derecha++ : b === 'cen' ? c.centro++ : c.desconocido++;
  const n = c.izquierda + c.centro + c.derecha;
  const izq = n ? Math.round(c.izquierda * 100 / n) : 0, der = n ? Math.round(c.derecha * 100 / n) : 0;
  return { medios: seen.size, clasificados: n, desconocidos: c.desconocido, izquierda: izq, centro: n ? 100 - izq - der : 0, derecha: der, suficiente: n >= 2, unica: n === 1, lista: [...seen].map(([medio, b]) => ({ medio, bias: b })) };
}

const KW = [
  ['tenis', /\btenis|atp\b|wta\b|roland garros|wimbledon|us open|alcaraz|djokovic|sinner/],
  ['futbol', /futbol|laliga|champions|premier league|bundesliga|serie a\b|ligue 1|real madrid|barca|atletico|fichaje|traspaso|seleccion espanola/],
  ['economia', /\bibex|bolsa|mercados?|euribor|inflacion|\bipc\b|banco central|\bbce\b|tipos de interes|prima de riesgo|petroleo/],
  ['empresas', /empresa|beneficios|resultados trimestrales|opa\b|multinacional|compania|fusion|despidos|ere\b/],
  ['tecnologia', /inteligencia artificial|openai|anthropic|chatgpt|google|apple|microsoft|nvidia|ciberataque|software|startup|\bia\b/],
  ['ciencia', /cientific|nasa|astronom|investigadores|\bcsic\b|descubr|climatic|vacuna|fisica|biologia/],
  ['cultura', /\bcine|pelicula|serie de|exposicion|museo|pintura|pintor|\barte\b|premio goya|festival de|novela|concierto/],
  ['china', /\bchina\b|chino|pekin|xi jinping|taiwan|japon|corea|\bindia\b|\basia\b|asiatic|filipinas|vietnam|indonesia|singapur|hong kong/],
  ['eeuu', /trump|casa blanca|eeuu|estados unidos|washington|republican|democrata/],
  ['ue', /bruselas|comision europea|parlamento europeo|union europea|eurogrupo|von der leyen/],
  ['geopolitica', /ucrania|rusia|putin|iran|israel|gaza|hamas|hezbola|oriente medio|\botan\b|libano|siria|yemen|zelenski/],
  ['alicante', /alicante|elche|benidorm|torrevieja|orihuela|comunitat valenciana|comunidad valenciana/],
];
export function category(text, hint = 'mundo') {
  const t = norm(text);
  for (const [k, re] of KW) if (re.test(t)) return k;
  return hint;
}

export const outletsOf = c => new Set(c.fuentes.map(s => s.medio)).size;
export const score = (c, agencias) => outletsOf(c) + (c.fuentes.some(s => agencias.has(s.medio)) ? 2 : 0);

// Fútbol con menos peso: solo lo muy cubierto; algo más de apertura para España y fichajes.
export function keepFootball(c) {
  if (c.cat !== 'futbol') return true;
  const t = norm(c.fuentes.map(s => s.titulo).join(' '));
  if (/\b(juvenil|cadete|infantil|sub-?\d{2}|cantera)\b/.test(t)) return false;
  const spain = /laliga|real madrid|barca|atletico|seleccion espanola|sevilla|valencia|villarreal|athletic|betis|real sociedad/.test(t);
  const fich = /fichaje|traspaso|ficha por|cesion|clausula|renovacion|renueva/.test(t);
  return outletsOf(c) >= (spain ? 2 : fich ? 3 : 4);
}

// ---- RSS ----
export const dec = s => (s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export const tag = (x, n) => x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'))?.[1];
const attr = (t, n) => t.match(new RegExp(`${n}=["']([^"']+)["']`, 'i'))?.[1];
// Imagen que el propio medio publica en su RSS (nunca se inventa ni se busca fuera).
export function imgFrom(b) {
  const c = [];
  for (const t of b.match(/<(media:content|media:thumbnail|enclosure)\b[^>]*>/gi) || []) {
    const u = attr(t, 'url'), ty = (attr(t, 'type') || '') + (attr(t, 'medium') || '');
    if (u && !/video|audio/i.test(ty) && (/image/i.test(ty) || /\.(jpe?g|png|webp)(\?|$)/i.test(u) || /media:thumbnail/i.test(t))) c.push(u);
  }
  const im = b.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  if (im) c.push(im);
  return c.map(x => x.replace(/&amp;/g, '&').replace(/^http:/, 'https:')).find(x => /^https:\/\//.test(x) && !/pixel|track|1x1|logo/i.test(x)) || null;
}
export function parse(xml, f, now) {
  const out = [];
  for (const b of xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || []) {
    const titulo = dec(tag(b, 'title')), url = dec(tag(b, 'link')) || b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    const fecha = Date.parse(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date') || '');
    if (!titulo || !url || !isFinite(fecha) || fecha > now + 36e5) continue;
    out.push({ medio: f.name, titulo, url, fecha, resumen: dec(tag(b, 'description') || tag(b, 'summary')).slice(0, 700), img: imgFrom(b) });
  }
  return out;
}

// Orden de "centralidad" editorial: se usa para elegir la fuente principal.
export const ORD = ['cen', 'cen-izq', 'cen-der', 'izq', 'der'];

// Relevancia: por ámbito se conservan solo las más cubiertas (máx. `max`); las de un solo medio solo si hay pocas contrastadas.
export function limitar(cl, max = 10) {
  const por = {}; for (const c of cl) (por[c.cat] ??= []).push(c);
  const keep = new Set();
  for (const arr of Object.values(por)) {
    const multi = arr.filter(c => outletsOf(c) >= 2);
    (multi.length >= 3 ? multi : arr).sort((a, b) => b.score - a.score || b.ultima - a.ultima).slice(0, max).forEach(c => keep.add(c.id));
  }
  return cl.filter(c => keep.has(c.id));
}

// Resumen de las 08:00: una noticia por bloque (geopolítica, economía, China/Asia) de las últimas `horas` horas.
export const DIGEST = [['geopolitica', 'Geopolítica mundial'], ['economia', 'Economía mundial'], ['china', 'China y Asia']];
export function pickDigest(cl, now, horas = 8) {
  const lim = now - horas * 36e5, out = [];
  for (const [cat, label] of DIGEST) {
    const c = cl.filter(x => x.cat === cat && x.primera > lim).sort((a, b) => b.score - a.score || b.ultima - a.ultima)[0];
    if (c) out.push({ label, c });
  }
  return out;
}

// ---- Avisos: texto corto y icono ----
// Resumen breve para el aviso: sin repetir el titular y cortado en una palabra completa.
export function corto(texto, titulo = '', max = 130) {
  let t = (texto || '').replace(/\s+/g, ' ').trim();
  const nt = norm(titulo).replace(/[^a-z0-9]+/g, ' ').trim();
  if (nt && norm(t).replace(/[^a-z0-9]+/g, ' ').trim().startsWith(nt)) t = t.slice(titulo.length).replace(/^[\s.:;,\-–—]+/, '');
  if (t.length <= max) return t;
  const c = t.slice(0, max - 1), i = c.lastIndexOf(' ');
  return (i > max * 0.6 ? c.slice(0, i) : c).replace(/[\s.,;:]+$/, '') + '…';
}
// ntfy solo admite iconos JPEG o PNG (no WebP/AVIF).
export const iconoOK = u => /^https:\/\/[^\s]+\.(jpe?g|png)(\?|$)/i.test(u || '');
