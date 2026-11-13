// 진짜 브라우저 ↔ 진짜 백엔드 코드(가짜 시트·Drive 위에서) 를 맞물려 돌리는 틀.  (쓰는 법: README.md)
//   - Apps Script 웹 앱 자리에 작은 HTTP 서버를 세우고, 그 안에서 Submit.gs 를 그대로 실행한다.
//   - Drive 의 이어 올리기 주소도 이 서버가 받는다 (CORS 는 진짜 Drive 처럼: 세션을 만들 때 받은 출처에만).
//   - 구글 로그인 스크립트는 누르면 정해 둔 계정으로 로그인되는 가짜로 바꾼다.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadBackend, token } from '../test/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// playwright-core 를 어디서 찾을지: PW_DIR (그 폴더의 node_modules) → 없으면 평소처럼
const require = createRequire(process.env.PW_DIR ? path.join(path.resolve(process.env.PW_DIR), 'x.js') : import.meta.url);
export const { chromium } = require('playwright-core');
export const PORT = Number(process.env.E2E_PORT || 5503);
export const SITE_PORT = PORT + 1;
// 사이트도 여기서 직접 내보낸다 (설정 파일과 구글 로그인 스크립트만 시험용으로 바꿔서).
// 브라우저의 요청 가로채기를 쓰지 않아야 CORS 사전 요청(preflight)까지 진짜처럼 오간다.
export const SITE = `http://127.0.0.1:${SITE_PORT}`;
export const API = `http://127.0.0.1:${PORT}`;
export const sha256 = (b) => createHash('sha256').update(b).digest('hex');
export const md5hex = (b) => createHash('md5').update(b).digest('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
/** 화면이 읽을 수 있는 모양의 가짜 구글 토큰. exp 는 브라우저 시계 기준(초). */
export function jwt({ email, name, sub, expInSec = 3600 }) {
  return 'e30.' + b64u(JSON.stringify({ email, name, sub, picture: '', exp: Math.floor(Date.now() / 1000) + expInSec })) + '.sig';
}

export async function startWorld({ start = '2026-11-14T08:00:00+09:00', admins = 'op@x.com' } = {}) {
  const b = loadBackend({ props: { ADMINS: admins }, tokens: {}, now: start });
  vm.runInContext(`CONFIG.ORIGINS.push(${JSON.stringify(SITE)});`, b.ctx);
  const base = Date.parse(start), t0 = Date.now();
  const w = {
    b, offset: 0, log: [], bodies: [], latency: 30, putDelay: 0,
    fault: { html: 0, noCorsUpload: false, hideRange: false, dropPut: 0, lostReply: 0, slowRelay: 0 },
    /** 서버 시계는 실제 시간과 같이 흐른다. shift(초) 로 건너뛸 수 있다. */
    tick() { b.clock.t = base + (Date.now() - t0) + w.offset; return b.clock.t; },
    shift(sec) { w.offset += sec * 1000; w.tick(); },
    at(iso) { w.offset = Date.parse(iso) - (base + (Date.now() - t0)); w.tick(); },
    /** 로그인할 수 있는 계정을 하나 만든다. → 화면에 넣을 토큰 */
    account(email, sub, name, { expInSec = 3600 } = {}) {
      const t = jwt({ email, name, sub, expInSec });
      w.tick();
      tokensRef[t] = token(email, sub, { name, exp: String(Math.floor(b.clock.t / 1000) + expInSec) });
      return t;
    },
    killSessions() { for (const k of [...b.cache.keys()]) if (k.startsWith('ss1:')) b.cache.delete(k); },
  };
  // loadBackend 가 닫아 둔 tokens 표에 나중에 계정을 더 넣을 수 있게, 가짜 fetch 를 한 겹 감싼다
  const tokensRef = {};
  const realFetch = b.ctx.UrlFetchApp.fetch;
  b.ctx.UrlFetchApp.fetch = (url, opt) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/tokeninfo')) {
      const info = tokensRef[decodeURIComponent(String(url).split('id_token=')[1])];
      return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info ?? {}), getHeaders: () => ({}), getContent: () => [] };
    }
    return realFetch(url, opt);
  };

  const read = (req) => new Promise((resolve) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => resolve(Buffer.concat(parts))); });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, API);
    const origin = req.headers.origin || '';
    try {
      w.tick();
      if (u.pathname === '/exec') {
        const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
        if (req.method === 'GET') { res.writeHead(200, cors); return res.end(JSON.stringify(b.get())); }
        const raw = (await read(req)).toString('utf8');
        let body = {};
        try { body = JSON.parse(raw); } catch {}
        if (w.latency) await sleep(w.latency);
        if (body.action === 'upload.put' && w.fault.slowRelay) await sleep(w.fault.slowRelay);
        if (w.fault.html > 0) {       // Apps Script 가 잠깐 막혔을 때처럼 HTML 을 돌려준다
          w.fault.html--;
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/html' });
          return res.end('<!doctype html><title>Error</title><p>서비스를 일시적으로 사용할 수 없습니다');
        }
        w.tick();
        const out = b.post(body);
        const text = JSON.stringify(out).replaceAll('https://www.googleapis.com/upload/', API + '/upload/');
        w.log.push({ action: body.action, by: body.sid ? 'sid' : body.idToken ? 'idToken' : body.key ? 'key' : 'none', ok: out.ok, error: out.error });
        w.bodies.push({ action: body.action, req: body.data ? { ...body, data: typeof body.data === 'string' ? `<${body.data.length} chars>` : body.data } : body, res: text.length > 4000 && body.action === 'file.get' ? text.slice(0, 300) : text });
        res.writeHead(200, cors);
        return res.end(text);
      }
      if (u.pathname.startsWith('/upload/')) {
        const real = 'https://www.googleapis.com' + u.pathname + u.search;
        if (req.method === 'OPTIONS') {
          w.log.push({ action: 'OPTIONS' });
          const s = b.drive.sessions.get(real);
          const allow = !w.fault.noCorsUpload && s && s.origin && s.origin === origin;
          res.writeHead(200, allow ? {
            'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'PUT, OPTIONS',
            'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'content-range', 'Access-Control-Max-Age': '600',
          } : {});
          return res.end();
        }
        const payload = await read(req);
        if (w.putDelay) await sleep(w.putDelay);
        // 조각이 가다가 사라졌다 (서버는 받지 못했고, 브라우저는 오류를 본다)
        if (w.fault.dropPut > 0) { w.fault.dropPut--; w.log.push({ action: 'PUT', range: req.headers['content-range'], code: 'dropped' }); res.writeHead(503, {}); return res.end(); }
        b.drive.noCors = w.fault.noCorsUpload;
        const r = b.drive.handle(req.method, real, { headers: { ...req.headers }, payload });
        // 조각은 도착했는데 응답이 돌아오지 못했다
        if (w.fault.lostReply > 0) { w.fault.lostReply--; w.log.push({ action: 'PUT', range: req.headers['content-range'], code: 'reply-lost' }); res.writeHead(502, {}); return res.end(); }
        const h = { ...(r.headers || {}) };
        if (h['Access-Control-Allow-Origin'] && !w.fault.hideRange) h['Access-Control-Expose-Headers'] = 'Range';
        w.log.push({ action: 'PUT', range: req.headers['content-range'], code: r.code });
        res.writeHead(r.code === 499 ? 204 : r.code, h);
        return res.end(r.text || '');
      }
      res.writeHead(404); res.end();
    } catch (e) {
      console.error('server error', e);
      res.writeHead(500); res.end(String(e && e.message));
    }
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  // 사이트 (저장소의 파일 그대로 + 시험용 설정 · 가짜 구글 로그인)
  const root = path.resolve(here, '../../..');
  const TYPES = { html: 'text/html; charset=utf-8', js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon', json: 'application/json', webmanifest: 'application/manifest+json', woff2: 'font/woff2', jpg: 'image/jpeg', webp: 'image/webp' };
  const site = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, SITE).pathname);
      if (p === '/__gsi.js') { res.writeHead(200, { 'Content-Type': TYPES.js }); return res.end(GIS); }
      if (p === '/assets/submit-config.js') {
        res.writeHead(200, { 'Content-Type': TYPES.js, 'Cache-Control': 'no-store' });
        return res.end(`window.EPSUBMIT = { CLIENT_ID: 'cid', ENDPOINT: ${JSON.stringify(API + '/exec')}, DEADLINE: '2026-11-14T10:00:00+09:00' };`);
      }
      if (p.endsWith('/')) p += 'index.html';
      const full = path.join(root, p);
      if (!full.startsWith(root + path.sep) || /\/\.(git|debug|claude)\//.test(p)) { res.writeHead(403); return res.end(); }
      let body = await readFile(full);
      const ext = p.split('.').pop().toLowerCase();
      if (ext === 'html') body = Buffer.from(body.toString('utf8').replaceAll('https://accounts.google.com/gsi/client', '/__gsi.js'));
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (e) { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

  w.close = () => Promise.all([server, site].map((sv) => new Promise((r) => { sv.closeAllConnections?.(); sv.close(r); })));
  return w;
}

const GIS = `
(function () {
  var cb = null;
  window.google = { accounts: { id: {
    initialize: function (o) { cb = o.callback; },
    renderButton: function (el) {
      el.innerHTML = '<button type="button" id="fake-gsi" style="font:14px sans-serif;padding:10px 18px">Google 계정으로 로그인</button>';
      el.firstChild.addEventListener('click', function () { cb({ credential: window.__cred || localStorage.getItem('__cred') }); });
    },
    prompt: function () {}, disableAutoSelect: function () { window.__auto = false; }, cancel: function () {}
  } } };
})();`;

/** CHROMIUM 에 실행 파일 경로를 주면 그것을, 아니면 playwright 가 받아 둔 크로미움을 쓴다 */
export async function openBrowser() {
  return chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
}

/** 설정과 구글 로그인을 시험용으로 바꿔 끼운 새 창 */
export async function newPage(browser, { mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile, hasTouch: mobile, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|CORS policy|blocked by CORS/i.test(m.text())) page.errs.push('console: ' + m.text()); });
  return page;
}

export async function login(page, cred) {
  await page.evaluate((c) => { window.__cred = c; }, cred);
  await page.click('#fake-gsi');
}

/** 결과 모으기 */
export function reporter() {
  const rows = [];
  const check = (name, cond, extra = '') => { rows.push({ name, ok: !!cond, extra }); console.log((cond ? '  ✔ ' : '  ✘ ') + name + (cond ? '' : '  ← ' + extra)); return !!cond; };
  const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  const match = (name, got, re) => check(name, re.test(String(got)), `got ${JSON.stringify(got)} want ${re}`);
  return { rows, check, eq, match, done() { const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length}/${rows.length} passed` + (bad.length ? ' — FAILED: ' + bad.map((r) => r.name).join(' | ') : '')); return bad.length; } };
}
