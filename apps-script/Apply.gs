/**
 * ENDPoinT 팀 지원 — '팀 모집' 글에 지원하고, 조장이 수락·거절한다
 * ---------------------------------------------------------------
 * Board.gs 옆에 "Apply.gs" 로 추가한다. 한 스코프로 합쳐지므로 Code.gs·Board.gs 의
 * CONFIG, ss_, once_, findMine_, safeText_, cut_, boardIsMine_, boardSheet_,
 * boardHeaders_, boardRows_, boardWrite_ 를 그대로 쓴다.
 * (Code.gs 의 applyData_ 는 '신청서' 쪽 이름이라, 이 파일의 함수는 모두 bapp 로 시작한다)
 *
 * 저장: 구글 시트의 `팀지원` 탭 (없으면 자동 생성). 지원 한 건이 한 행이다.
 *   - 지원서는 신청서의 '스냅샷'이다. 신청서 값으로 화면을 미리 채워 주지만, 지원자가
 *     고친 값은 지원서에만 저장된다. 신청서 원본은 건드리지 않는다.
 *   - 성함·연락처 같은 기본정보는 이 탭에 복사하지 않는다. 필요할 때만 서버가
 *     신청서에서 읽어 내려보낸다 (아래 '누가 무엇을 보는가').
 *
 * 규칙
 *  - 지원할 수 있는 글은 '팀 모집'(team) 글뿐이다. 모집 완료(done)·팀 찾는(person) 글은 안 된다.
 *  - 신청서를 낸 사람만 지원할 수 있다. 소속동아리는 신청서에서 서버가 가져와 고정한다 (클라이언트 값 무시).
 *  - 지원 개수에는 제한이 없다. 대신 '묶임'을 본다:
 *      · 이미 어느 팀에 수락되어 있으면(그 글이 살아 있는 동안) 새로 지원할 수 없다.
 *      · 팀 글(모집 중·완료)의 조장이면 지원할 수 없다. 팀을 접으려면 글을 먼저 내려야 한다.
 *      · 조장이 수락하는 순간, 그 사람의 다른 '대기' 지원은 전부 '종료'로 끊는다.
 *      · 조장 화면에는 지원자의 다른 대기 지원 수(others)와 막힘 사유(block)가 내려간다.
 *  - 같은 글에 지원자당 한 행. 철회·종료 뒤에는 같은 행이 다시 '대기'가 된다. 거절은 최종이다.
 *  - 수락하면 그 글의 '현재 인원' 이 1 늘고, 정원이 차면 더 못 받는다. 모집 완료는 조장이 직접 누른다.
 *  - 수락된 사람이 '철회'하면 팀에서 빠진 것으로 보고 '현재 인원' 이 1 줄어든다.
 *  - 글이 모집 완료가 되거나 지워진 뒤의 대기 지원은 시트를 고치지 않고, 읽을 때
 *    state 를 'full' / 'gone' 으로 계산해 보여준다. (연쇄 쓰기가 없어 중간에 끊겨도 어긋나지 않는다)
 *
 * 누가 무엇을 보는가
 *  - 지원자: 내 지원서 전부. 수락되면 조장의 성함·연락처.
 *  - 조장:   소속동아리·기술스택·일정·하고 싶은 말. 성함은 지원자가 '이름 공개' 를 켰거나 수락된 뒤에만,
 *            연락처는 수락된 뒤에만. 이메일·계정 식별자는 누구에게도 내려가지 않는다.
 *
 * 요청 (Board.gs 의 board_ 가 받는다. 모두 POST, idToken 필수, 쓰기는 nonce)
 *  { action:'board.apply',        nonce, id:<글 id>,  data:{ stack, sched, note, showName } }
 *  { action:'board.applyEdit',    nonce, id:<지원 id>, data:{ stack, sched, note, showName } }  대기 중일 때만
 *  { action:'board.applyCancel',  nonce, id:<지원 id> }                                          철회 / 팀에서 나가기
 *  { action:'board.applyDecide',  nonce, id:<지원 id>, data:{ to:'accept'|'reject' } }          조장만
 *
 * 메일 (CONFIG.NOTIFY) — 새 지원이 오면 조장에게, 수락되면 지원자에게. 내용에 개인정보는 넣지 않고
 * 사이트 주소만 알린다. 같은 사람이 철회·재지원을 반복해도 메일은 첫 지원 때 한 번만 간다.
 * 메일은 잠금 밖에서 보내고, 실패해도 요청은 성공으로 처리한다.
 */

var BAPP_HEADERS = [
  'id', '글 id', '팀명', '계정 식별자', '이메일',
  '소속동아리', '기술스택 및 개발 경험', '전체 일정 참석 가능여부', '하고 싶은 말', '이름 공개',
  '상태', '지원시각', '수정시각', '처리시각'
];

/** 시트에는 한글로 적고, 화면에는 영문 코드로 준다 (게시판의 kind 와 같은 방식) */
var BAPP_STATE = { pending: '대기', accepted: '수락', rejected: '거절', withdrawn: '철회', closed: '종료' };

var BAPP_LIMIT = { stack: 800, note: 500 };

/**
 * 전체 일정 참석 가능 여부 — 신청서(index.html 의 06)와 같은 선택지.
 * 신청서의 이 항목은 '안 되는 날'을 체크하는 방식이라, 날짜가 들어 있으면 그날은 못 온다는 뜻이다.
 * 신청서 선택지를 바꾸면 여기도 같이 바꿔야 한다.
 */
var BAPP_SCHED = ['11/4(수)', '11/11(수)'];
var BAPP_SCHED_ALL = '모든 일정 참석 가능';

/** 한 번의 요청이 끝날 때까지만 사는 메모 (BMEMO 와 같은 역할) */
var BAMEMO = { sh: null, headers: null, rows: null, lastRow: 0 };

/** 잠금이 풀린 뒤에 보낼 메일들 */
var MAILQ = [];

/* ---- 시트 접근 ------------------------------------------------------- */

function bappSheet_() {
  if (BAMEMO.sh) return BAMEMO.sh;
  var ss = ss_();
  var sh = ss.getSheetByName(CONFIG.TEAMAPP_SHEET);
  if (!sh) {
    try { sh = ss.insertSheet(CONFIG.TEAMAPP_SHEET); }
    catch (e) { sh = ss.getSheetByName(CONFIG.TEAMAPP_SHEET); }
    if (!sh) throw new Error('팀지원 탭을 만들지 못했습니다');
  }
  return (BAMEMO.sh = sh);
}

/** 열 이름으로 읽고 쓴다. 코드가 아는 열이 빠져 있으면 끝에 덧붙인다. (boardHeaders_ 와 같은 방식) */
function bappHeaders_(sh) {
  if (BAMEMO.headers) return BAMEMO.headers;
  var last = sh.getLastColumn();
  var row = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h); }) : [];
  var fresh = row.every(function (h) { return !h; });
  if (fresh) row = [];
  var missing = BAPP_HEADERS.filter(function (h) { return row.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, row.length + 1, 1, missing.length).setValues([missing]);
    row = row.concat(missing);
  }
  if (fresh) {
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, row.length).setFontWeight('bold');
  }
  return (BAMEMO.headers = row);
}

function bappRows_(sh, headers) {
  if (BAMEMO.rows) return BAMEMO.rows;
  var last = sh.getLastRow();
  BAMEMO.lastRow = last;
  var n = last - 1;
  if (n < 1) return (BAMEMO.rows = []);

  var values = sh.getRange(2, 1, n, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var rec = {};
    for (var j = 0; j < headers.length; j++) rec[headers[j]] = values[i][j];
    if (String(rec.id || '')) out.push({ row: i + 2, rec: rec });
  }
  return (BAMEMO.rows = out);
}

/**
 * 한 행을 텍스트 서식으로 고정한 뒤 쓴다. flush 는 부르는 쪽이 한 번만 한다
 * (수락은 행을 여러 개 고치므로, 행마다 flush 하면 그만큼 느려진다).
 */
function bappWrite_(sh, headers, rec, row) {
  var target = row || (BAMEMO.lastRow || sh.getLastRow()) + 1;
  var range = sh.getRange(target, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([headers.map(function (h) { return rec[h] === undefined || rec[h] === null ? '' : rec[h]; })]);
  if (!row) {
    BAMEMO.lastRow = target;
    if (BAMEMO.rows) BAMEMO.rows.push({ row: target, rec: rec });
  }
  return target;
}

/** 게시판 탭과 팀지원 탭을 한 번씩만 읽어 둔 것. 모든 판단은 이걸로 한다. */
function bappCtx_() {
  var bsh = boardSheet_();
  var bh = boardHeaders_(bsh);
  var posts = boardRows_(bsh, bh);
  var sh = bappSheet_();
  var h = bappHeaders_(sh);
  var apps = bappRows_(sh, h);
  var byId = {};
  posts.forEach(function (r) { byId[String(r.rec.id)] = r; });
  return { bsh: bsh, bh: bh, posts: posts, byId: byId, sh: sh, h: h, apps: apps };
}

/* ---- 값 정리 --------------------------------------------------------- */

/** 줄바꿈은 살리고 공백만 정리한다 (기술스택은 여러 줄로 쓰는 칸이다). */
function bappText_(v, n) {
  return safeText_(v).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
}

/** 허용된 선택지만 받는다. '모든 일정 참석 가능' 은 혼자서만. 올바르지 않으면 null. */
function bappSched_(v) {
  var list = (Array.isArray(v) ? v : String(v || '').split(','))
    .map(function (s) { return String(s).trim(); }).filter(Boolean);
  if (!list.length) return null;
  if (list.indexOf(BAPP_SCHED_ALL) !== -1) return list.length === 1 ? BAPP_SCHED_ALL : null;
  if (!list.every(function (s) { return BAPP_SCHED.indexOf(s) !== -1; })) return null;
  return BAPP_SCHED.filter(function (s) { return list.indexOf(s) !== -1; }).join(', ');
}

/** 신청서의 소속동아리를 게시판과 같은 모양('A · B')으로. 알 수 없는 이름은 버린다. */
function bappClubs_(answers) {
  return String(answers['소속동아리'] || '').split(',')
    .map(function (c) { return c.trim(); })
    .filter(function (c) { return BOARD_CLUBS.indexOf(c) !== -1; });
}

function bappCode_(rec) {
  var s = String(rec['상태'] || '');
  for (var k in BAPP_STATE) if (BAPP_STATE[k] === s) return k;
  return '';
}

function bappIso_(v) { return (v instanceof Date) ? v.toISOString() : (v ? String(v) : ''); }
function bappWho_(rec) { return { sub: rec['계정 식별자'], email: rec['이메일'] }; }

/* ---- 묶임 확인 ------------------------------------------------------- */

/** 이 계정이 팀 글(모집 중·완료)의 조장인가 */
function bappLeads_(who, ctx) {
  return ctx.posts.some(function (r) { return String(r.rec.kind) !== 'person' && boardIsMine_(r.rec, who); });
}

/** 이 계정이 지금 합류해 있는 팀 (수락됐고 그 글이 아직 있다). 없으면 null. */
function bappJoined_(who, ctx, exceptId) {
  return ctx.apps.filter(function (a) {
    return String(a.rec.id) !== exceptId && bappCode_(a.rec) === 'accepted' &&
           ctx.byId[String(a.rec['글 id'])] && boardIsMine_(a.rec, who);
  })[0] || null;
}

/** 이 계정이 지금 열어 둔 다른 대기 지원 (아직 모집 중인 글에 한해) */
function bappPendingOthers_(who, ctx, exceptId) {
  return ctx.apps.filter(function (a) {
    if (String(a.rec.id) === exceptId || bappCode_(a.rec) !== 'pending' || !boardIsMine_(a.rec, who)) return false;
    var p = ctx.byId[String(a.rec['글 id'])];
    return p && String(p.rec.kind) === 'team';
  });
}

/** 성함·연락처는 지원서에 복사해 두지 않고 신청서에서 그때그때 읽는다. */
function bappPerson_(who) {
  var a = findMine_(who);
  return a.found
    ? { name: String(a.answers['성함'] || ''), phone: String(a.answers['연락처'] || '') }
    : { name: '', phone: '' };
}

/* ---- 화면에 내보낼 모양 ------------------------------------------------ */

/**
 * role: 'applicant'(내가 낸 지원) | 'leader'(내 글에 온 지원)
 * 이메일·계정 식별자는 어느 쪽에도 담지 않는다.
 */
function bappPublic_(a, ctx, role) {
  var rec = a.rec;
  var post = ctx.byId[String(rec['글 id'])] || null;
  var code = bappCode_(rec);
  var state = code;
  if (!post) state = 'gone';
  else if (code === 'pending' && String(post.rec.kind) === 'done') state = 'full';

  var out = {
    id: String(rec.id), postId: String(rec['글 id']),
    team: post ? String(post.rec['팀명'] || post.rec['제목'] || '') : String(rec['팀명'] || ''),
    status: code, state: state,
    club: String(rec['소속동아리'] || ''), stack: String(rec['기술스택 및 개발 경험'] || ''),
    sched: String(rec['전체 일정 참석 가능여부'] || ''), note: String(rec['하고 싶은 말'] || ''),
    showName: String(rec['이름 공개']) === 'O',
    createdAt: bappIso_(rec['지원시각']), updatedAt: bappIso_(rec['수정시각']), decidedAt: bappIso_(rec['처리시각'])
  };

  if (role === 'leader') {
    var who = bappWho_(rec);
    var accepted = code === 'accepted';
    var p = (accepted || out.showName) ? bappPerson_(who) : null;
    if (p) out.name = p.name;
    if (accepted) out.phone = p.phone;
    if (code === 'pending') {
      out.others = bappPendingOthers_(who, ctx, out.id).length;
      out.block = bappJoined_(who, ctx, out.id) ? 'joined' : (bappLeads_(who, ctx) ? 'leader' : '');
    }
  } else if (code === 'accepted' && post) {
    var lp = bappPerson_(bappWho_(post.rec));
    out.leader = { name: lp.name, phone: lp.phone };
  }
  return out;
}

/** 이 계정이 낸 지원(mine), 내 글에 온 지원(inbox), 지금 합류한 팀 이름(joined) */
function bappViews_(claims) {
  var ctx = bappCtx_();
  var out = { mine: [], inbox: [], joined: '' };
  ctx.apps.forEach(function (a) {
    var post = ctx.byId[String(a.rec['글 id'])];
    if (boardIsMine_(a.rec, claims)) {
      var v = bappPublic_(a, ctx, 'applicant');
      out.mine.push(v);
      if (v.status === 'accepted' && post) out.joined = v.team;
    }
    if (post && boardIsMine_(post.rec, claims)) out.inbox.push(bappPublic_(a, ctx, 'leader'));
  });
  var newest = function (x, y) { return x.createdAt < y.createdAt ? 1 : (x.createdAt > y.createdAt ? -1 : 0); };
  out.mine.sort(newest);
  out.inbox.sort(newest);
  return out;
}

/* ---- 쓰기 ------------------------------------------------------------ */

/** 지원하기. 같은 글에 철회·종료된 지원이 있으면 그 행을 다시 연다. */
function bappCreate_(claims, postId, d) {
  var ctx = bappCtx_();
  var post = ctx.byId[postId];
  if (!post) return { ok: false, error: 'NOT_FOUND' };
  if (boardIsMine_(post.rec, claims)) return { ok: false, error: 'OWN_POST' };
  if (String(post.rec.kind) !== 'team') return { ok: false, error: 'NOT_OPEN' };

  var prev = ctx.apps.filter(function (a) {
    return String(a.rec['글 id']) === postId && boardIsMine_(a.rec, claims);
  })[0];
  if (prev) {
    var pc = bappCode_(prev.rec);
    if (pc === 'pending' || pc === 'accepted') return { ok: false, error: 'DUP' };
    if (pc === 'rejected') return { ok: false, error: 'REJECTED' };
  }

  var app = findMine_(claims);
  if (!app.found) return { ok: false, error: 'NEED_APPLY' };
  if (bappLeads_(claims, ctx)) return { ok: false, error: 'IS_LEADER' };
  if (bappJoined_(claims, ctx, '')) return { ok: false, error: 'ALREADY_JOINED' };

  var clubs = bappClubs_(app.answers);
  var stack = bappText_(d.stack, BAPP_LIMIT.stack);
  var sched = bappSched_(d.sched);
  if (!clubs.length) return { ok: false, error: 'BAD_CLUB' };
  if (!stack) return { ok: false, error: 'BAD_STACK' };
  if (sched === null) return { ok: false, error: 'BAD_SCHED' };

  var now = new Date().toISOString();
  var isNew = !prev;
  var rec = prev ? prev.rec : {};
  if (isNew) {
    rec.id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    rec['글 id'] = postId;
    rec['계정 식별자'] = String(claims.sub); rec['이메일'] = String(claims.email);
  }
  rec['팀명'] = cut_(post.rec['팀명'] || post.rec['제목'], BOARD_LIMIT.team);
  rec['소속동아리'] = clubs.join(' · ');            // 신청서에서 서버가 가져와 고정 (클라이언트 값은 안 본다)
  rec['기술스택 및 개발 경험'] = stack;
  rec['전체 일정 참석 가능여부'] = sched;
  rec['하고 싶은 말'] = bappText_(d.note, BAPP_LIMIT.note);
  rec['이름 공개'] = d.showName ? 'O' : '';
  rec['상태'] = BAPP_STATE.pending;
  rec['지원시각'] = now; rec['수정시각'] = now; rec['처리시각'] = '';

  bappWrite_(ctx.sh, ctx.h, rec, prev ? prev.row : 0);
  SpreadsheetApp.flush();

  if (isNew) {
    bappMailLater_(post.rec['이메일'],
      '[ENDPoinT] "' + rec['팀명'] + '" 팀에 새 지원이 도착했습니다',
      '안녕하세요, ENDPoinT 운영진입니다.\n\n' +
      '"' + rec['팀명'] + '" 팀 모집글에 새 지원이 도착했습니다.\n' +
      '아래 팀 모집 페이지에서 내용을 확인하고 수락 또는 거절해 주세요.\n\n' +
      CONFIG.SITE_URL + '\n\n' +
      '※ 팀 모집글을 올린 계정으로 자동 발송된 메일입니다.');
  }
  return { ok: true, app: bappPublic_({ row: 0, rec: rec }, ctx, 'applicant') };
}

/** 내 지원 수정 — 대기 중일 때만. 소속동아리는 고칠 수 없다. */
function bappEdit_(claims, id, d) {
  var ctx = bappCtx_();
  var hit = ctx.apps.filter(function (a) { return String(a.rec.id) === id; })[0];
  if (!hit) return { ok: false, error: 'NOT_FOUND' };
  if (!boardIsMine_(hit.rec, claims)) return { ok: false, error: 'FORBIDDEN' };
  if (bappCode_(hit.rec) !== 'pending') return { ok: false, error: 'BAD_STATE' };
  var rec = hit.rec;

  if (d.stack !== undefined) {
    var stack = bappText_(d.stack, BAPP_LIMIT.stack);
    if (!stack) return { ok: false, error: 'BAD_STACK' };
    rec['기술스택 및 개발 경험'] = stack;
  }
  if (d.sched !== undefined) {
    var sched = bappSched_(d.sched);
    if (sched === null) return { ok: false, error: 'BAD_SCHED' };
    rec['전체 일정 참석 가능여부'] = sched;
  }
  if (d.note !== undefined) rec['하고 싶은 말'] = bappText_(d.note, BAPP_LIMIT.note);
  if (d.showName !== undefined) rec['이름 공개'] = d.showName ? 'O' : '';

  rec['수정시각'] = new Date().toISOString();
  bappWrite_(ctx.sh, ctx.h, rec, hit.row);
  SpreadsheetApp.flush();
  return { ok: true, app: bappPublic_(hit, ctx, 'applicant') };
}

/**
 * 철회. 대기 중이면 지원을 거두고, 수락된 뒤라면 팀에서 나가는 것이라 그 팀의 현재 인원도 1 줄인다.
 */
function bappCancel_(claims, id) {
  var ctx = bappCtx_();
  var hit = ctx.apps.filter(function (a) { return String(a.rec.id) === id; })[0];
  if (!hit) return { ok: false, error: 'NOT_FOUND' };
  if (!boardIsMine_(hit.rec, claims)) return { ok: false, error: 'FORBIDDEN' };
  var code = bappCode_(hit.rec);
  if (code !== 'pending' && code !== 'accepted') return { ok: false, error: 'BAD_STATE' };

  var now = new Date().toISOString();
  hit.rec['상태'] = BAPP_STATE.withdrawn;
  hit.rec['수정시각'] = now; hit.rec['처리시각'] = now;
  bappWrite_(ctx.sh, ctx.h, hit.rec, hit.row);

  if (code === 'accepted') {
    var post = ctx.byId[String(hit.rec['글 id'])];
    if (post) {
      post.rec['현재 인원'] = Math.max(1, (Number(post.rec['현재 인원']) || 1) - 1);
      post.rec['수정시각'] = now;
      boardWrite_(ctx.bsh, ctx.bh, post.rec, post.row);
    }
  }
  SpreadsheetApp.flush();
  return { ok: true };
}

/**
 * 조장의 수락·거절.
 * 수락하면 (1) 지원을 '수락'으로, (2) 글의 현재 인원 +1, (3) 이 사람의 다른 대기 지원을 모두 '종료'로.
 * 순서대로 쓰므로 중간에 끊기면 인원만 어긋날 수 있는데, 인원은 조장이 직접 고칠 수 있다.
 */
function bappDecide_(claims, id, d) {
  var to = String(d.to || '');
  if (to !== 'accept' && to !== 'reject') return { ok: false, error: 'BAD_ACTION' };

  var ctx = bappCtx_();
  var hit = ctx.apps.filter(function (a) { return String(a.rec.id) === id; })[0];
  if (!hit) return { ok: false, error: 'NOT_FOUND' };
  var post = ctx.byId[String(hit.rec['글 id'])];
  if (!post) return { ok: false, error: 'NOT_FOUND' };
  if (!boardIsMine_(post.rec, claims)) return { ok: false, error: 'FORBIDDEN' };
  if (bappCode_(hit.rec) !== 'pending') return { ok: false, error: 'BAD_STATE' };

  var now = new Date().toISOString();
  var rec = hit.rec;

  if (to === 'reject') {
    rec['상태'] = BAPP_STATE.rejected;
    rec['수정시각'] = now; rec['처리시각'] = now;
    bappWrite_(ctx.sh, ctx.h, rec, hit.row);
    SpreadsheetApp.flush();
    return { ok: true };
  }

  /* 수락 */
  if (String(post.rec.kind) !== 'team') return { ok: false, error: 'NOT_OPEN' };
  var have = Number(post.rec['현재 인원']) || 1;
  var cap = Number(post.rec['정원']) || 0;
  if (have >= cap) return { ok: false, error: 'FULL' };

  var who = bappWho_(rec);
  if (bappJoined_(who, ctx, String(rec.id))) return { ok: false, error: 'APPLICANT_JOINED' };
  if (bappLeads_(who, ctx)) return { ok: false, error: 'APPLICANT_LEADER' };

  rec['상태'] = BAPP_STATE.accepted;
  rec['수정시각'] = now; rec['처리시각'] = now;
  bappWrite_(ctx.sh, ctx.h, rec, hit.row);

  post.rec['현재 인원'] = have + 1;
  post.rec['수정시각'] = now;
  boardWrite_(ctx.bsh, ctx.bh, post.rec, post.row);

  // 이 사람이 다른 팀에 걸어 둔 대기 지원을 끊는다
  bappPendingOthers_(who, ctx, String(rec.id)).forEach(function (o) {
    o.rec['상태'] = BAPP_STATE.closed;
    o.rec['수정시각'] = now; o.rec['처리시각'] = now;
    bappWrite_(ctx.sh, ctx.h, o.rec, o.row);
  });
  SpreadsheetApp.flush();

  var team = cut_(post.rec['팀명'] || post.rec['제목'], BOARD_LIMIT.team);
  bappMailLater_(rec['이메일'],
    '[ENDPoinT] "' + team + '" 팀 지원이 수락되었습니다',
    '안녕하세요, ENDPoinT 운영진입니다.\n\n' +
    '"' + team + '" 팀에서 지원을 수락했습니다.\n' +
    '조장의 연락처는 아래 팀 모집 페이지의 "내 지원" 에서 확인할 수 있습니다.\n\n' +
    CONFIG.SITE_URL + '\n\n' +
    '※ 지원하신 계정으로 자동 발송된 메일입니다.');
  return { ok: true };
}

/* ---- 메일 ------------------------------------------------------------ */

/** 보낼 메일을 줄 세워 둔다. 실제 발송은 잠금이 풀린 뒤 bappMailFlush_ 가 한다. */
function bappMailLater_(to, subject, body) {
  if (!CONFIG.NOTIFY || !to) return;
  MAILQ.push({ to: String(to), subject: String(subject).replace(/\s+/g, ' '), body: String(body) });
}

/** 메일은 절대 요청을 실패시키지 않는다. 권한이 없거나 하루 한도를 넘으면 조용히 건너뛴다. */
function bappMailFlush_() {
  if (!MAILQ.length) return;
  var q = MAILQ;
  MAILQ = [];
  try {
    var left = MailApp.getRemainingDailyQuota();
    q.forEach(function (m) {
      if (left <= 0) return;
      try {
        MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.body, name: 'ENDPoinT' });
        left--;
      } catch (e) { Logger.log('메일 실패: ' + e); }
    });
  } catch (e2) { Logger.log('메일 건너뜀: ' + e2); }
}

/**
 * 메일 권한을 승인하고 동작을 확인하는 함수. 편집기에서 한 번 실행한다.
 * 실행하면 "권한 검토" 창이 뜨고, 승인하면 내 메일함으로 확인 메일이 한 통 온다.
 */
function mailTest() {
  var me = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(me, '[ENDPoinT] 메일 권한 확인', '이 메일이 보이면 Apps Script 메일 발송 권한이 정상입니다.');
  Logger.log('보냄: ' + me + ' / 오늘 남은 발송 한도: ' + MailApp.getRemainingDailyQuota());
}
