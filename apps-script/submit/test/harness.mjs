// Submit.gs + SubmitAdmin.gs 를 Apps Script 없이 돌려 보는 틀.
// 스프레드시트 · 캐시 · 잠금 · 속성 · Drive(REST) · 구글 토큰 확인을 작은 가짜로 바꿔 끼운다.
//   node --test apps-script/submit/test/
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class FakeSheet {
  constructor(name) { this.name = name; this.cells = []; this.formats = []; this.links = {}; this.reads = 0; }
  getName() { return this.name; }
  getLastRow() { let n = this.cells.length; while (n > 0 && (this.cells[n - 1] || []).join('') === '') n--; return n; }
  getLastColumn() { return this.cells.reduce((m, r) => Math.max(m, (r || []).length), 0); }
  setFrozenRows() {}
  clearContents() { this.cells = []; return this; }
  getDataRange() {
    const rows = Math.max(this.getLastRow(), 1), cols = Math.max(this.getLastColumn(), 1);
    return this.getRange(1, 1, rows, cols);
  }
  appendRow(values) {
    // 실제 appendRow 는 사람이 친 것처럼 해석한다: ' 로 시작하면 글자로 두고 ' 는 보이지 않는다
    this.cells[this.getLastRow()] = values.map((v) => {
      if (typeof v === 'string' && v.startsWith('=')) throw new Error('formula written by appendRow: ' + v);
      return typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
    });
  }
  getRange(row, col, rows = 1, cols = 1) {
    const sheet = this;
    const range = {
      getRow: () => row,
      getValues() {
        sheet.reads++;
        return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => sheet.cells[row - 1 + i]?.[col - 1 + j] ?? ''));
      },
      setValues(values) {
        values.forEach((r, i) => r.forEach((v, j) => {
          const fmt = sheet.formats[row - 1 + i]?.[col - 1 + j];
          // 텍스트 서식이 아닌 칸에 '=' 로 시작하는 글자를 쓰면 수식이 된다 — 그런 일이 있으면 시험이 깨지게 한다
          if (typeof v === 'string' && v.startsWith('=') && fmt !== '@') throw new Error(`formula written to ${sheet.name}!R${row + i}C${col + j}: ${v}`);
          (sheet.cells[row - 1 + i] ??= [])[col - 1 + j] = v;
        }));
        return range;
      },
      setValue(v) { return range.setValues([[v]]); },
      setNumberFormats(f) { f.forEach((r, i) => r.forEach((x, j) => { (sheet.formats[row - 1 + i] ??= [])[col - 1 + j] = x; })); return range; },
      setNumberFormat(f) { for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) (sheet.formats[row - 1 + i] ??= [])[col - 1 + j] = f; return range; },
      setFontWeight() { return range; },
      setRichTextValue(rt) { (sheet.cells[row - 1] ??= [])[col - 1] = rt.text; sheet.links[`${row}:${col}`] = rt.url; return range; },
      clearContent() { for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (sheet.cells[row - 1 + i]) sheet.cells[row - 1 + i][col - 1 + j] = ''; return range; },
    };
    return range;
  }
  /** 시험에서 읽기 쉽게: [{열이름: 값}] */
  objects() {
    const [head = [], ...rows] = this.cells;
    return rows.filter((r) => r && r.join('') !== '').map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  }
}

class FakeSpreadsheet {
  constructor(id, name = id) { this.id = id; this.name = name; this.sheets = new Map(); }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheetByName(n) { return this.sheets.get(n) ?? null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.set(n, s); return s; }
  getSheets() { return [...this.sheets.values()]; }
  deleteSheet(s) { this.sheets.delete(s.name); }
  /** 시험 준비용: 탭을 통째로 채운다 */
  fill(name, rows) { const s = this.sheets.get(name) ?? this.insertSheet(name); s.cells = rows.map((r) => [...r]); return s; }
}

/** Drive v3 중 이 스크립트가 쓰는 부분만 흉내 낸다. */
class FakeDrive {
  constructor() { this.folders = new Map(); this.files = new Map(); this.sessions = new Map(); this.calls = []; this.apiOff = false; this.full = false; this.plain = new Map(); this.quota = { limit: String(100 * 2 ** 30), usage: String(20 * 2 ** 30) }; this.n = 0; }
  newId(prefix = 'f') { return `${prefix}${++this.n}_${randomUUID().slice(0, 8)}`; }
  addFolder(name, parent = null, id = this.newId('d')) { this.folders.set(id, { id, name, parent, trashed: false, created: ++this.n }); return id; }
  // 진짜 DriveApp 처럼 휴지통에 든 것도 돌려준다 (걸러 내는 것은 스크립트의 몫)
  childFolders(parent, name) { return [...this.folders.values()].filter((f) => f.parent === parent && (name === undefined || f.name === name)); }
  live(parent, name) { return this.childFolders(parent, name).filter((f) => !f.trashed); }
  inFolder(folderId) { return [...this.files.values()].filter((f) => !f.trashed && f.parents.includes(folderId)).map((f) => f.name).sort(); }

  handle(method, url, opt = {}) {
    method = String(method || 'get').toLowerCase();
    const u = new URL(url);
    const headers = Object.fromEntries(Object.entries(opt.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    this.calls.push(`${method} ${u.pathname}`);
    let cors = {};
    const json = (code, body, h = {}) => ({ code, headers: { ...cors, ...h }, text: JSON.stringify(body), bytes: null });
    if (!/^Bearer tok-script$/.test(headers.authorization || '') && !this.sessions.has(url)) return json(401, { error: 'no token' });
    if (this.apiOff) return json(403, { error: { message: 'Google Drive API has not been used in project 1 before or it is disabled.' } });

    // 이어 올리기 주소
    if (this.sessions.has(url)) {
      const s = this.sessions.get(url);
      // 진짜 Drive 처럼: 세션을 만들 때 받은 출처에만 CORS 를 열어 준다
      if (!this.noCors && s.origin && headers.origin === s.origin) cors = { 'Access-Control-Allow-Origin': s.origin };
      if (method === 'delete') { this.sessions.delete(url); return json(499, {}); }
      const cr = /^bytes (\*|(\d+)-(\d+))\/(\d+)$/.exec(headers['content-range'] || '');
      if (!cr) return json(400, { error: 'bad content-range' });
      if (Number(cr[4]) !== s.size) return json(400, { error: 'final size does not match the expected size' });
      if (cr[1] !== '*' && !s.done) {
        const from = Number(cr[2]), to = Number(cr[3]);
        const body = Buffer.from(opt.payload || []);
        if (from === s.received.length && body.length === to - from + 1) s.received = Buffer.concat([s.received, body]);
      }
      if (s.received.length === s.size) {
        if (!s.done) {
          s.done = true;
          this.files.set(s.meta.id, {
            id: s.meta.id, name: s.meta.name, parents: [...s.meta.parents], mimeType: s.meta.mimeType,
            bytes: s.received, trashed: false,
          });
        }
        return json(200, { id: s.meta.id, name: s.meta.name });
      }
      return { code: 308, headers: { ...cors, ...(s.received.length ? { Range: `bytes=0-${s.received.length - 1}` } : {}) }, text: '', bytes: null };
    }
    if (/upload_id=/.test(url)) return json(404, { error: 'session gone' });

    if (u.pathname === '/drive/v3/about') return json(200, { user: { emailAddress: 'owner@example.com' }, storageQuota: this.quota });
    if (u.pathname === '/drive/v3/files/generateIds') return json(200, { ids: [this.newId('f')] });
    if (u.pathname === '/upload/drive/v3/files' && method === 'post') {
      if (this.full) return json(403, { error: { errors: [{ domain: 'global', reason: 'storageQuotaExceeded' }], code: 403, message: "The user's Drive storage quota has been exceeded." } });
      const meta = JSON.parse(opt.payload);
      const size = Number(headers['x-upload-content-length']);
      const loc = `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${randomUUID()}`;
      this.sessions.set(loc, { meta, size, mime: headers['x-upload-content-type'], origin: headers.origin || '', received: Buffer.alloc(0), done: false });
      return json(200, {}, { Location: loc });
    }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const f = this.files.get(decodeURIComponent(m[1]));
      if (!f) return json(404, { error: 'not found' });
      if (method === 'get' && u.searchParams.get('alt') === 'media') {
        const r = /^bytes=(\d+)-(\d+)$/.exec(headers.range || '');
        const part = r ? f.bytes.subarray(Number(r[1]), Number(r[2]) + 1) : f.bytes;
        return { code: r ? 206 : 200, headers: {}, text: '', bytes: part };
      }
      if (method === 'get') {
        return json(200, { id: f.id, name: f.name, size: String(f.bytes.length), md5Checksum: createHash('md5').update(f.bytes).digest('hex'), mimeType: f.mimeType, parents: f.parents, trashed: f.trashed });
      }
      if (method === 'patch') {
        const body = JSON.parse(opt.payload || '{}');
        if (body.name !== undefined) f.name = body.name;
        if (body.trashed !== undefined) f.trashed = !!body.trashed;
        const add = u.searchParams.get('addParents'), rm = u.searchParams.get('removeParents');
        if (rm) f.parents = f.parents.filter((p) => p !== rm);
        if (add && !f.parents.includes(add)) f.parents.push(add);
        return json(200, { id: f.id });
      }
    }
    return json(404, { error: `unhandled ${method} ${u.pathname}` });
  }
}

const response = (r) => ({
  getResponseCode: () => r.code,
  getContentText: () => (r.bytes ? Buffer.from(r.bytes).toString('utf8') : r.text),
  getContent: () => [...(r.bytes ?? Buffer.from(r.text || ''))],
  getHeaders: () => r.headers || {},
});

/** 서울 시간으로 Utilities.formatDate 가 쓰는 두 가지 꼴만 */
function formatSeoul(date, pattern) {
  const d = new Date(date.getTime() + 9 * 3600000), p = (n) => String(n).padStart(2, '0');
  const parts = { yyyy: d.getUTCFullYear(), MM: p(d.getUTCMonth() + 1), dd: p(d.getUTCDate()), HH: p(d.getUTCHours()), mm: p(d.getUTCMinutes()), ss: p(d.getUTCSeconds()) };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => parts[k]);
}

/**
 * @param {object} o
 * @param {object} [o.props]   스크립트 속성
 * @param {object} [o.tokens]  idToken → tokeninfo 응답
 * @param {number|string} [o.now] 시작 시각
 */
export function loadBackend({ props = {}, tokens = {}, now = '2026-11-14T08:00:00+09:00' } = {}) {
  const clock = { t: typeof now === 'number' ? now : Date.parse(now) };
  const ss = new FakeSpreadsheet('sheet-submit', 'ENDPoinT 2026 제출');
  const apply = new FakeSpreadsheet('sheet-apply');
  const extra = new FakeSpreadsheet('sheet-extra');
  const drive = new FakeDrive();
  drive.addFolder('컴공 동아리 연합 해커톤 (2026)', null, 'ops');
  const rootId = drive.addFolder('결과물 제출', 'ops', 'root');
  // Drive 안의 스프레드시트 파일: id → { ss, name, parent }
  const books = new Map([['sheet-submit', { ss, name: 'ENDPoinT 2026 제출', parent: 'root' }]]);
  let bookN = 0;
  const cache = new Map();
  const store = { ...props };
  const logs = [];
  let locked = false, ui = null, activeSheet = null, activeRow = 2;
  const fetched = [];
  const counts = { props: 0 };

  const folderObj = (id) => {
    const f = drive.folders.get(id);
    if (!f) throw new Error('no folder ' + id);
    return {
      getId: () => f.id, getName: () => f.name,
      isTrashed: () => !!f.trashed, setTrashed: (v) => { f.trashed = !!v; },
      getDateCreated: () => new Date(Date.UTC(2026, 10, 13) + f.created * 1000),
      getFoldersByName: (name) => { const list = drive.childFolders(f.id, name); let i = 0; return { hasNext: () => i < list.length, next: () => folderObj(list[i++].id) }; },
      getParents: () => { const list = f.parent ? [f.parent] : []; let i = 0; return { hasNext: () => i < list.length, next: () => folderObj(list[i++]) }; },
      getFolders: () => { const list = drive.childFolders(f.id); let i = 0; return { hasNext: () => i < list.length, next: () => folderObj(list[i++].id) }; },
      getFiles: () => { const list = [...drive.files.values()].filter((x) => !x.trashed && x.parents.includes(f.id)); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; },
      createFolder: (name) => folderObj(drive.addFolder(name, f.id)),
      getFilesByName: (name) => {
        const list = [];
        if (name === '팀원 추가 계정' && extra.sheets.size) list.push({ getId: () => 'sheet-extra', getMimeType: () => 'application/vnd.google-apps.spreadsheet' });
        if (drive.plain.has(name)) list.push({ getId: () => 'plain', getMimeType: () => 'text/csv', getBlob: () => ({ getDataAsString: () => drive.plain.get(name) }) });
        for (const [id, m] of books) if (m.parent === f.id && m.name === name) list.push({ getId: () => id, getName: () => m.name, getMimeType: () => 'application/vnd.google-apps.spreadsheet', isTrashed: () => !!m.trashed });
        let i = 0;
        return { hasNext: () => i < list.length, next: () => list[i++] };
      },
    };
  };
  const fetchOne = (url, opt = {}) => {
    fetched.push(url);
    if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
      const info = tokens[decodeURIComponent(url.split('id_token=')[1])];
      return response({ code: info ? 200 : 400, headers: {}, text: JSON.stringify(info ?? {}) });
    }
    if (url.startsWith('https://www.googleapis.com/')) return response(drive.handle(opt.method, url, opt));
    throw new Error('unexpected fetch ' + url);
  };

  const ctx = {
    console: { log() {}, error: (...a) => logs.push(a.join(' ')) },
    __clock: clock,
    Logger: { log: (s) => logs.push(String(s)) },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => { counts.props++; return { ...store }; },
      getProperty: (k) => { counts.props++; return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setProperty: (k, v) => { store[k] = String(v); },
      deleteProperty: (k) => { delete store[k]; },
      setProperties: (o) => { Object.assign(store, o); },
    }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: (id) => (id === 'sheet-apply' ? apply : id === 'sheet-extra' ? extra : books.has(id) ? books.get(id).ss : ss),
      create: (name) => { const id = 'sheet-new' + (++bookN); const s = new FakeSpreadsheet(id, name); books.set(id, { ss: s, name, parent: null }); return s; },
      flush() {},
      getUi: () => { if (!ui) throw new Error('no ui'); return ui; },
      getActiveSheet: () => activeSheet,
      newRichTextValue: () => { const rt = { text: '', url: '' }; const b = { setText: (t) => { rt.text = t; return b; }, setLinkUrl: (u) => { rt.url = u; return b; }, build: () => rt }; return b; },
    },
    // 진짜 잠금은 같은 실행 안에서 겹쳐 잡을 수 있지만, 겹쳐 잡는 코드는 풀 때 사고가 나기 쉽다. 여기서는 겹치면 실패하게 한다.
    LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    CacheService: { getScriptCache: () => {
      const live = (k) => { const e = cache.get(k); if (!e) return null; if (e.until <= clock.t) { cache.delete(k); return null; } return e.v; };
      return {
        get: live,
        put: (k, v, ttl = 600) => { if (String(v).length > 100000) throw new Error('cache value too large'); cache.set(k, { v: String(v), until: clock.t + ttl * 1000 }); },
        remove: (k) => { cache.delete(k); },
        getAll: (keys) => Object.fromEntries(keys.map((k) => [k, live(k)]).filter(([, v]) => v !== null)),
        putAll: (o, ttl = 600) => { for (const [k, v] of Object.entries(o)) cache.set(k, { v: String(v), until: clock.t + ttl * 1000 }); },
        removeAll: (keys) => { keys.forEach((k) => cache.delete(k)); },
      };
    } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_a, s) => [...createHash('sha256').update(String(s)).digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => (b + 256) % 256)).toString('base64url'),
      base64Decode: (s) => { if (!/^[A-Za-z0-9+/=]*$/.test(s)) throw new Error('bad base64'); return [...Buffer.from(s, 'base64')]; },
      formatDate: (d, _tz, pattern) => formatSeoul(d, pattern),
      getUuid: () => randomUUID(),
      // 따옴표로 감싼 칸과 그 안의 쉼표 · 줄바꿈 · "" 까지
      parseCsv: (text) => {
        const rows = [[]]; let cell = '', q = false;
        for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
          else if (c === '"') q = true;
          else if (c === ',') { rows.at(-1).push(cell); cell = ''; }
          else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; rows.at(-1).push(cell); cell = ''; rows.push([]); }
          else cell += c;
        }
        if (cell !== '' || rows.at(-1).length) rows.at(-1).push(cell);
        return rows.filter((r) => r.length);
      },
    },
    UrlFetchApp: { fetch: fetchOne, fetchAll: (reqs) => reqs.map((r) => fetchOne(r.url, r)) },
    ScriptApp: { getOAuthToken: () => 'tok-script', getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/test/exec' }) },
    DriveApp: {
      getFolderById: folderObj,
      getFileById: (id) => {
        const m = books.get(id) || books.get('sheet-submit');
        return {
          getId: () => id,
          getParents: () => { const list = m.parent ? [m.parent] : []; let i = 0; return { hasNext: () => i < list.length, next: () => folderObj(list[i++]) }; },
          moveTo: (folder) => { m.parent = folder.getId(); },
        };
      },
    },
    Session: { getActiveUser: () => ({ getEmail: () => 'op@example.com' }) },
    HtmlService: { createHtmlOutput: (h) => { const o = { html: h, setWidth: () => o, setHeight: () => o }; return o; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext('Date.now = function () { return __clock.t; };', ctx);
  for (const f of ['Submit.gs', 'SubmitAdmin.gs']) vm.runInContext(readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('CONFIG.CLIENT_ID = "cid"; CONFIG.APPLY_SHEET_ID = "sheet-apply";', ctx);

  const call = (fn, arg) => JSON.parse(ctx[fn](arg).body);
  const api = {
    ctx, ss, apply, extra, drive, cache, store, logs, fetched, counts, clock, rootId, books,
    /** 심사 시트 (처음 설정이 만들거나 찾은 것) */
    scoreBook: () => { const id = store.SCORE_SHEET_ID; return id && books.has(id) ? books.get(id).ss : null; },
    /** 스크립트 속성을 고친다. 웹 앱에는 늦어도 1분 뒤에 보인다 — now 를 주면 캐시를 비워 바로 보이게 한다 */
    prop: (k, v, now = true) => { store[k] = String(v); if (now) cache.delete('props1'); },
    get: (params = {}) => call('doGet', { parameter: params }),
    post: (body) => call('doPost', { postData: { contents: JSON.stringify(body) } }),
    /** 운영진 메뉴 함수 실행 (메모를 비우고) */
    run: (name, ...args) => { vm.runInContext('MEMO = {};', ctx); const r = ctx[name](...args); return r && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r; },
    tab: (name) => ss.getSheetByName(name),
    rows: (name) => ss.getSheetByName(name)?.objects() ?? [],
    at: (iso) => { clock.t = Date.parse(iso); },
    advance: (sec) => { clock.t += sec * 1000; },
    isLocked: () => locked,
    /** 다른 실행이 잠금을 쥐고 있는 것처럼 */
    hold: (on = true) => { locked = on; },
    setUi: (u) => { ui = u; },
    select: (sheetName, row) => { activeSheet = Object.assign(Object.create(ss.getSheetByName(sheetName)), { getActiveRange: () => ({ getRow: () => row }) }); activeRow = row; },
    /** 팀원 명단을 채운다: [[팀, 이름, 이메일, 계정 식별자, 역할, 상태]] */
    roster: (rows) => { ss.fill('팀원', [['팀', '이름', '이메일', '계정 식별자', '역할', '상태', '비고', '출처'], ...rows.map((r) => [...r, '', '', '', '', '', ''].slice(0, 8))]); cache.delete('roster1'); },
    /** 열람 토큰을 하나 만든다 (운영진 메뉴와 같은 저장 방식) */
    viewer: (name, role = '심사위원', { until = '', on = 'O' } = {}) => {
      const key = 'k_' + randomUUID().replace(/-/g, '') + randomUUID().slice(0, 6);
      const hash = createHash('sha256').update(key).digest('hex');
      const s = ss.getSheetByName('열람') ?? ss.fill('열람', [['이름', '역할', '토큰 해시', '만든 시각', '만료', '사용', '마지막 접속']]);
      s.cells.push([name, role, hash, '', until, on, '']);
      cache.delete('views1');
      return key;
    },
    /** 브라우저가 Drive 로 직접 올리는 것을 흉내 낸다 */
    putDirect: (url, bytes, { chunk = bytes.length, from = 0, to = bytes.length } = {}) => {
      let last = null;
      for (let a = from; a < to; a += chunk) {
        const b = Math.min(to, a + chunk);
        last = drive.handle('put', url, { headers: { 'Content-Range': `bytes ${a}-${b - 1}/${bytes.length}` }, payload: [...bytes.subarray(a, b)] });
      }
      return last;
    },
  };
  return api;
}

export const token = (email, sub, extra = {}) => ({
  aud: 'cid', iss: 'https://accounts.google.com', email, email_verified: 'true', sub, name: email.split('@')[0],
  exp: String(Math.floor(Date.parse('2026-11-14T23:00:00+09:00') / 1000)), ...extra,
});

export const bytesOf = (n, seed = 7) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255; return b; };
export const md5 = (b) => createHash('md5').update(b).digest('hex');
