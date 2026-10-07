/**
 * ENDPoinT 운영 — 공지사항 · 운영진 판정 · 운영기록
 * ---------------------------------------------------------------
 * Code.gs 옆에 "Notice.gs" 로 추가한다. 한 스코프로 합쳐지므로 Code.gs 의 CONFIG, API_VERSION, ss_,
 * once_, safeText_, Board.gs 의 cut_, Apply.gs 의 bappText_ 를 그대로 쓴다. 세 파일이 모두 있어야 한다.
 * (Code.gs·Board.gs 는 이 파일이 없어도 동작한다 — typeof 로 확인하고 운영진 기능만 끈다)
 *
 * 누가 운영진인가 — 구글 계정 이메일 목록. 두 곳을 합쳐 본다.
 *   1) Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성 → ADMINS (쉼표로 구분)   ← 권장
 *   2) Code.gs 의 CONFIG.ADMINS
 *   저장소(GitHub)가 공개라 Code.gs 에 적은 이메일은 그대로 공개된다. 스크립트 속성은 소유자만 보고 고칠 수 있다.
 *   토큰에서 검증된 이메일(claims.email)과 소문자로 비교한다. 요청마다 새로 판정하고 어디에도 담아 두지 않는다.
 *   화면(index.html)의 운영진 버튼은 편의일 뿐이고, 판정은 전부 여기서 한다. GitHub Pages 에 올라간
 *   것은 전부 공개 소스라, 주소(#/admin)를 숨기는 것은 보안이 아니다.
 *
 * 공지 — '공지' 탭 (CONFIG.NOTICE_SHEET_ID 가 비어 있으면 신청서 스프레드시트 안에, 적혀 있으면 그
 * 별도 스프레드시트 안에). 없으면 운영진이 처음 쓸 때 만든다. 공개 읽기(doGet)는 탭을 만들지 않는다.
 *   열: id, 제목, 내용, 고정, 게시, 작성자, 작성시각, 수정시각
 *   게시='O' 인 글만 공개된다. 고정='O' 인 글은 맨 위에 오고 사이트 상단 띠에도 뜬다.
 *   운영진이 시트에서 직접 행을 적어도 된다 (제목·내용·게시 만 채우면 된다. id 가 비면 행 번호로 만든다).
 *   탭 어디든 수식이 하나라도 있으면 공지를 전부 내리지 않는다 — 공개 응답이라, 다른 탭을 끌어오는
 *   수식(IMPORTRANGE, '웹신청'!A2 …)이 섞이는 길을 막는다. 배열 수식은 한 칸에만 수식이 있고 값만 번지므로
 *   행 단위가 아니라 탭 전체를 본다.
 *
 * 요청
 *   GET  /exec?notices=1                 로그인 없이 누구나. 게시 중인 공지 (ScriptCache 120초)
 *   POST { action:'notice.list' }        운영진. 게시 전 글까지 전부
 *   POST { action:'notice.create', nonce, data:{ title, body, pinned, published } }
 *   POST { action:'notice.update', nonce, id, data:{ ... } }   보낸 항목만 바뀐다
 *   POST { action:'notice.delete', nonce, id }
 *   쓰기는 Board.gs 와 같은 방식 — 잠금 + nonce. 응답에 바뀐 목록(items)을 같이 담는다.
 *
 * 운영기록 — 운영진이 남의 글을 숨기거나 지우고, 공지를 올리거나 고치거나 지울 때 '운영기록' 탭에 한 줄
 * 남긴다 (시각 · 계정 · 동작 · 대상 · 메모). 기록에 실패해도 본 작업은 막지 않는다.
 */

var NOTICE_HEADERS = ['id', '제목', '내용', '고정', '게시', '작성자', '작성시각', '수정시각'];
var NOTICE_LIMIT = { title: 80, body: 2000, list: 30 };
var NOTICE_CACHE_KEY = 'notices:v1';           // 120초 — 평소에 돌려주는 것
var NOTICE_STALE_KEY = 'notices:v1:stale';     // 30분 — 새로 읽는 동안 다른 요청에 돌려주는 조금 전 결과
var NOTICE_LOCK_KEY = 'notices:v1:lock';       // 5초 — 한 번에 한 요청만 시트를 읽게
var NOTICE_CACHE_SEC = 120;

/** 한 번의 요청이 끝날 때까지만 사는 메모 (BMEMO 와 같은 역할) */
var NMEMO = { ss: null, sh: null, headers: null, rows: null, lastRow: 0, tainted: null };

/* ---- 운영진 ---------------------------------------------------------- */

/** 운영진 이메일 목록 — 스크립트 속성 ADMINS 와 CONFIG.ADMINS 를 합친다 (소문자). */
function adminList_() {
  var list = (CONFIG.ADMINS || []).slice();
  try {
    var prop = PropertiesService.getScriptProperties().getProperty('ADMINS');
    if (prop) list = list.concat(String(prop).split(/[,\s;]+/));
  } catch (e) {}
  return list.map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean);
}

/** 이 계정이 운영진인가. 요청마다 토큰에서 나온(검증된) 이메일로 판정한다. */
function isAdmin_(claims) {
  if (!claims || !claims.email) return false;
  return adminList_().indexOf(String(claims.email).trim().toLowerCase()) !== -1;
}

/** 운영기록 한 줄. 실패해도 조용히 넘어간다 — 기록 때문에 본 작업이 막히면 안 된다. */
function audit_(claims, action, target, note) {
  try {
    var ss = ss_();
    var sh = ss.getSheetByName(CONFIG.AUDIT_SHEET);
    if (!sh) {
      try { sh = ss.insertSheet(CONFIG.AUDIT_SHEET); } catch (e) { sh = ss.getSheetByName(CONFIG.AUDIT_SHEET); }
      if (!sh) return;
      sh.getRange(1, 1, 1, 5).setValues([['시각', '운영진', '동작', '대상', '메모']]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, 5).setFontWeight('bold');
    }
    var range = sh.getRange(sh.getLastRow() + 1, 1, 1, 5);
    // 서식은 따로 감싼다 — 탭이 표(Table)로 바뀌어 서식을 못 걸어도 기록 자체는 남아야 한다
    try { range.setNumberFormats([['yyyy-mm-dd hh:mm:ss', '@', '@', '@', '@']]); } catch (e1) {}
    range.setValues([[new Date(), safeText_(claims && claims.email), safeText_(action), safeText_(target), safeText_(note).slice(0, 200)]]);
  } catch (e) {
    Logger.log('[audit_] ' + e);
  }
}

/* ---- 시트 접근 ------------------------------------------------------- */

function noticeSs_() {
  if (NMEMO.ss) return NMEMO.ss;
  var id = String(CONFIG.NOTICE_SHEET_ID || '').trim();
  return (NMEMO.ss = id ? SpreadsheetApp.openById(id) : ss_());
}

/** 공지 탭. create 가 true 일 때만 없으면 만든다 (공개 읽기는 만들지 않는다). 없으면 null. */
function noticeSheet_(create) {
  if (NMEMO.sh) return NMEMO.sh;
  var ss = noticeSs_();
  var sh = ss.getSheetByName(CONFIG.NOTICE_SHEET);
  if (!sh && create) {
    try { sh = ss.insertSheet(CONFIG.NOTICE_SHEET); }
    catch (e) { sh = ss.getSheetByName(CONFIG.NOTICE_SHEET); }
    if (!sh) throw new Error('공지 탭을 만들지 못했습니다');
  }
  return (NMEMO.sh = sh || null);
}

/**
 * 열 이름으로 읽고 쓴다. 코드가 아는 열이 빠져 있으면 끝에 덧붙인다 (boardHeaders_ 와 같은 방식).
 * write 가 false 면(로그인 없는 공개 읽기) 시트를 고치지 않고, 열이 모자라면 null 을 돌려준다.
 */
function noticeHeaders_(sh, write) {
  if (NMEMO.headers) return NMEMO.headers;
  var last = sh.getLastColumn();
  var row = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h); }) : [];
  var fresh = row.every(function (h) { return !h; });
  if (fresh) row = [];
  var missing = NOTICE_HEADERS.filter(function (h) { return row.indexOf(h) === -1; });
  if (missing.length) {
    if (write === false) return null;
    // 시트에 열이 모자라면 먼저 늘린다 — 범위 밖에 쓰면 요청 전체가 실패한다
    var need = row.length + missing.length;
    if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
    sh.getRange(1, row.length + 1, 1, missing.length).setValues([missing]);
    row = row.concat(missing);
  }
  if (fresh) {
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, row.length).setFontWeight('bold');
  }
  return (NMEMO.headers = row);
}

/**
 * 탭 어디든 수식이 하나라도 있는가. 있으면 공지를 전부 내리지 않는다 (운영진 화면에는 경고).
 * 행 단위 검사로는 모자란다 — 배열 수식(IMPORTRANGE 등)은 한 칸에만 수식이 있고 그 아래·옆 칸에는 값만
 * 번지기 때문이다. 1행이나 헤더 밖 열에 둔 수식도 번질 수 있으니 getDataRange() 전체를 본다.
 */
function noticeTainted_(sh) {
  if (NMEMO.tainted !== null) return NMEMO.tainted;
  var f = sh.getLastRow() > 0 ? sh.getDataRange().getFormulas() : [];
  return (NMEMO.tainted = f.some(function (row) { return row.some(function (c) { return !!c; }); }));
}

/**
 * 시트 전체를 {row, rec} 목록으로 읽는다. 탭에 수식이 있으면 빈 목록이다 (noticeTainted_).
 *  - 손으로 적은 행은 id 가 비어 있을 수 있다. 그때는 'r'+행번호 를 임시 id 로 쓴다
 *    (사이트에서 한 번 저장하면 진짜 id 가 붙는다).
 */
function noticeRows_(sh, headers) {
  if (NMEMO.rows) return NMEMO.rows;
  var last = sh.getLastRow();
  NMEMO.lastRow = last;
  var n = last - 1;
  if (n < 1 || noticeTainted_(sh)) return (NMEMO.rows = []);

  var values = sh.getRange(2, 1, n, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var rec = {};
    for (var j = 0; j < headers.length; j++) rec[headers[j]] = values[i][j];
    if (!String(rec.id || '')) {
      if (!String(rec['제목'] || '')) continue;      // 빈 행
      rec.id = 'r' + (i + 2); rec._noId = true;
    }
    out.push({ row: i + 2, rec: rec });
  }
  return (NMEMO.rows = out);
}

/** 한 행을 텍스트 서식으로 고정한 뒤 쓴다 (boardWrite_ 와 같은 방식). row 가 없으면 맨 아래에 추가한다. */
function noticeWrite_(sh, headers, rec, row) {
  var target = row || (NMEMO.lastRow || sh.getLastRow()) + 1;
  var range = sh.getRange(target, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([headers.map(function (h) { return rec[h] === undefined || rec[h] === null ? '' : rec[h]; })]);
  SpreadsheetApp.flush();
  if (!row) {
    NMEMO.lastRow = target;
    if (NMEMO.rows) NMEMO.rows.push({ row: target, rec: rec });
  }
  return target;
}

function noticeNewId_() {
  return 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/* ---- 화면에 내보낼 모양 ------------------------------------------------ */

function noticePublic_(rec) {
  var iso = function (v) { return (v instanceof Date) ? v.toISOString() : (v ? String(v) : ''); };
  return {
    id: String(rec.id), title: String(rec['제목'] || ''), body: String(rec['내용'] || ''),
    pinned: String(rec['고정'] || '').trim() === 'O', published: String(rec['게시'] || '').trim() === 'O',
    createdAt: iso(rec['작성시각']), updatedAt: iso(rec['수정시각'])
  };
}

/** 고정 먼저, 그다음 최신순 */
function noticeSort_(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : (a.createdAt > b.createdAt ? -1 : 0);
}

/* ---- 공개 읽기 (doGet) -------------------------------------------------- */

/**
 * 로그인 없이 누구나 — 게시 중인 공지. ScriptCache 에 120초 담아 두어 방문자가 몰려도 시트는 2분에 한 번만 읽는다.
 * 무슨 일이 나도 던지지 않는다 — doGet 의 probe 응답과 같은 함수 안에 있으므로, 여기서 터지면
 * 화면의 버전 확인까지 막힌다.
 */
function noticesPublic_() {
  var cache = null, stale = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(NOTICE_CACHE_KEY);
    if (hit) return JSON.parse(hit);
    // 캐시가 막 끝난 순간 요청이 몰리면 모두가 시트를 여는 것을 막는다: 먼저 온 하나만 읽고, 나머지는
    // 조금 전 결과(stale)를 돌려준다. (실행 슬롯 30개를 공지 읽기가 다 차지하면 신청·게시판 쓰기까지 막힌다)
    stale = cache.get(NOTICE_STALE_KEY) || null;
    if (stale && cache.get(NOTICE_LOCK_KEY)) return JSON.parse(stale);
    cache.put(NOTICE_LOCK_KEY, '1', 5);
  } catch (e) { cache = null; }

  var out = { ok: true, api: API_VERSION, items: [] };
  try {
    var sh = noticeSheet_(false);
    var headers = sh ? noticeHeaders_(sh, false) : null;   // 공개 읽기는 시트를 고치지 않는다. 열이 모자라면 빈 목록
    if (sh && headers) {
      out.items = noticeRows_(sh, headers)
        .map(function (r) { return noticePublic_(r.rec); })
        .filter(function (n) { return n.published && n.title; })
        .sort(noticeSort_)
        .slice(0, NOTICE_LIMIT.list);
    }
  } catch (e) {
    Logger.log('[notices] ' + e);
    var bad = { ok: false, api: API_VERSION, error: 'NOTICE_READ_FAILED', items: [] };
    if (cache) {
      // 계속 실패하는 설정(잘못된 NOTICE_SHEET_ID 등)이 페이지를 열 때마다 시트를 열지 않도록 30초만 담아 둔다
      try { cache.put(NOTICE_CACHE_KEY, stale || JSON.stringify(bad), 30); cache.remove(NOTICE_LOCK_KEY); } catch (e3) {}
    }
    if (stale) { try { return JSON.parse(stale); } catch (e4) {} }
    return bad;
  }
  if (cache) {
    try {
      // CacheService 는 값 하나에 100KB 까지. 넘치면 오래된 공지부터 뺀다 (목록은 고정 → 최신순이다)
      var text = JSON.stringify(out);
      while (out.items.length > 1 && Utilities.newBlob(text).getBytes().length > 95000) {
        out.items.pop(); text = JSON.stringify(out);
      }
      cache.put(NOTICE_CACHE_KEY, text, NOTICE_CACHE_SEC);
      cache.put(NOTICE_STALE_KEY, text, 1800);
      cache.remove(NOTICE_LOCK_KEY);
    } catch (e2) {}
  }
  return out;
}

function noticeCacheClear_() {
  try {
    var c = CacheService.getScriptCache();
    c.remove(NOTICE_CACHE_KEY); c.remove(NOTICE_STALE_KEY);
  } catch (e) {}
}

/* ---- 운영진 요청 (doPost 의 'notice.*') -------------------------------- */

function notice_(op, claims, body) {
  if (!isAdmin_(claims)) return { ok: false, error: 'NOT_ADMIN' };
  if (op === 'list') return noticeList_();

  // 쓰기는 한 번에 하나씩 (Board.gs 와 같다). 응답이 끊겨 화면이 다시 보내면 먼젓번 결과를 돌려준다.
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var res;
  try {
    res = once_(claims, body.nonce, function () {
      if (op === 'create') return noticeCreate_(claims, body.data || {});
      if (op === 'update') return noticeUpdate_(claims, String(body.id || ''), body.data || {});
      if (op === 'delete') return noticeDelete_(claims, String(body.id || ''));
      return { ok: false, error: 'UNKNOWN_ACTION' };
    });
    if (res && res.ok) {
      noticeCacheClear_();                 // 공개 목록이 바로 바뀌게
      var full = noticeList_();            // 화면이 다시 묻지 않아도 되게
      res.items = full.items; res.tainted = full.tainted;
    }
  } finally {
    lock.releaseLock();
  }
  return res;
}

/** 운영진용 전체 목록 — 게시 전 글까지. 작성자(by)도 준다. 탭에 수식이 있으면 비어 있고 tainted 가 true 다. */
function noticeList_() {
  var sh = noticeSheet_(true);
  var headers = noticeHeaders_(sh, true);
  var rows = noticeRows_(sh, headers);
  // 손으로 적은 행(id 없음)에는 여기서 진짜 id 를 붙여 둔다. 행 번호 기반 임시 id 로 고치거나 지우면
  // 그 사이 행이 밀렸을 때 엉뚱한 행을 건드릴 수 있기 때문이다 (운영진 화면이 처음 열릴 때 한 번 일어난다).
  var idCol = headers.indexOf('id');
  rows.forEach(function (r) {
    if (!r.rec._noId || idCol < 0) return;
    r.rec.id = noticeNewId_(); r.rec._noId = false;
    try { sh.getRange(r.row, idCol + 1).setNumberFormat('@').setValue(r.rec.id); } catch (e) {}
  });
  var items = rows.map(function (r) {
    var n = noticePublic_(r.rec);
    n.by = String(r.rec['작성자'] || '');
    return n;
  }).sort(noticeSort_);
  return { ok: true, items: items, tainted: noticeTainted_(sh) };
}

function noticeCreate_(claims, d) {
  var title = cut_(d.title, NOTICE_LIMIT.title);
  if (!title) return { ok: false, error: 'BAD_TITLE' };
  var sh = noticeSheet_(true);
  var headers = noticeHeaders_(sh);
  noticeRows_(sh, headers);                // lastRow 를 메모에 두기 위해
  var now = new Date().toISOString();
  var rec = {};
  rec.id = noticeNewId_();
  rec['제목'] = title;
  rec['내용'] = bappText_(d.body, NOTICE_LIMIT.body);
  rec['고정'] = (d.pinned && d.pinned !== 'false') ? 'O' : '';
  rec['게시'] = (d.published === false || d.published === 'false') ? '' : 'O';
  rec['작성자'] = String(claims.email);
  rec['작성시각'] = now; rec['수정시각'] = now;
  noticeWrite_(sh, headers, rec);
  audit_(claims, 'notice.create', rec.id, title);
  return { ok: true, item: noticePublic_(rec) };
}

function noticeUpdate_(claims, id, d) {
  var sh = noticeSheet_(true);
  var headers = noticeHeaders_(sh);
  var hit = noticeRows_(sh, headers).filter(function (r) { return String(r.rec.id) === id; })[0];
  if (!hit) return { ok: false, error: 'NOT_FOUND' };
  var rec = hit.rec;
  if (d.title !== undefined) {
    var t = cut_(d.title, NOTICE_LIMIT.title);
    if (!t) return { ok: false, error: 'BAD_TITLE' };
    rec['제목'] = t;
  }
  if (d.body !== undefined) rec['내용'] = bappText_(d.body, NOTICE_LIMIT.body);
  if (d.pinned !== undefined) rec['고정'] = (d.pinned && d.pinned !== 'false') ? 'O' : '';
  if (d.published !== undefined) rec['게시'] = (d.published && d.published !== 'false') ? 'O' : '';
  if (rec._noId) { rec.id = noticeNewId_(); rec._noId = false; }     // 손으로 적은 행에 진짜 id 를 붙인다
  if (!String(rec['작성자'] || '')) rec['작성자'] = String(claims.email);
  if (!rec['작성시각']) rec['작성시각'] = new Date().toISOString();
  rec['수정시각'] = new Date().toISOString();
  noticeWrite_(sh, headers, rec, hit.row);
  audit_(claims, 'notice.update', String(rec.id), String(rec['제목']));
  return { ok: true, item: noticePublic_(rec) };
}

function noticeDelete_(claims, id) {
  var sh = noticeSheet_(true);
  var headers = noticeHeaders_(sh);
  var rows = noticeRows_(sh, headers);
  var hit = rows.filter(function (r) { return String(r.rec.id) === id; })[0];
  if (!hit) return { ok: false, error: 'NOT_FOUND' };
  sh.deleteRow(hit.row);
  SpreadsheetApp.flush();
  audit_(claims, 'notice.delete', id, String(hit.rec['제목'] || ''));   // 지운 뒤에 적는다
  // 메모에서도 지우고, 아래 행들의 번호를 하나씩 당긴다 (boardDelete_ 와 같다)
  NMEMO.rows = rows.filter(function (r) { return r !== hit; });
  NMEMO.rows.forEach(function (r) {
    if (r.row > hit.row) { r.row -= 1; if (r.rec._noId) r.rec.id = 'r' + r.row; }
  });
  if (NMEMO.lastRow) NMEMO.lastRow -= 1;
  return { ok: true };
}
