import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { cluster, bias, category, keepFootball } from '../scripts/lib.mjs';

const feeds = [{ name: 'A', bias: 'izq' }, { name: 'B', bias: 'cen-izq' }, { name: 'C', bias: 'cen' }, { name: 'D', bias: 'der' }];
test('barra de sesgo: centro-izquierda no cuenta como centro; duplicados y desconocidos aparte', () => {
  const r = bias([{ medio: 'A' }, { medio: 'A' }, { medio: 'B' }, { medio: 'C' }, { medio: 'D' }, { medio: 'Z' }], feeds);
  assert.deepEqual([r.medios, r.izquierda, r.centro, r.derecha, r.desconocidos], [5, 50, 25, 25, 1]);
  assert.equal(bias([{ medio: 'A' }, { medio: 'Z' }], feeds).suficiente, false);
});
test('agrupa el mismo hecho y separa temas distintos', () => {
  const t = Date.now(), g = cluster([
    { titulo: 'El Gobierno aprueba el decreto de vivienda en el Consejo de Ministros', fecha: t },
    { titulo: 'Consejo de Ministros aprueba decreto de vivienda del Gobierno', fecha: t - 1 },
    { titulo: 'Alcaraz gana el torneo de Valencia', fecha: t - 2 }]);
  assert.deepEqual(g.map(x => x.length).sort(), [1, 2]);
});
const fc = (n, titulo) => ({ cat: 'futbol', fuentes: Array.from({ length: n }, (_, i) => ({ medio: 'M' + i, titulo })) });
test('fútbol: umbral alto en general, menor en España y fichajes, descarta juveniles', () => {
  assert.equal(keepFootball(fc(3, 'Gol de la Bundesliga')), false);
  assert.equal(keepFootball(fc(4, 'Gol de la Bundesliga')), true);
  assert.equal(keepFootball(fc(2, 'El Real Madrid gana en LaLiga')), true);
  assert.equal(keepFootball(fc(3, 'Fichaje bomba por un delantero')), true);
  assert.equal(keepFootball(fc(6, 'Real Madrid juvenil gana la copa')), false);
});
test('categorías', () => {
  assert.equal(category('Zelenski pide más defensa aérea'), 'geopolitica');
  assert.equal(category('El Ibex 35 cierra al alza'), 'economia');
  assert.equal(category('Tema sin palabras clave', 'espana'), 'espana');
});
test('ninguna clave secreta en los archivos públicos', () => {
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
  for (const f of walk('public')) assert.doesNotMatch(readFileSync(f, 'utf8'), /ghp_|github_pat_|sk-ant-/);
});

import { imgFrom, parse, limitar, pickDigest, corto, iconoOK } from '../scripts/lib.mjs';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('sesgo con una sola fuente: se marca como única, no como muestra vacía', () => {
  const r = bias([{ medio: 'A' }], feeds);
  assert.equal(r.unica, true); assert.equal(r.suficiente, false);
  assert.equal(bias([{ medio: 'A' }, { medio: 'D' }], feeds).suficiente, true);
});
test('imágenes: solo las que publica el medio, https, sin vídeo ni píxeles', () => {
  assert.equal(imgFrom('<media:content url="http://x.com/a.jpg" medium="image"/>'), 'https://x.com/a.jpg');
  assert.equal(imgFrom('<enclosure url="https://x.com/v.mp4" type="video/mp4"/>'), null);
  assert.equal(imgFrom('<description><![CDATA[<img src="https://x.com/foto.jpg?a=1&amp;b=2"> texto]]></description>'), 'https://x.com/foto.jpg?a=1&b=2');
  assert.equal(imgFrom('<description>sin imagen</description>'), null);
});
test('parse: RSS con fecha futura o sin enlace se descarta', () => {
  const now = Date.now(), d = new Date(now - 6e4).toUTCString();
  const x = `<rss><channel><item><title>Hola &amp; adiós</title><link>https://a.es/1</link><pubDate>${d}</pubDate><description>Resumen</description></item><item><title>Sin enlace</title><pubDate>${d}</pubDate></item><item><title>Futuro</title><link>https://a.es/2</link><pubDate>${new Date(now + 9e7).toUTCString()}</pubDate></item></channel></rss>`;
  const r = parse(x, { name: 'A' }, now);
  assert.equal(r.length, 1); assert.equal(r[0].titulo, 'Hola & adiós');
});
const cc = (id, cat, n, score, ultima = 1) => ({ id, cat, score, ultima, primera: ultima, fuentes: Array.from({ length: n }, (_, i) => ({ medio: 'M' + i })) });
test('relevancia: máximo por ámbito y se prefieren las contrastadas', () => {
  const cl = [...Array.from({ length: 12 }, (_, i) => cc('m' + i, 'ue', 3, 20 - i)), cc('solo', 'ue', 1, 1)];
  const r = limitar(cl, 10);
  assert.equal(r.length, 10); assert.ok(!r.find(c => c.id === 'solo') && r.find(c => c.id === 'm0'));
  assert.ok(limitar([cc('a', 'cultura', 1, 1), cc('b', 'cultura', 2, 2)]).length === 2); // pocas contrastadas: se conserva la de una fuente
});
test('resumen 8:00: una por ámbito, solo últimas 8 h', () => {
  const now = Date.now(), h = 36e5;
  const cl = [cc('g1', 'geopolitica', 3, 5, now - h), cc('g2', 'geopolitica', 6, 9, now - 2 * h), cc('g3', 'geopolitica', 9, 99, now - 12 * h), cc('e1', 'economia', 2, 3, now - h), cc('c1', 'cultura', 5, 9, now - h)];
  const r = pickDigest(cl, now, 8);
  assert.deepEqual(r.map(x => x.c.id), ['g2', 'e1']); // sin China/Asia no se inventa; g3 es demasiado antigua
});

test('flujo completo sin red: agrupa, imagen, sesgo, relevancia y 3 avisos ntfy', async () => {
  const dir = mkdtempSync(tmpdir() + '/np-'), now = Date.now();
  const it = (t, m, img, min) => `<item><title>${t}</title><link>https://${m}.es/${encodeURIComponent(t).slice(0, 20)}</link><pubDate>${new Date(now - min * 6e4).toUTCString()}</pubDate><description>${t}. Más detalles de la noticia.</description>${img ? `<media:content url="${img}" medium="image"/>` : ''}</item>`;
  const feed = items => `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel>${items.join('')}</channel></rss>`;
  const G = ['Israel y Hamás acuerdan una tregua de cinco días en Gaza', 'Tregua de cinco días en Gaza: Israel y Hamás alcanzan un acuerdo', 'Acuerdo de tregua en Gaza entre Israel y Hamás por cinco días'];
  const E = ['El Banco Central Europeo mantiene los tipos de interés', 'El Banco Central Europeo deja los tipos de interés sin cambios'];
  const C = ['Pekín y Tokio retoman el diálogo comercial tras dos años de tensión', 'Tokio y Pekín retoman el diálogo comercial tras dos años'];
  writeFileSync(dir + '/abc.xml', feed([it(G[0], 'abc', 'https://img.abc.es/g.jpg', 30), it(E[0], 'abc', null, 40), it(C[0], 'abc', null, 50)]));
  writeFileSync(dir + '/20minutos.xml', feed([it(G[1], '20m', null, 20), it(E[1], '20m', null, 35), it(C[1], '20m', 'https://img.20m.es/c.jpg', 45)]));
  writeFileSync(dir + '/rtve.xml', feed([it(G[2], 'rtve', null, 10)]));
  const got = [];
  const srv = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => { got.push(JSON.parse(b)); r.end('{}'); }); });
  await new Promise(r => srv.listen(0, r));
  const env = { ...process.env, FEEDS_DIR: dir, OUT_DIR: dir + '/out', NTFY_TOPIC: 'prueba', SITE_URL: 'https://x.github.io/Np', FORCE_DIGEST: 'true', NTFY_URL: `http://127.0.0.1:${srv.address().port}/`, GITHUB_TOKEN: '' };
  await promisify(execFile)('node', ['scripts/build.mjs'], { env });
  srv.close();
  const D = JSON.parse((await import('node:fs')).readFileSync(dir + '/out/news.json', 'utf8'));
  const g = D.clusters.find(c => c.cat === 'geopolitica');
  assert.equal(g.fuentes.length, 3); assert.equal(g.img.url, 'https://img.abc.es/g.jpg');
  assert.equal(g.bias.suficiente, true); assert.equal(g.articulo.tipo, 'basico');
  assert.deepEqual(D.clusters.map(c => c.ultima), [...D.clusters.map(c => c.ultima)].sort((a, b) => b - a)); // orden de actualización
  assert.equal(got.length, 3);
  assert.deepEqual([/Gaza/, /Banco Central/, /Pek|Tokio/].map((re, i) => re.test(got[i].title)), [true, true, true]); // titular = título del aviso
  assert.equal(got[0].message, 'Más detalles de la noticia.');                                                         // resumen sin repetir el titular
  assert.equal(got[0].icon, 'https://img.abc.es/g.jpg');                                                                // foto de la noticia
  assert.equal(got[1].icon, 'https://x.github.io/Np/icon-192.png');                                                    // sin foto: logo de Newspaper
  assert.ok(got.every(x => x.click.startsWith('https://x.github.io/Np/#/n/') && x.topic === 'prueba' && !x.attach && x.message.length <= 131));
});

test('texto del aviso: recorta sin cortar palabras y no repite el titular', () => {
  assert.equal(corto('Tregua en Gaza. Se acuerdan cinco días de alto el fuego', 'Tregua en Gaza'), 'Se acuerdan cinco días de alto el fuego');
  const c = corto('palabra '.repeat(40), '', 60); assert.ok(c.length <= 60 && c.endsWith('…') && !c.includes('palabr…'));
  assert.equal(corto('', 'x'), '');
});
test('icono: solo JPEG/PNG por https', () => {
  assert.equal(iconoOK('https://a.es/f.jpg?w=1'), true); assert.equal(iconoOK('https://a.es/f.webp'), false); assert.equal(iconoOK('http://a.es/f.png'), false); assert.equal(iconoOK(null), false);
});
