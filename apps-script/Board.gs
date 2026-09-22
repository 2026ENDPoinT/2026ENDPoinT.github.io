/**
 * ENDPoinT 팀 모집 게시판 — 구글 시트를 DB 처럼 쓴다
 * ---------------------------------------------------------------
 * Apps Script 는 프로젝트 안의 .gs 파일을 모두 한 스코프로 합치므로,
 * 이 파일을 Code.gs 옆에 "Board.gs" 로 추가하면 Code.gs 의 doPost 가
 * board_() 를 바로 부를 수 있다. CONFIG, verifyIdToken_, findMine_,
 * safeText_, ss_, once_ 는 Code.gs 의 것을 그대로 쓴다.
 *
 * 규칙
 *  - 한 계정은 '팀 모집' 글(team, 완료되면 done) 하나와
 *    '팀 찾는' 글(person) 하나까지만 가진다.
 *  - 수정·삭제·모집 완료는 글쓴이만 할 수 있다. 어느 탭의 글이든 글쓴이는 모든 항목을 고칠 수 있다.
 *  - 모집 완료는 되돌릴 수 있다 (done -> team). 잘못 눌렀을 때를 위한 것이다.
 *  - 카드에 보일 이름은 클라이언트가 보내는 값이 아니라 신청서의 성함(없으면 구글 계정 이름)이다.
 *  - 응답에 이메일·계정 식별자를 담지 않는다. 대신 mine(내 글인지)을 준다.
 *  - 셀에 쓰는 모든 값은 텍스트 서식(@)으로 고정한다. '=' 로 시작하는 입력이 수식으로
 *    해석되어 다른 탭(신청서)을 읽어 가는 것을 막기 위해서다.
 *
 * [속도] 게시판 탭도 한 번의 요청 안에서 한 번만 읽는다(BMEMO). 글을 쓴 뒤에도
 *        시트를 다시 읽지 않고 메모를 직접 고쳐 목록을 만든다. 예전에는 글 하나
 *        올릴 때 스프레드시트를 세 번 열고 시트를 다섯 번 읽었다.
 *
 * 요청 (모두 POST, idToken 필수)
 *  { action:'board.list' }
 *  { action:'board.create', nonce, data:{ kind:'team'|'person', ... } }
 *  { action:'board.update', nonce, id, data:{ ... } }   kind:'done' 을 보내면 모집 완료
 *  { action:'board.delete', nonce, id }
 */

var BOARD_HEADERS = [
  'id', 'kind', '계정 식별자', '이메일', '이름', '동아리', '팀명',
  '제목', '설명', '태그', '현재 인원', '정원', '참석', '팀 소개', 'GitHub',
  '작성시각', '수정시각'
];
var BOARD_CLUBS = ['다락방', 'PLUM', 'EC', 'NL', 'TCP'];
var BOARD_LIMIT = { title: 80, desc: 600, team: 40, name: 30, meta: 60, intro: 800, github: 200 };

/** 한 번의 요청이 끝날 때까지만 사는 메모 (Code.gs 의 MEMO 와 같은 역할) */
var BMEMO = { sh: null, headers: null, rows: null, lastRow: 0 };

function board_(op, claims, body) {
  if (op === 'list') return boardList_(claims);

  // 쓰기는 한 번에 하나씩 — 같은 사람이 두 번 눌러도 글이 두 개 생기지 않게
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // 응답이 끊겨 화면이 같은 요청을 다시 보내면, 처리하지 않고 먼젓번 결과를 돌려준다.
    // (Apps Script 는 처리를 끝내고도 응답만 흘려보내는 일이 있다. 그때 화면이 다시
    //  보내면 예전에는 "이미 글이 있습니다" 라는 엉뚱한 오류가 떴다)
    var res = once_(claims, body.nonce, function () {
      if (op === 'create') return boardCreate_(claims, body.data || {});
      if (op === 'update') return boardUpdate_(claims, String(body.id || ''), body.data || {});
      if (op === 'delete') return boardDelete_(claims, String(body.id || ''));
      return { ok: false, error: 'UNKNOWN_ACTION' };
    });

    // 바뀐 목록을 응답에 같이 담는다. 화면이 board.list 를 다시 부르지 않아도 되므로
    // 글 하나 올릴 때마다 들던 왕복 한 번(1~2초)이 통째로 사라진다.
    // 목록은 메모에서 만들어지므로 시트를 다시 읽지 않는다.
    if (res && res.ok) {
      var full = boardList_(claims);
      res.items = full.items;
      res.me = full.me;
    }
    return res;
  } finally {
    lock.releaseLock();
  }
}

/* ---- 시트 접근 ------------------------------------------------------- */

/** 게시판 탭. 없으면 만든다 (동시에 두 요청이 만들려 하면 한쪽은 이미 생긴 탭을 쓴다). */
function boardSheet_() {
  if (BMEMO.sh) return BMEMO.sh;
  var ss = ss_();                       // 스프레드시트는 요청당 한 번만 연다
  var sh = ss.getSheetByName(CONFIG.BOARD_SHEET);
  if (!sh) {
    try { sh = ss.insertSheet(CONFIG.BOARD_SHEET); }
    catch (e) { sh = ss.getSheetByName(CONFIG.BOARD_SHEET); }
    if (!sh) throw new Error('게시판 탭을 만들지 못했습니다');
  }
  return (BMEMO.sh = sh);
}

/**
 * 헤더 행을 읽어 열 순서를 돌려준다. 코드가 아는 열이 빠져 있으면 끝에 덧붙인다.
 * 열 위치가 아니라 이름으로 읽고 쓰므로, 운영진이 시트에 열을 끼워 넣어도 어긋나지 않는다.
 */
function boardHeaders_(sh) {
  if (BMEMO.headers) return BMEMO.headers;
  var last = sh.getLastColumn();
  var row = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h); }) : [];
  var fresh = row.every(function (h) { return !h; });
  if (fresh) row = [];
  var missing = BOARD_HEADERS.filter(function (h) { return row.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, row.length + 1, 1, missing.length).setValues([missing]);
    row = row.concat(missing);
  }
  if (fresh) {
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, row.length).setFontWeight('bold');
  }
  return (BMEMO.headers = row);
}

/** 시트 전체를 {row, rec} 목록으로 읽는다. rec 는 헤더 이름 → 값. */
function boardRows_(sh, headers) {
  if (BMEMO.rows) return BMEMO.rows;
  var last = sh.getLastRow();
  BMEMO.lastRow = last;
  var n = last - 1;
  if (n < 1) return (BMEMO.rows = []);

  var values = sh.getRange(2, 1, n, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var rec = {};
    for (var j = 0; j < headers.length; j++) rec[headers[j]] = values[i][j];
    if (String(rec.id || '')) out.push({ row: i + 2, rec: rec });
  }
  return (BMEMO.rows = out);
}

/**
 * 한 행을 텍스트 서식으로 고정한 뒤 쓴다. row 가 없으면 맨 아래에 추가한다.
 * 쓰고 나서 메모도 같이 고쳐 두므로, 이 뒤에 목록을 만들 때 시트를 다시 읽지 않는다.
 */
function boardWrite_(sh, headers, rec, row) {
  var target = row || (BMEMO.lastRow || sh.getLastRow()) + 1;
  var range = sh.getRange(target, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([headers.map(function (h) { return rec[h] === undefined || rec[h] === null ? '' : rec[h]; })]);
  SpreadsheetApp.flush();

  if (!row) {
    BMEMO.lastRow = target;
    if (BMEMO.rows) BMEMO.rows.push({ row: target, rec: rec });
  }
  // 수정일 때는 rec 이 메모 안의 그 객체라 따로 손댈 것이 없다
  return target;
}

function boardIsMine_(rec, claims) {
  return String(rec['계정 식별자']) === String(claims.sub) ||
         String(rec['이메일']).toLowerCase() === String(claims.email).toLowerCase();
}

/** 화면에 내보낼 모양. 이메일·식별자는 빼고 mine 만 준다. */
function boardPublic_(rec, claims) {
  var iso = function (v) { return (v instanceof Date) ? v.toISOString() : (v ? String(v) : ''); };
  return {
    id: String(rec.id), kind: String(rec.kind), mine: boardIsMine_(rec, claims),
    name: String(rec['이름'] || ''), club: String(rec['동아리'] || ''), team: String(rec['팀명'] || ''),
    title: String(rec['제목'] || ''), desc: String(rec['설명'] || ''),
    tags: String(rec['태그'] || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean),
    have: Number(rec['현재 인원']) || 0, cap: Number(rec['정원']) || 0,
    meta: String(rec['참석'] || ''), intro: String(rec['팀 소개'] || ''), github: String(rec['GitHub'] || ''),
    createdAt: iso(rec['작성시각']), updatedAt: iso(rec['수정시각'])
  };
}

/** 카드에 보일 이름: 신청서의 성함, 없으면 구글 계정 이름. 클라이언트가 보낸 이름은 쓰지 않는다. */
function boardName_(claims) {
  var app = findMine_(claims);
  var n = app.found ? String(app.answers['성함'] || '') : '';
  return cut_(n || claims.name || '', BOARD_LIMIT.name);
}

/** 글 목록 + 이 계정의 신청 정보 요약 (글쓰기 폼을 미리 채우는 데 쓴다) */
function boardList_(claims) {
  var sh = boardSheet_();
  var headers = boardHeaders_(sh);
  var items = boardRows_(sh, headers).map(function (r) { return boardPublic_(r.rec, claims); });
  items.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : (a.createdAt > b.createdAt ? -1 : 0); });

  var me = { applied: false, hasTeam: false, hasPerson: false, name: claims.name || '' };
  items.forEach(function (p) {
    if (!p.mine) return;
    if (p.kind === 'person') me.hasPerson = true; else me.hasTeam = true;
  });
  var app = findMine_(claims);
  if (app.found) {
    me.applied = true;
    me.name = String(app.answers['성함'] || me.name);
    me.club = String(app.answers['소속동아리'] || '').split(',')[0].trim();
    me.role = String(app.answers['희망역할'] || '');
    me.stack = String(app.answers['기술스택 및 개발 경험'] || '');
    me.sched = String(app.answers['전체 일정 참석 가능여부'] || '');
  }
  return { ok: true, items: items, me: me };
}

/* ---- 입력 정리 ------------------------------------------------------- */
function cut_(v, n) { return safeText_(v).replace(/\s+/g, ' ').trim().slice(0, n); }
function clubOk_(club) {
  var parts = String(club || '').split('·').map(function (c) { return c.trim(); }).filter(Boolean);
  return parts.length > 0 && parts.length <= 3 && parts.every(function (c) { return BOARD_CLUBS.indexOf(c) !== -1; });
}
function tagsOk_(tags) {
  var list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return list.map(function (t) { return cut_(t, 20); }).filter(Boolean).slice(0, 6).join(', ');
}
function githubOk_(url) {
  url = cut_(url, BOARD_LIMIT.github);
  if (!url) return '';
  return /^https:\/\/(www\.)?github\.com\/[\w.-]+(\/[\w.-]+)*\/?$/i.test(url) ? url : null;
}
function intOk_(v, lo, hi) { v = Math.round(Number(v)); return (v >= lo && v <= hi) ? v : null; }

/** 새 글. 한 계정에 팀 글 하나, 팀 찾는 글 하나까지만. */
function boardCreate_(claims, d) {
  var kind = String(d.kind || '');
  if (kind !== 'team' && kind !== 'person') return { ok: false, error: 'BAD_KIND' };

  var sh = boardSheet_();
  var headers = boardHeaders_(sh);
  var dup = boardRows_(sh, headers).some(function (r) {
    if (!boardIsMine_(r.rec, claims)) return false;
    var fam = String(r.rec.kind) === 'person' ? 'person' : 'team';
    return fam === kind;
  });
  if (dup) return { ok: false, error: 'LIMIT' };

  var club = cut_(d.club, 30);
  var title = cut_(d.title, BOARD_LIMIT.title);
  if (!clubOk_(club)) return { ok: false, error: 'BAD_CLUB' };
  if (!title) return { ok: false, error: 'BAD_TITLE' };

  var have = 1, cap = 1, team = '';
  if (kind === 'team') {
    team = cut_(d.team, BOARD_LIMIT.team);
    have = intOk_(d.have, 1, 6); cap = intOk_(d.cap, 2, 6);
    if (!team) return { ok: false, error: 'BAD_TEAM' };
    if (have === null || cap === null || have > cap) return { ok: false, error: 'BAD_COUNT' };
  }

  var now = new Date().toISOString();
  var id = 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  var rec = {};
  rec.id = id; rec.kind = kind;
  rec['계정 식별자'] = String(claims.sub); rec['이메일'] = String(claims.email);
  rec['이름'] = d.showName ? boardName_(claims) : '';
  rec['동아리'] = club; rec['팀명'] = team; rec['제목'] = title;
  rec['설명'] = cut_(d.desc, BOARD_LIMIT.desc); rec['태그'] = tagsOk_(d.tags);
  rec['현재 인원'] = have; rec['정원'] = cap;
  rec['참석'] = kind === 'person' ? cut_(d.meta, BOARD_LIMIT.meta) : '';
  rec['팀 소개'] = ''; rec['GitHub'] = '';
  rec['작성시각'] = now; rec['수정시각'] = now;

  boardWrite_(sh, headers, rec);
  return { ok: true, item: boardPublic_(rec, claims) };
}

/**
 * 내 글 수정. 내가 쓴 글이면 어느 탭에 있든 모든 항목을 고칠 수 있다.
 *  - kind:'done' → 모집 중에서 모집 완료로
 *  - kind:'team' → 모집 완료에서 모집 중으로 (잘못 눌렀을 때 되돌리기)
 *  - person 글은 상태가 바뀌지 않는다
 * 보내지 않은 항목은 건드리지 않는다(부분 수정).
 */
function boardUpdate_(claims, id, d) {
  var sh = boardSheet_();
  var headers = boardHeaders_(sh);
  var hit = boardRows_(sh, headers).filter(function (r) { return String(r.rec.id) === id; })[0];
  if (!hit) return { ok: false, error: 'NOT_FOUND' };
  if (!boardIsMine_(hit.rec, claims)) return { ok: false, error: 'FORBIDDEN' };
  var rec = hit.rec;
  var was = String(rec.kind);

  /* 상태 전환 */
  if (d.kind !== undefined) {
    var to = String(d.kind);
    if (was === 'team' && to === 'done') {
      rec.kind = 'done';
      rec['현재 인원'] = rec['정원'];
      if (!String(rec['팀 소개'] || '')) rec['팀 소개'] = String(rec['설명'] || '');
    } else if (was === 'done' && to === 'team') {
      rec.kind = 'team';
    } else if (to !== was) {
      return { ok: false, error: 'BAD_STATE' };
    }
  }
  var kind = String(rec.kind);

  /* 내용 — 보낸 항목만 바꾼다 */
  if (d.club !== undefined) {
    var club = cut_(d.club, 30);
    if (!clubOk_(club)) return { ok: false, error: 'BAD_CLUB' };
    rec['동아리'] = club;
  }
  if (d.title !== undefined) {
    var t = cut_(d.title, BOARD_LIMIT.title);
    if (!t) return { ok: false, error: 'BAD_TITLE' };
    rec['제목'] = t;
  }
  if (d.team !== undefined && kind !== 'person') {
    var tm = cut_(d.team, BOARD_LIMIT.team);
    if (!tm) return { ok: false, error: 'BAD_TEAM' };
    rec['팀명'] = tm;
  }
  if (d.desc !== undefined) rec['설명'] = cut_(d.desc, BOARD_LIMIT.desc);
  if (d.tags !== undefined) rec['태그'] = tagsOk_(d.tags);
  if (d.meta !== undefined && kind === 'person') rec['참석'] = cut_(d.meta, BOARD_LIMIT.meta);
  if (d.intro !== undefined) rec['팀 소개'] = cut_(d.intro, BOARD_LIMIT.intro);
  if (d.github !== undefined) {
    var gh = githubOk_(d.github);
    if (gh === null) return { ok: false, error: 'BAD_GITHUB' };
    rec['GitHub'] = gh;
  }
  if (kind !== 'person' && (d.have !== undefined || d.cap !== undefined)) {
    var have = intOk_(d.have !== undefined ? d.have : rec['현재 인원'], 1, 6);
    var cap  = intOk_(d.cap  !== undefined ? d.cap  : rec['정원'], 2, 6);
    if (have === null || cap === null || have > cap) return { ok: false, error: 'BAD_COUNT' };
    rec['현재 인원'] = have; rec['정원'] = cap;
  }
  // 이름은 클라이언트가 보낸 값이 아니라 신청서의 성함에서 가져온다
  if (d.showName !== undefined) rec['이름'] = d.showName ? boardName_(claims) : '';

  rec['수정시각'] = new Date().toISOString();
  boardWrite_(sh, headers, rec, hit.row);
  return { ok: true, item: boardPublic_(rec, claims) };
}

/** 내 글 삭제 */
function boardDelete_(claims, id) {
  var sh = boardSheet_();
  var headers = boardHeaders_(sh);
  var rows = boardRows_(sh, headers);
  var hit = rows.filter(function (r) { return String(r.rec.id) === id; })[0];
  if (!hit) return { ok: false, error: 'NOT_FOUND' };
  if (!boardIsMine_(hit.rec, claims)) return { ok: false, error: 'FORBIDDEN' };

  sh.deleteRow(hit.row);
  SpreadsheetApp.flush();

  // 메모에서도 지우고, 아래에 있던 글들의 행 번호를 하나씩 당긴다.
  // 그래야 이 뒤에 이어지는 수정·목록이 시트를 다시 읽지 않고도 맞는다.
  BMEMO.rows = rows.filter(function (r) { return r !== hit; });
  BMEMO.rows.forEach(function (r) { if (r.row > hit.row) r.row -= 1; });
  if (BMEMO.lastRow) BMEMO.lastRow -= 1;

  return { ok: true };
}
