/**
 * ENDPoinT 결과물 제출 (Google Apps Script 웹 앱)
 * ---------------------------------------------------------------
 * 사이트의 제출 페이지(/submit/)와 심사위원 열람 페이지(/judge/)가 쓰는 백엔드다.
 * 신청서 백엔드(apps-script/Code.gs)와는 **다른 Apps Script 프로젝트**로 배포한다 —
 * 여기는 Drive 권한이 필요하고, 문제가 생겨도 신청서·공지 쪽이 영향을 받지 않아야 하기 때문이다.
 *
 * 무엇을 하나
 *   - 구글 로그인(ID 토큰)에서 계정을 확인하고, `팀원` 탭에서 그 계정이 몇 팀인지 찾는다.
 *     한 번 확인한 뒤에는 이 스크립트가 만든 세션 값으로 이어 간다 (구글 토큰은 한 시간이면 끝나기 때문).
 *   - 프로젝트 이름·설명·배포 주소는 `팀` 탭에만 적는다.
 *   - 프로그램 파일과 발표 자료는 Drive 의 팀 폴더로 올라간다. 파일 본문은 이 스크립트를 거치지 않고
 *     브라우저가 Drive 로 직접 보낸다 (이어 올리기 주소만 여기서 발급한다). 직접 보내기가 막힌 환경이면
 *     조각을 이 스크립트가 받아 Drive 로 넘겨 준다 (느리지만 어디서나 된다).
 *   - 파일 하나가 `파일` 탭 한 줄이다 (색인). 어느 폴더에 어떤 이름으로 있는지 이 탭이 기준이다.
 *     다시 올리면 먼젓번 파일은 팀 폴더 안의 '옛날 자료' 로 옮기고 그 줄의 상태·경로를 바꾼다. 지우지 않는다.
 *   - 심사위원·운영진은 열람 토큰으로 전체 팀의 제출 현황을 보고 파일을 받는다 (Drive 권한이 없어도 된다).
 *   - 발표가 끝나면 참가자가 구글 로그인으로 인기투표를 한다 (/judge/vote/, 트랙별 1인 3표). 아래 '참가자 인기투표' 절.
 *   - 심사위원(열람 토큰)은 현황판에서 팀마다 4문항 점수(소수점)와 코멘트를 적고, 운영진은 종합(/judge/score/)을 본다.
 *     점수는 제출 폴더와 나란한 '심사위원' 폴더의 'ENDPoinT 2026 심사' 시트에 쌓인다. 아래 '심사위원 평가' 절.
 *
 * 누가 무엇을 보나
 *   참가자   자기 팀 것만. 다른 팀 자료는 응답에 아예 담기지 않는다.
 *   심사위원 열람 토큰이 있어야 하고, 전체 팀을 본다. Drive 주소는 받지 못한다 (파일은 이 스크립트가 넘겨 준다).
 *   운영진   열람 토큰(역할 '운영진')이면 Drive 주소까지. ADMINS 에 있는 계정은 제출 페이지에서 팀을 골라 대신 올릴 수 있다.
 *
 * 배포: SUBMIT.md 참고. 실행 계정 '나', 액세스 '모든 사용자'.
 * 코드를 고치면 "배포 관리 → 편집 → 버전: 새 버전" 으로 다시 배포해야 반영된다.
 */

var CONFIG = {
  // 사이트의 EPCONFIG.CLIENT_ID 와 같은 값. 이 클라이언트로 발급된 로그인 토큰만 받는다.
  CLIENT_ID: '100824066944-7s6di7cbhsedtnms675fka8bbbka3u7p.apps.googleusercontent.com',

  // 열람 링크를 만들 때 쓰는 사이트 주소
  SITE_URL: 'https://2026endpoint.github.io',

  // 브라우저가 Drive 로 직접 올릴 수 있게 허용할 출처. 여기 없는 출처에서 온 요청은 중계 방식으로만 올라간다.
  ORIGINS: [
    'https://2026endpoint.github.io',
    'http://localhost:5501', 'http://localhost:5173', 'http://localhost:8000', 'http://127.0.0.1:3000'
  ],

  // 제출물을 쌓을 Drive 폴더 ID. 비우면 이 스프레드시트가 들어 있는 폴더를 쓴다.
  // (스크립트 속성 ROOT_FOLDER_ID 로도 줄 수 있다)
  ROOT_FOLDER_ID: '',

  // 팀 repo 주소를 만들 때 쓴다: https://github.com/<ORG>/<REPO>  ({no} 는 01 같은 두 자리 팀 번호)
  ORG: '2026ENDPoinT',
  REPO: 'team{no}',

  // 팀 번호 → 트랙. 적은 순서가 화면 순서다 (본선 발표 순서: 해커톤 → 구현과제)
  // key 는 투표 시각 설정 이름에 쓴다 (VOTE_H_FROM · VOTE_A_UNTIL …)
  TRACKS: [
    { key: 'H', name: '해커톤', from: 11, to: 20 },
    { key: 'A', name: '구현과제', from: 1, to: 10 }
  ],

  // 참가자 인기투표: 트랙마다 1인 VOTE_MAX 표, 한 팀에 1표. VOTE_SELF 가 false 면 자기 팀에는 못 준다.
  // (스크립트 속성 VOTE_MAX · VOTE_SELF 로 바꿀 수 있다)
  VOTE_MAX: 3,
  VOTE_SELF: false,

  // 투표가 저절로 열리고 닫히는 시각 (본선 시간표의 휴식 · 투표 시간). FROM 을 비우면 운영진이 열 때까지 닫혀 있고,
  // UNTIL 을 비우면 운영진이 마감할 때까지 열려 있다. 투표 페이지의 운영진 버튼(지금 열기 · 마감 · 5분 연장 · 5분 늦추기)은
  // 같은 이름의 스크립트 속성에 시각을 적는다 — 속성이 있으면 여기 값보다 앞선다. '시간표대로' 를 누르면 속성을 지운다.
  VOTE_H_FROM: '2026-11-14T12:12:00+09:00',
  VOTE_H_UNTIL: '2026-11-14T12:27:00+09:00',
  VOTE_A_FROM: '2026-11-14T14:15:00+09:00',
  VOTE_A_UNTIL: '2026-11-14T14:25:00+09:00',
  // 마감한 뒤 '다시 열기' 를 누르면 이만큼(분) 열었다가 저절로 닫는다 (투표 · 심사 공통)
  REOPEN_MIN: 10,
  // 공개 현황판(/judge/ — 열람 링크 없이, 메인 메뉴 '제출·투표 현황')을 새로 세는 간격(초). 그 사이에는 같은 값을 보여 준다
  BOARD_SUBMIT_SEC: 300,
  BOARD_VOTE_SEC: 60,
  // 참가자 점수 P 의 만점은 100 × (1 − JUDGE_WEIGHT) = 15점. 그 트랙 팀당 평균 득표의 POP_FULL_X 배를 받으면 만점이다.
  POP_FULL_X: 2,

  // 심사위원 평가: 두 트랙 공통 4문항 · 각 25점, 100점 (조직 소개의 심사 기준). 점수는 소수점 둘째 자리까지 받는다.
  CRITERIA: [
    { key: 'idea', name: '문제 정의 · 아이디어', max: 25 },
    { key: 'done', name: '완성도', max: 25 },
    { key: 'ux', name: '사용자 경험', max: 25 },
    { key: 'arch', name: '구조적 이해', max: 25 }
  ],
  // 최종 점수 S = JUDGE_WEIGHT × (심사위원 원점수 평균) + 참가자 점수 P. 동점이면 심사위원 점수 → TIE_KEY 문항 평균 순
  JUDGE_WEIGHT: 0.85,
  TIE_KEY: 'arch',
  // 심사위원이 점수를 고칠 수 있는 마지막 시각 (투표 취합 시작). 비우면 운영진이 마감할 때까지.
  // 종합 화면의 '심사 마감' · '다시 열기' 는 스크립트 속성 SCORE_UNTIL 에 시각을 적는다.
  SCORE_UNTIL: '2026-11-14T14:25:00+09:00',
  // 결과 발표: 운영진이 종합 화면에서 '심사 마감'(또는 '결과 발표')을 누르면 메인 페이지에 등수가 뜬다.
  // 그 단추가 스크립트 속성 RESULTS_AT 에 지금 시각을 적는다. 'off' = 누를 때까지 안 뜸 (14:25 자동 마감으로는 뜨지 않는다 — 발표 전에 새지 않게).
  // 시각을 적어 두면 그 시각에 (심사 · 투표가 다 마감돼 있으면) 저절로, 'none' 이면 마감되는 대로 바로.
  RESULTS_AT: 'off',
  // 등수마다 받는 팀 수 — 메인 페이지 상금표와 같게 (해커톤 1등 1 · 2등 2 · 3등 3, 구현과제 1 – 4등 각 1)
  PRIZES: { H: [1, 2, 3], A: [1, 1, 1, 1] },
  // 팀을 다른 트랙으로 옮긴다 (번호 범위와 다르게). 스크립트 속성 TRACK_MOVES 에 '09:H' 처럼 (여러 팀은 '09:H, 03:A').
  // 트랙은 키(H · A)나 이름(해커톤 · 구현과제). 지우면 원래대로. 바꾼 뒤 시트 메뉴 '현황 새로 읽기 (캐시 비우기)'.
  TRACK_MOVES: '',
  // 점수를 적는 스프레드시트: 제출 폴더와 나란한 이 이름의 폴더 안, 이 이름의 시트 (처음 설정이 찾거나 만든다)
  SCORE_FOLDER_NAME: '심사위원',
  SCORE_SHEET_NAME: 'ENDPoinT 2026 심사',

  // 제출을 여는 시각. 비우면 처음부터 열려 있다.
  OPEN_AT: '',
  // 마감. 이 시각 뒤에는 새로 올리거나 고칠 수 없다. (스크립트 속성 DEADLINE 으로 재배포 없이 바꿀 수 있다 — 1분 안에 반영)
  DEADLINE: '2026-11-14T10:00:00+09:00',
  // 마감 전에 올리기 시작한 파일이 끝까지 올라오도록 봐주는 시간(분)
  GRACE_MIN: 5,

  // 한 팀이 쌓아 둘 수 있는 전체 용량(GB) — 지금 제출물과 옛날 자료를 합친 것. 0 이면 제한하지 않는다.
  // 한 팀이 저장 공간을 다 써서 다른 팀이 못 올리는 일을 막으려는 것이다. (스크립트 속성 TEAM_MAX_GB 로 바로 바꿀 수 있다)
  TEAM_MAX_GB: 6,

  // 열람 링크의 기본 만료 시각
  VIEW_UNTIL: '2026-11-15T00:00:00+09:00',

  // 운영진 구글 계정 (소문자 비교). 공개 저장소에 올라가므로 여기 말고 스크립트 속성 ADMINS 에 쉼표로 적는다.
  ADMINS: [],

  // 명단을 만들 때 읽는 신청서 스프레드시트 (SubmitAdmin.gs 의 rosterBuild)
  APPLY_SHEET_ID: '1OuBWYahA6O3JIpN3ITZdqsH8wB64_Tb1diamCjOq97U',
  APPLY_TAB: '웹신청',
  TEAMS_TAB: '팀편성_현황',
  // 참가자가 따로 알려 준 주소(예: 단체 대화방에 적은 이메일)를 모아 둔 스프레드시트의 이름.
  // 제출 폴더 안에 이 이름의 시트(열: 팀 · 이름 · 이메일)가 있으면 명단을 만들 때 같이 읽는다. 없으면 건너뛴다.
  ROSTER_EXTRA_NAME: '팀원 추가 계정'
};

var API_VERSION = 1;
var MB = 1024 * 1024;

/** 받는 파일 종류. exts 는 소문자 확장자, max 는 바이트. */
var KINDS = {
  deck: {
    label: '발표',
    // PowerPoint 계열 · odp 는 받으면 보기용 PDF 를 만든다 (PDF_FROM). key(Keynote)는 Google 이 바꾸지 못한다 — PDF 로 내보내 올리게 안내
    exts: ['pdf', 'pptx', 'ppt', 'pptm', 'ppsx', 'pps', 'potx', 'pot', 'key', 'odp', 'mp4', 'mov', 'webm', 'zip'],
    max: 300 * MB
  },
  program: {
    label: '프로그램',
    exts: ['zip', '7z', 'tar', 'gz', 'tgz', 'rar', 'apk', 'aab', 'exe', 'msi', 'dmg', 'pkg', 'jar', 'appimage', 'deb'],
    max: 1024 * MB
  }
};

var MIME = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12', pps: 'application/vnd.ms-powerpoint',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow', pot: 'application/vnd.ms-powerpoint',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  key: 'application/vnd.apple.keynote',
  odp: 'application/vnd.oasis.opendocument.presentation',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  zip: 'application/zip', '7z': 'application/x-7z-compressed', tar: 'application/x-tar',
  gz: 'application/gzip', tgz: 'application/gzip', rar: 'application/vnd.rar',
  apk: 'application/vnd.android.package-archive', jar: 'application/java-archive',
  dmg: 'application/x-apple-diskimage', deb: 'application/vnd.debian.binary-package'
};

/** 조각 크기. Drive 의 이어 올리기는 마지막 조각을 빼고 256KB 의 배수여야 한다. */
var CHUNK = 8 * MB;          // 브라우저 → Drive 직접
var RELAY_CHUNK = 4 * MB;    // 브라우저 → 이 스크립트 → Drive
var RELAY_MAX = 6 * MB;
var DL_CHUNK = 4 * MB;       // 내려받기 한 조각
var DL_MAX = 8 * MB;

var TEST_TEAM = '00';        // 운영진이 연습할 때 쓰는 팀. 심사위원에게는 보이지 않는다.
var OLD_NAME = '옛날 자료';
var STATE_TTL = 300;         // 팀 상태 캐시(초). 쓰기가 있을 때마다 새로 채운다.

/** 시트 탭과 열. 열은 이름으로 찾으므로 운영진이 열을 끼워 넣어도 어긋나지 않는다. */
var TABS = {
  team:   { name: '팀',   head: ['팀', '트랙', '프로젝트', '설명', '배포 주소', '프로그램', '발표 자료', '데모 영상', '완료', '마지막 제출', '제출자', '폴더', '순서', '메모'] },
  // PDF ID · PDF 크기 = PPT 등을 올렸을 때 Drive 로 만든 보기용 PDF (심사위원 화면이 연다). 원본은 그대로
  file:   { name: '파일', head: ['번호', '팀', '종류', '버전', '상태', '경로', '이름', '원래 이름', '크기', 'md5', '형식', '올린 시각', '올린 사람', 'Drive ID', '링크', 'PDF ID', 'PDF 크기'] },
  member: { name: '팀원', head: ['팀', '이름', '이메일', '계정 식별자', '역할', '상태', '비고', '출처'] },
  // 검증 = 이름과 토큰 해시를 비밀 솔트와 묶은 값. 시트에서 이름을 바꾸면 그 토큰은 더 통하지 않는다
  view:   { name: '열람', head: ['이름', '역할', '토큰 해시', '만든 시각', '만료', '사용', '마지막 접속', '검증'] },
  log:    { name: '기록', head: ['시각', '누가', '팀', '동작', '대상', '메모'] },
  // 표 한 장이 한 줄. 누가 냈는지 대신 익명 표시만, 대상 팀과 함께 검증값(비밀 솔트를 섞은 SHA-256)을 남긴다.
  vote:   { name: '투표', head: ['번호', '시각', '트랙', '투표지', '투표자(익명)', '투표자 팀', '대상 팀', '검증', '상태'] },
  // 심사위원 한 명이 한 팀에 준 점수가 한 줄 ('심사' 시트 — book: 'score')
  score:  { name: '점수', book: 'score', head: ['심사위원', '심사위원 ID', '팀', '트랙'].concat(CONFIG.CRITERIA.map(function (c) { return c.name; }), ['합계', '코멘트', '저장 시각']) }
};
/** 숫자로 두는 열과 그 표시 형식 (나머지 열은 전부 글자 서식) */
var NUMERIC = { '번호': '0', '버전': '0', '크기': '0', '합계': '0.00', 'PDF 크기': '0' };
CONFIG.CRITERIA.forEach(function (c) { NUMERIC[c.name] = '0.00'; });

/** 한 번의 요청이 끝날 때까지만 사는 메모. 실행마다 새로 만들어진다. */
var MEMO = {};

/* ================================================================
   들어오는 곳
   ================================================================ */

/** 배포 확인 · 시계 맞추기 · 미리 깨우기. 로그인 없이 누구나 받는다 — 비밀은 담지 않는다. */
function doGet(e) {
  MEMO = {};
  return json_({
    ok: true, service: 'ENDPoinT submit', api: API_VERSION,
    now: nowMs_(), openAt: openMs_(), deadline: deadlineMs_(), graceMin: graceMin_(), phase: phase_()
  });
}

function doPost(e) {
  MEMO = {};
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!body || typeof body !== 'object') body = {};
    out = route_(String(body.action || ''), body);
  } catch (err) {
    var msg = String((err && err.message) || err);
    if (msg === 'BUSY' || msg === 'AUTH_BUSY') out = { ok: false, error: msg };
    else {
      // 기록과 응답에 주소가 그대로 남지 않게 한다 (올리기 주소 · 토큰이 섞여 있을 수 있다)
      var hide = function (s) { return String(s).replace(/https?:\/\/[^\s'"]+/g, '(주소)'); };
      try { console.error(hide(err && err.stack ? err.stack : msg)); } catch (e2) {}
      out = { ok: false, error: /^DRIVE_/.test(msg) ? msg.split(':')[0] : 'SERVER_ERROR', message: hide(msg).slice(0, 200) };
    }
  }
  return json_(out);
}

function route_(action, body) {
  switch (action) {
    case 'me':            return actMe_(body);
    case 'session.keep':  return actSessionKeep_(body);
    case 'signout':       return actSignout_(body);
    case 'info.save':     return actInfoSave_(body);
    case 'upload.start':  return actUploadStart_(body);
    case 'upload.put':    return actUploadPut_(body);
    case 'upload.status': return actUploadStatus_(body);
    case 'upload.finish': return actUploadFinish_(body);
    case 'upload.cancel': return actUploadCancel_(body);
    case 'file.withdraw': return actWithdraw_(body);
    case 'file.get':      return actFileGet_(body);
    case 'view.list':     return actViewList_(body);
    case 'vote.me':       return actVoteMe_(body);
    case 'vote.submit':   return actVoteSubmit_(body);
    case 'vote.admin':    return actVoteAdmin_(body);
    case 'score.save':    return actScoreSave_(body);
    case 'score.summary': return actScoreSummary_(body);
    case 'score.state':   return actScoreState_(body);
    case 'status.public': return actStatusPublic_(body);
    case 'results.public': return actResultsPublic_(body);
    case 'results.state': return actResultsState_(body);
    case 'results.award': return actResultsAward_(body);
    case 'deck.pdf':      return actDeckPdf_(body);
    default:              return fail_('UNKNOWN_ACTION');
  }
}

/* ================================================================
   참가자: 내 팀 상태 · 정보 저장
   ================================================================ */

function actMe_(body) {
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  var base = {
    ok: true, api: API_VERSION,
    now: nowMs_(), openAt: openMs_(), deadline: deadlineMs_(), graceMin: graceMin_(), phase: phase_(),
    email: a.email, admin: a.admin, limits: limits_()
  };
  if (a.admin) base.teams = teamList_(true);
  // 명단에 있는 사람(과 운영진)에게만 세션을 준다 — 아무 구글 계정이나 캐시를 채우지 못하게
  if (a.team || a.admin) {
    var ses = sessionOpen_(a.claims);
    if (ses) { base.sid = ses.sid; base.sidLeft = ses.left; }
  }
  if (!a.team) {
    if (a.admin) { base.team = null; return base; }
    // 명단에 없는 계정. 어느 주소로 로그인했는지는 본인 것이라 알려 준다 (운영진에게 전달하라고).
    return { ok: false, error: 'NOT_MEMBER', email: a.email, now: base.now, deadline: base.deadline, phase: base.phase };
  }
  base.team = { no: a.team, track: trackOf_(a.team), name: a.name, proxy: a.proxy };
  base.state = stateOut_(stateOf_(a.team), 'member');
  return base;
}

/** 열어 둔 화면이 가끔 불러서 로그인을 이어 간다. 세션 값이 살아 있을 때만 된다. */
function actSessionKeep_(body) {
  var c = session_(body.sid);
  if (!c) return fail_('AUTH_FAILED');
  var ses = sessionOpen_(c);
  return { ok: true, now: nowMs_(), sid: c.sid, sidLeft: ses ? ses.left : Math.max(0, c.exp - Math.floor(nowMs_() / 1000)) };
}

/** 로그아웃: 세션 값을 버린다. */
function actSignout_(body) {
  var k = sidKey_(body.sid);
  if (k) cacheDrop_(k);
  return { ok: true };
}

function actInfoSave_(body) {
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  if (!a.team) return fail_('NOT_MEMBER', { email: a.email });
  var g = gate_(a, 'edit');
  if (g) return fail_(g);

  var d = (body.data && typeof body.data === 'object') ? body.data : {};
  var v = {}, bad = [];
  if (d.title !== undefined) v['프로젝트'] = clean_(d.title, 60, false);
  if (d.desc !== undefined) v['설명'] = clean_(d.desc, 300, true);
  if (d.url !== undefined) { var u = url_(d.url); if (u === null) bad.push('url'); else v['배포 주소'] = u; }
  if (d.video !== undefined) { var w = url_(d.video); if (w === null) bad.push('video'); else v['데모 영상'] = w; }
  if (bad.length) return fail_('INVALID', { fields: bad });
  if (!Object.keys(v).length) return fail_('INVALID', { fields: [] });

  return once_(a, body.nonce, function () {
    withLock_(function () { teamPatch_(a, v); });               // 잠근 채로는 `팀` 탭 한 줄만 — 기록 · 다시 읽기는 풀고 나서
    log_(a, 'info.save', '', Object.keys(v).join(', '));
    var st = refreshStates_()[a.team];
    return { ok: true, state: stateOut_(st, 'member') };
  });
}

/* ================================================================
   참가자: 파일 올리기
   ----------------------------------------------------------------
   start  → 종류·크기·형식을 검사하고 Drive 이어 올리기 주소를 발급한다. `파일` 탭에 '업로드 중' 한 줄.
   (브라우저가 그 주소로 직접 PUT. 막히면 put 으로 조각을 넘긴다)
   finish → Drive 에 정말 올라왔는지 확인하고, 이름을 규칙대로 바꾸고, 먼젓번 파일을 옛날 자료로 옮긴다.
   ================================================================ */

function actUploadStart_(body) {
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  if (!a.team) return fail_('NOT_MEMBER', { email: a.email });
  var g = gate_(a, 'edit');
  if (g) return fail_(g);

  var kind = String(body.kind || ''), K = KINDS[kind];
  if (!K) return fail_('BAD_KIND');
  var orig = fileName_(body.name), ext = ext_(orig);
  if (!ext || K.exts.indexOf(ext) === -1) return fail_('BAD_TYPE', { allowed: K.exts });
  var size = Number(body.size);
  if (!(size > 0) || size !== Math.floor(size)) return fail_('BAD_SIZE');
  if (size > K.max) return fail_('TOO_LARGE', { max: K.max });
  if (!a.proxy) {
    var cap = teamCap_(), used = cap ? teamBytes_(a.team) : 0;
    if (cap && used + size > cap) return fail_('TEAM_FULL', { max: cap, used: used });
  }
  if (!hit_('up:' + a.team, 40, 1800)) return fail_('TOO_MANY');

  return once_(a, body.nonce, function () {
    var folders = folders_(a.team);
    var mime = MIME[ext] || 'application/octet-stream';
    var driveId = driveNewId_();
    // 올라오는 동안의 이름. 끝나면 finish 가 규칙대로 바꾼다.
    var temp = 'team' + a.team + '_' + K.label + '_올리는중_' + rand_(6) + '.' + ext;
    var origin = origin_(body.origin);
    var session = driveSession_({ id: driveId, name: temp, parents: [folders.team], mimeType: mime }, mime, size, origin);

    var id = withLock_(function () {
      var t = table_('file', true);
      var n = nextId_(t);
      put_(t, 0, {
        '번호': n, '팀': a.team, '종류': K.label, '버전': '', '상태': '업로드 중',
        '경로': '/team' + a.team + '/', '이름': temp, '원래 이름': orig, '크기': size, 'md5': '',
        '형식': mime, '올린 시각': kst_(nowMs_()), '올린 사람': byLabel_(a), 'Drive ID': driveId, '링크': ''
      });
      return n;
    });
    cachePut_('tk1:' + id, { s: session.url, team: a.team, kind: kind, size: size, drive: driveId }, 21600);
    log_(a, 'upload.start', '#' + id, K.label + ' · ' + orig + ' · ' + size + 'B');
    return { ok: true, id: id, url: session.url, direct: session.direct, chunk: CHUNK, relayChunk: RELAY_CHUNK };
  });
}

/** 중계 올리기 — 브라우저가 Drive 로 직접 보내지 못할 때만 쓴다. 조각 하나(base64)를 받아 그대로 넘긴다. */
function actUploadPut_(body) {
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  if (!a.team) return fail_('NOT_MEMBER');
  var g = gate_(a, 'finish');
  if (g) return fail_(g);
  var tk = ticket_(body.id);
  if (!tk) return fail_('SESSION_LOST');
  if (tk.team !== a.team) return fail_('FORBIDDEN');

  var bytes;
  try { bytes = Utilities.base64Decode(String(body.data || '')); } catch (e) { return fail_('BAD_DATA'); }
  var offset = Number(body.offset), len = bytes.length;
  if (!(offset >= 0) || offset !== Math.floor(offset) || !len || len > RELAY_MAX || offset + len > tk.size) return fail_('BAD_RANGE');

  var res = UrlFetchApp.fetch(tk.s, {
    method: 'put', contentType: 'application/octet-stream', payload: bytes,
    headers: { 'Content-Range': 'bytes ' + offset + '-' + (offset + len - 1) + '/' + tk.size },
    muteHttpExceptions: true, followRedirects: false
  });
  return sessionReply_(res, tk.size);
}

/** 어디까지 올라갔는지. 끊긴 뒤 이어 올릴 때 브라우저가 묻는다. */
function actUploadStatus_(body) {
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  if (!a.team) return fail_('NOT_MEMBER');
  var tk = ticket_(body.id);
  if (!tk) return fail_('SESSION_LOST');
  if (tk.team !== a.team) return fail_('FORBIDDEN');
  var res = UrlFetchApp.fetch(tk.s, {
    method: 'put', payload: '', headers: { 'Content-Range': 'bytes */' + tk.size },
    muteHttpExceptions: true, followRedirects: false
  });
  return sessionReply_(res, tk.size);
}

function actUploadFinish_(body) {
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  if (!a.team) return fail_('NOT_MEMBER');
  var id = Number(body.id);
  if (!(id > 0)) return fail_('BAD_ID');
  var g = gate_(a, 'finish');
  if (g) return fail_(g);
  return finishUpload_(a, id);
}

/**
 * 올리기를 마무리한다. a 는 actor_ 가 돌려준 것과 같은 모양 (운영진 메뉴의 '제출로 인정' 도 이 함수를 쓴다).
 * 시각 검사(gate_)는 부르는 쪽이 한다.
 */
function finishUpload_(a, id) {
  // 1) 색인에서 이 표를 찾는다. (여기서는 잠그지 않고 읽고, 쓸 때 잠근 뒤 다시 확인한다)
  var t0 = table_('file', true), i0 = findFile_(t0, id);
  if (i0 < 0) return fail_('NOT_FOUND');
  var r0 = t0.rows[i0], c = t0.col;
  if (teamNo_(r0[c['팀']]) !== a.team) return fail_('NOT_FOUND');     // 남의 팀 표는 있는지도 알려 주지 않는다
  var st0 = str_(r0[c['상태']]);
  if (st0 === '현재') return { ok: true, already: true, state: stateOut_(stateOf_(a.team), 'member') };
  if (st0 !== '업로드 중' && !(a.proxy && st0 === '끊김')) return fail_('BAD_STATE');
  var kind = kindOf_(r0[c['종류']]), K = KINDS[kind];
  if (!K) return fail_('BAD_STATE');
  var driveId = str_(r0[c['Drive ID']]);
  // 마감 뒤에 시작한 것은 유예를 받지 못한다 (운영진 대리는 예외)
  if (!a.proxy && deadlineMs_() && time_(r0[c['올린 시각']]) > deadlineMs_()) return fail_('LATE');

  // 2) Drive 에 정말 다 올라왔는지
  var folders = folders_(a.team);
  var meta = driveMeta_(driveId);
  if (!meta || meta.trashed) return fail_('NOT_UPLOADED');
  var size = Number(meta.size) || 0;
  if (!size) return fail_('EMPTY');
  if ((meta.parents || []).indexOf(folders.team) === -1) return fail_('BAD_STATE');
  if (size > K.max) {
    driveTrash_(driveId);
    withLock_(function () { var t = table_('file', true), i = findFile_(t, id); if (i >= 0) put_(t, i + 2, { '상태': '취소' }); });
    return fail_('TOO_LARGE', { max: K.max });
  }

  // 3) 색인을 고친다
  var out = withLock_(function () {
    var t = table_('file', true), i = findFile_(t, id);
    if (i < 0) return fail_('NOT_FOUND');
    var cur = str_(t.rows[i][t.col['상태']]);
    if (cur === '현재') return { ok: true, already: true, state: stateOut_(refreshStates_()[a.team], 'member') };
    if (cur !== '업로드 중' && !(a.proxy && cur === '끊김')) return fail_('BAD_STATE');

    var prev = -1, maxV = 0;
    t.rows.forEach(function (row, j) {
      if (teamNo_(row[t.col['팀']]) !== a.team || kindOf_(row[t.col['종류']]) !== kind) return;
      maxV = Math.max(maxV, Number(row[t.col['버전']]) || 0);
      if (j !== i && str_(row[t.col['상태']]) === '현재') prev = j;
    });
    var v = maxV + 1, now = nowMs_();
    var ext = ext_(str_(t.rows[i][t.col['이름']])) || ext_(meta.name) || 'bin';
    var finalName = 'team' + a.team + '_' + K.label + '_v' + v + '_' + stamp_(now) + '.' + ext;

    // Drive: 새 파일 이름 바꾸기 + 먼젓번 파일을 '옛날 자료' 로. 둘을 한꺼번에 보낸다.
    var reqs = [driveReq_('patch', '/drive/v3/files/' + encodeURIComponent(driveId) + '?supportsAllDrives=true&fields=id', { name: finalName })];
    var prevDrive = prev >= 0 ? str_(t.rows[prev][t.col['Drive ID']]) : '';
    if (prevDrive) {
      reqs.push(driveReq_('patch', '/drive/v3/files/' + encodeURIComponent(prevDrive) +
        '?supportsAllDrives=true&fields=id&addParents=' + encodeURIComponent(folders.old) +
        '&removeParents=' + encodeURIComponent(folders.team), {}));
    }
    var prevPdf = prev >= 0 && t.col['PDF ID'] !== undefined ? str_(t.rows[prev][t.col['PDF ID']]) : '';
    if (prevPdf) reqs.push(driveMove_(prevPdf, folders.team, folders.old));   // 보기용 PDF 도 함께 (실패해도 넘어간다)
    var rs = UrlFetchApp.fetchAll(reqs);
    if (rs[0].getResponseCode() !== 200) throw new Error('DRIVE_ERROR: rename ' + rs[0].getResponseCode());
    var prevGone = false;
    if (prevDrive) {
      var pc = rs[1].getResponseCode();
      if (pc === 404) prevGone = true;                       // 운영진이 Drive 에서 직접 지운 경우
      else if (pc !== 200) throw new Error('DRIVE_ERROR: move ' + pc);
    }

    put_(t, i + 2, {
      '버전': v, '상태': '현재', '경로': '/team' + a.team + '/', '이름': finalName, '크기': size,
      'md5': str_(meta.md5Checksum), '형식': str_(meta.mimeType), '올린 시각': kst_(now), '링크': fileUrl_(driveId)
    });
    if (prev >= 0) put_(t, prev + 2, { '상태': prevGone ? '없음' : '이전', '경로': '/team' + a.team + '/' + OLD_NAME + '/' });

    var patch = {};
    patch[K.label === '발표' ? '발표 자료' : '프로그램'] = finalName;
    teamPatch_(a, patch, [{ head: K.label === '발표' ? '발표 자료' : '프로그램', text: finalName, url: fileUrl_(driveId) }]);
    cacheDrop_('tk1:' + id);
    return { ok: true, done: { name: finalName, size: size } };
  });
  if (!out.ok || out.already) return out;
  // 잠금을 풀고 나서: 기록 한 줄, 팀 상태 새로 읽기 (마감 직전에 여러 팀이 몰려도 줄이 짧게)
  log_(a, 'upload.finish', '#' + id, out.done.name + ' · ' + out.done.size + 'B' + (phase_() === 'grace' && !a.proxy ? ' · 마감 직후 도착' : ''));
  var st = refreshStates_()[a.team];
  return { ok: true, state: stateOut_(st, 'member') };
}

/** 올리던 것을 그만둔다. */
function actUploadCancel_(body) {
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  if (!a.team) return fail_('NOT_MEMBER');
  var id = Number(body.id);
  if (!(id > 0)) return fail_('BAD_ID');
  var tk = ticket_(id);
  var out = withLock_(function () {
    var t = table_('file', true), i = findFile_(t, id);
    if (i < 0 || teamNo_(t.rows[i][t.col['팀']]) !== a.team) return fail_('NOT_FOUND');
    if (str_(t.rows[i][t.col['상태']]) !== '업로드 중') return { ok: true };
    put_(t, i + 2, { '상태': '취소' });
    return { ok: true, drive: str_(t.rows[i][t.col['Drive ID']]) };
  });
  if (out.ok && out.drive) {
    // 이어 올리기 주소를 닫고, 이미 다 올라온 파일이면 휴지통으로
    try { if (tk) UrlFetchApp.fetch(tk.s, { method: 'delete', muteHttpExceptions: true, followRedirects: false }); } catch (e) {}
    try { driveTrash_(out.drive); } catch (e2) {}
    cacheDrop_('tk1:' + id);
    delete out.drive;
  }
  return out;
}

/** 지금 올려 둔 파일을 내린다 (옛날 자료로 옮긴다). */
function actWithdraw_(body) {
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  if (!a.team) return fail_('NOT_MEMBER');
  var g = gate_(a, 'edit');
  if (g) return fail_(g);
  var kind = String(body.kind || ''), K = KINDS[kind];
  if (!K) return fail_('BAD_KIND');
  var folders = folders_(a.team);

  var out = withLock_(function () {
    return once_(a, body.nonce, function () {
      var t = table_('file', true), cur = -1;
      t.rows.forEach(function (row, j) {
        if (teamNo_(row[t.col['팀']]) === a.team && kindOf_(row[t.col['종류']]) === kind && str_(row[t.col['상태']]) === '현재') cur = j;
      });
      if (cur >= 0) {
        var driveId = str_(t.rows[cur][t.col['Drive ID']]);
        var reqs = [driveReq_('patch', '/drive/v3/files/' + encodeURIComponent(driveId) +
          '?supportsAllDrives=true&fields=id&addParents=' + encodeURIComponent(folders.old) +
          '&removeParents=' + encodeURIComponent(folders.team), {})];
        var pdfId = t.col['PDF ID'] !== undefined ? str_(t.rows[cur][t.col['PDF ID']]) : '';
        if (pdfId) reqs.push(driveMove_(pdfId, folders.team, folders.old));
        var res = UrlFetchApp.fetchAll(reqs)[0];
        var code = res.getResponseCode();
        if (code !== 200 && code !== 404) throw new Error('DRIVE_ERROR: move ' + code);
        put_(t, cur + 2, { '상태': code === 404 ? '없음' : '이전', '경로': '/team' + a.team + '/' + OLD_NAME + '/' });
        var patch = {};
        patch[K.label === '발표' ? '발표 자료' : '프로그램'] = '';
        teamPatch_(a, patch);
        return t.rows[cur][t.col['번호']];
      }
      return '';
    });
  });
  if (out && typeof out === 'object') return out;               // once_ 가 먼젓번 응답을 돌려준 경우
  if (out) log_(a, 'file.withdraw', '#' + out, K.label);
  var st = refreshStates_()[a.team];
  return { ok: true, state: stateOut_(st, 'member') };
}

/* ================================================================
   파일 내려받기 — 참가자는 자기 팀 것만, 열람 토큰은 전체
   ----------------------------------------------------------------
   Drive 권한이 없는 사람에게도 넘겨 줄 수 있도록 이 스크립트가 조각을 읽어 base64 로 돌려준다.
   ================================================================ */

function actFileGet_(body) {
  var team = '', who = '', noTest = false;
  if (body.key) {
    var v = viewer_(body.key);
    if (!v) return fail_('KEY_INVALID');
    who = 'v:' + v.hash.slice(0, 16);
    noTest = v.role !== '운영진';                      // 연습용 팀 파일은 운영진만 (현황판에서도 운영진에게만 보인다)
  } else {
    var a = actor_(body);
    if (a.error) return fail_(a.error);
    if (!a.team) return fail_('NOT_MEMBER');
    team = a.team; who = 't:' + a.team;
  }
  if (!hit_('dl:' + who, 3000, 600)) return fail_('TOO_MANY');

  var id = Number(body.id);
  var f = id > 0 ? fileById_(id, team, noTest) : null;
  if (!f) return fail_('NOT_FOUND');
  var src = { drive: f.drive, size: f.size, name: f.name, mime: f.mime, md5: f.md5 };
  if (body.variant === 'pdf') {                             // 보기용 PDF (PPT 등을 바꾼 것)
    if (!f.pdf || !f.pdf.drive) return fail_('NO_PDF');
    src = { drive: f.pdf.drive, size: f.pdf.size, name: pdfName_(f.name), mime: 'application/pdf', md5: '' };
  }
  var offset = Number(body.offset) || 0;
  var len = Math.min(Math.max(1, Number(body.length) || DL_CHUNK), DL_MAX);
  if (offset < 0 || offset >= src.size) return fail_('BAD_RANGE');
  var end = Math.min(src.size, offset + len) - 1;

  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(src.drive) +
    '?alt=media&supportsAllDrives=true&acknowledgeAbuse=true', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + offset + '-' + end },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 206 && code !== 200) return fail_(code === 404 ? 'FILE_GONE' : 'DRIVE_ERROR', { code: code });
  var bytes = res.getContent();
  if (code === 200 && bytes.length > end - offset + 1) bytes = bytes.slice(offset, end + 1);   // Range 를 무시하고 통째로 준 경우
  return {
    ok: true, id: id, name: src.name, size: src.size, mime: src.mime, md5: src.md5, variant: body.variant === 'pdf' ? 'pdf' : '',
    offset: offset, length: bytes.length, data: Utilities.base64Encode(bytes)
  };
}

/* ================================================================
   발표 자료 보기용 PDF — PPT 를 올리면 Drive 로 PDF 를 만들어 둔다 (심사위원 화면에서 바로 열리게)
   ----------------------------------------------------------------
   pptx · ppt · odp → Google 프레젠테이션으로 바꾼 사본 → PDF 로 내보내 원본 옆에 '…_보기용.pdf' 로 둔다.
   사본은 휴지통으로. `파일` 탭 그 줄의 'PDF ID' · 'PDF 크기' 에 적는다. 원본은 그대로 — 받기는 원본, 보기는 PDF.
   몇 초 – 1분 걸리므로 잠금 밖에서 하고, 같은 파일을 두 실행이 함께 바꾸지 않게 캐시에 표시한다.
   부르는 곳: 참가자 화면(올린 직후 · 제출 화면을 열 때), 심사위원 화면(아직 없을 때), 시트 메뉴(빠진 것 한꺼번에).
   Google 에 없는 글꼴은 비슷한 글꼴로 바뀔 수 있다 (보기용).
   ================================================================ */

// Google 프레젠테이션으로 가져올 수 있는 발표 형식 전부 (Drive 의 가져오기 지원 목록). Keynote 는 없다
var PDF_FROM = ['pptx', 'ppt', 'pptm', 'ppsx', 'pps', 'potx', 'pot', 'odp'];
function convertible_(name) { return PDF_FROM.indexOf(ext_(name)) !== -1; }
function pdfName_(name) { return String(name || 'deck').replace(/\.[A-Za-z0-9]{1,10}$/, '') + '_보기용.pdf'; }
/** Drive 파일을 한 폴더에서 다른 폴더로 (fetchAll 에 넣는 요청) */
function driveMove_(id, from, to) {
  return driveReq_('patch', '/drive/v3/files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=id&addParents=' +
    encodeURIComponent(to) + '&removeParents=' + encodeURIComponent(from), {});
}

/** { id } — 그 팀 사람(로그인) 이나 열람 토큰. 이미 있으면 바로 돌려준다 */
function actDeckPdf_(body) {
  var team = '', who = '';
  if (body.key) {
    var v = viewer_(body.key);
    if (!v) return fail_('KEY_INVALID');
    who = 'v:' + v.hash.slice(0, 12);
  } else {
    var a = actor_(body);
    if (a.error) return fail_(a.error);
    if (!a.team) return fail_('NOT_MEMBER');
    team = a.team; who = 't:' + a.team;
  }
  var id = Number(body.id), f = id > 0 ? fileById_(id, team, false) : null;
  if (!f) return fail_('NOT_FOUND');
  if (f.kind !== 'deck' || !convertible_(f.name)) return fail_('NOT_CONVERTIBLE');
  if (f.pdf && f.pdf.drive) return { ok: true, id: id, pdf: f.pdf.size || 1 };
  if (!hit_('pdf:' + who, 30, 600)) return fail_('TOO_MANY');
  return deckPdf_(id);
}

/** 한 파일의 보기용 PDF 를 만든다. { ok, id, pdf:크기 } · fail_('PDF_BUSY' | 'PDF_FAILED' …) */
function deckPdf_(id) {
  var c = cache_(), busy = 'pdfing:' + id;
  if (c && c.get(busy)) return fail_('PDF_BUSY');           // 다른 실행이 바꾸는 중
  if (c) c.put(busy, '1', 330);
  var gid = '';
  try {
    var t = table_('file', true), i = findFile_(t, id);
    if (i < 0) return fail_('NOT_FOUND');
    var col = t.col, row = t.rows[i];
    if (col['PDF ID'] !== undefined && str_(row[col['PDF ID']])) return { ok: true, id: id, pdf: Number(row[col['PDF 크기']]) || 1 };
    var src = str_(row[col['Drive ID']]), name = str_(row[col['이름']]);
    if (!src || !convertible_(name)) return fail_('NOT_CONVERTIBLE');
    var meta = driveMeta_(src);
    if (!meta || meta.trashed) return fail_('FILE_GONE');
    var parent = (meta.parents || [])[0];
    // 1) Google 프레젠테이션으로 바꾼 사본
    var cp = driveFetch_('post', '/drive/v3/files/' + encodeURIComponent(src) + '/copy?supportsAllDrives=true&fields=id',
      { name: pdfName_(name).replace(/\.pdf$/, '') + ' (변환 중)', mimeType: 'application/vnd.google-apps.presentation', parents: [parent] });
    if (cp.getResponseCode() !== 200) throw driveFail_(cp, 'convert');
    gid = JSON.parse(cp.getContentText()).id;
    // 2) PDF 로 내보내기. Drive API 는 10MB 넘는 내보내기를 막으므로, 그때는 Apps Script 의 변환으로
    var ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(gid) + '/export?mimeType=application%2Fpdf',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    var blob = ex.getResponseCode() === 200 ? ex.getBlob() : DriveApp.getFileById(gid).getAs('application/pdf');
    blob.setName(pdfName_(name));
    var pdf = DriveApp.getFolderById(parent).createFile(blob), pdfId = pdf.getId(), pdfSize = Number(pdf.getSize()) || 0;
    // 3) 색인에 적는다
    withLock_(function () {
      var t2 = table_('file', true), j = findFile_(t2, id);
      if (j >= 0) put_(t2, j + 2, { 'PDF ID': pdfId, 'PDF 크기': pdfSize });
    });
    refreshStates_();
    return { ok: true, id: id, pdf: pdfSize || 1 };
  } catch (e) {
    var msg = String((e && e.message) || e);
    try { console.error('PDF ' + id + ': ' + msg.replace(/https?:\/\/[^\s'"]+/g, '(주소)')); } catch (e2) {}
    return fail_('PDF_FAILED', { message: msg.split(':')[0] });
  } finally {
    if (gid) driveTrash_(gid);
    if (c) c.remove(busy);
  }
}

/* ================================================================
   심사위원 · 운영진: 전체 현황
   ================================================================ */

function actViewList_(body) {
  var v = viewer_(body.key);
  if (!v) return fail_('KEY_INVALID');
  var aud = v.role === '운영진' ? 'staff' : 'judge';
  var all = states_();
  var tracks = CONFIG.TRACKS.map(function (tr) { return { name: tr.name, teams: [] }; });
  var extra = { name: '기타', teams: [] }, practice = { name: '연습', teams: [] };
  var sum = { teams: 0, complete: 0, deck: 0, product: 0, title: 0 };
  var rank = presentRanks_(all);

  teamList_(aud === 'staff').forEach(function (tm) {
    var s = all[tm.no];
    if (!s) return;
    if (tm.no === TEST_TEAM) {
      // 연습용 팀은 운영진에게만, 무언가 들어 있을 때만 보인다
      if (!(s.title || s.url || s.deck || s.program || s.history.length)) return;
    } else {
      sum.teams++;
      if (s.title) sum.title++;
      if (s.deck) sum.deck++;
      if (s.url || s.program) sum.product++;
      if (complete_(s)) sum.complete++;
    }
    var out = stateOut_(s, aud), put = tm.no === TEST_TEAM ? practice : extra;
    out.rank = rank[tm.no] || 0;
    tracks.forEach(function (tr) { if (tr.name === out.track) put = tr; });
    put.teams.push(out);
  });
  if (extra.teams.length) tracks.push(extra);
  if (practice.teams.length) tracks.push(practice);
  tracks.forEach(function (tr) {                                   // 발표 순서대로 (presentRanks_)
    tr.teams.sort(function (x, y) { return ((x.rank || 999) - (y.rank || 999)) || (x.no < y.no ? -1 : 1); });
  });
  seen_(v);
  var res = {
    ok: true, api: API_VERSION, now: nowMs_(), deadline: deadlineMs_(), graceMin: graceMin_(), phase: phase_(),
    role: v.role, name: v.name, summary: sum, tracks: tracks, orderFinal: phase_() === 'closed'
  };
  if (aud === 'staff') res.votes = voteTally_();          // 인기투표 결과는 운영진에게만
  res.criteria = criteria_();
  res.scoring = scoreState_();
  res.scoreUntil = scoreUntil_();
  if (v.role === '심사위원') {
    try { res.mine = scoreMine_(v); } catch (e) { res.mine = {}; res.scoreError = String(e.message || e).split(':')[0]; }
  }
  return res;
}

/* ================================================================
   심사위원 평가 — 현황판(/judge/)의 심사위원 화면 · 종합(/judge/score/)
   ----------------------------------------------------------------
   심사위원은 열람 토큰(역할 '심사위원')으로 들어와 팀마다 4문항 점수(0 – 25, 소수점 둘째 자리까지)와 코멘트를 적는다.
   한 사람이 한 팀에 한 줄 — 다시 저장하면 그 줄을 고친다. 비워 둔 문항은 나중에 채울 수 있고, 4문항이 다 차야 합계로 센다.
   심사위원은 자기 점수만 본다. 운영진(역할 '운영진' 토큰)은 종합에서 전체를 본다:
     J = 4문항을 다 채운 심사위원들의 합계 평균, P = 인기투표 참가자 점수, S = 0.85 × J + P, 동점이면 J → 구조적 이해 평균
   SCORE_UNTIL(투표 취합 시작) 이 지나거나 운영진이 마감하면 더 고칠 수 없다.
   ================================================================ */

function criteria_() {
  return CONFIG.CRITERIA.map(function (c) { return { key: c.key, name: c.name, max: Number(c.max) || 25 }; });
}
/** 'open' · 'closed'. 예전 마감 버튼이 남긴 SCORE_CLOSED 도 마감으로 본다 */
function scoreState_(at) {
  if (/^(1|true|yes|closed|o)$/i.test(String(props_().SCORE_CLOSED || ''))) return 'closed';
  var u = cutMs_('SCORE_UNTIL');
  return u && (at || nowMs_()) >= u ? 'closed' : 'open';
}
/** 화면에 보여 줄 심사 마감 시각 (ms, 없으면 0) */
function scoreUntil_() { return cutMs_('SCORE_UNTIL'); }
function judgeId_(v) { return v.hash.slice(0, 12); }
function round2_(n) { return Math.round(n * 100) / 100; }

/** 심사 시트. 스크립트 속성 SCORE_SHEET_ID → 없으면 제출 폴더 옆 '심사위원' 폴더에서 찾는다 */
function scoreSs_() {
  if (MEMO.scoreSs) return MEMO.scoreSs;
  var id = props_().SCORE_SHEET_ID || scoreSheetFind_(false);
  if (!id) throw new Error('SCORE_SHEET_MISSING: 처음 설정을 다시 실행해 주세요 (심사위원 폴더 · 시트를 찾거나 만듭니다).');
  return (MEMO.scoreSs = SpreadsheetApp.openById(id));
}
/** 제출 폴더와 나란한 SCORE_FOLDER_NAME 폴더 안의 SCORE_SHEET_NAME 시트. create 면 없을 때 만든다. 찾으면 속성에 기억한다 */
function scoreSheetFind_(create) {
  var root = rootFolder_(), up = root.getParents(), home = up.hasNext() ? up.next() : root;
  var folder = null, it = home.getFoldersByName(conf_('SCORE_FOLDER_NAME'));
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) { folder = f; break; } }
  if (!folder) {
    if (!create) return '';
    folder = home.createFolder(conf_('SCORE_FOLDER_NAME'));
  }
  var id = '', files = folder.getFilesByName(conf_('SCORE_SHEET_NAME'));
  while (files.hasNext()) {
    var x = files.next();
    if ((!x.isTrashed || !x.isTrashed()) && x.getMimeType() === 'application/vnd.google-apps.spreadsheet') { id = x.getId(); break; }
  }
  if (!id) {
    if (!create) return '';
    id = SpreadsheetApp.create(conf_('SCORE_SHEET_NAME')).getId();
    DriveApp.getFileById(id).moveTo(folder);
  }
  PropertiesService.getScriptProperties().setProperty('SCORE_SHEET_ID', id);
  propsDrop_();
  return id;
}

/** `점수` 탭 → { judges: {ID: {id, name, teams: {팀: {s:{문항:점수|''}, total, complete, comment, at}}}} } (1분 캐시, 쓸 때 새로) */
function scores_() {
  if (MEMO.scores) return MEMO.scores;
  var hit = cacheGet_('scores1');
  if (hit) return (MEMO.scores = hit);
  return scoreBuild_(table_('score'));
}
function scoreBuild_(t) {
  var c = t.col, crit = criteria_(), out = { judges: {} };
  t.rows.forEach(function (row) {
    var id = str_(row[c['심사위원 ID']]), no = teamNo_(row[c['팀']]);
    if (!id || !no) return;
    var s = {}, total = 0, filled = 0;
    crit.forEach(function (k) {
      var x = row[c[k.name]], n = (x === '' || x === null || x === undefined) ? NaN : Number(x);
      if (isFinite(n) && n >= 0 && n <= k.max) { s[k.key] = round2_(n); total += n; filled++; } else s[k.key] = '';
    });
    var j = out.judges[id] = out.judges[id] || { id: id, name: str_(row[c['심사위원']]), teams: {} };
    j.teams[no] = { s: s, total: round2_(total), complete: filled === crit.length, filled: filled,
                    comment: str_(row[c['코멘트']]), at: time_(row[c['저장 시각']]) };
  });
  cachePut_('scores1', out, 60);
  return (MEMO.scores = out);
}
function scoreMine_(v) { var j = scores_().judges[judgeId_(v)]; return j ? j.teams : {}; }

/** 심사위원: 한 팀의 점수와 코멘트를 저장 { key, team, scores:{idea:21.5, …}, comment } */
function actScoreSave_(body) {
  var t0 = nowMs_();                                      // 마감 시각은 요청이 들어온 때로 견준다 (잠금을 기다린 시간은 빼고)
  var v = viewer_(body.key);
  if (!v) return fail_('KEY_INVALID');
  if (v.role !== '심사위원') return fail_('NOT_JUDGE');
  if (scoreState_(t0) === 'closed') return fail_('SCORE_CLOSED');
  var team = teamNo_(body.team);
  if (!team || team === TEST_TEAM || teamNos_().indexOf(team) === -1) return fail_('BAD_TEAM');
  var crit = criteria_(), sc = (body.scores && typeof body.scores === 'object') ? body.scores : {}, out = {}, total = 0, filled = 0;
  for (var i = 0; i < crit.length; i++) {
    var k = crit[i], raw = sc[k.key];
    if (raw === '' || raw === null || raw === undefined) { out[k.key] = ''; continue; }     // 비워 두고 나중에 채워도 된다
    var n = Number(raw);
    if (typeof raw === 'boolean' || !isFinite(n) || n < 0 || n > k.max) return fail_('BAD_SCORE', { item: k.key, max: k.max });
    n = round2_(n);
    out[k.key] = n; total += n; filled++;
  }
  var comment = clean_(body.comment, 2000, true);
  if (!hit_('score:' + judgeId_(v), 400, 600)) return fail_('TOO_MANY');

  return withLock_(function () {
    propsDrop_();                                         // 운영진이 방금 마감했을 수 있다 — 캐시가 아니라 지금 값으로
    if (scoreState_(t0) === 'closed') return fail_('SCORE_CLOSED');
    var t = table_('score', true), c = t.col, id = judgeId_(v), at = -1;
    t.rows.forEach(function (row, j) { if (str_(row[c['심사위원 ID']]) === id && teamNo_(row[c['팀']]) === team) at = j; });
    var rec = { '심사위원': v.name, '심사위원 ID': id, '팀': team, '트랙': trackOf_(team), '합계': filled ? round2_(total) : '',
                '코멘트': comment, '저장 시각': kst_(nowMs_()) };
    crit.forEach(function (k) { rec[k.name] = out[k.key]; });
    put_(t, at < 0 ? 0 : at + 2, rec);
    var mine = scoreBuild_(t).judges[id].teams[team];
    return { ok: true, team: team, saved: mine };
  });
}

/** 운영진 · 심사위원: 종합 — 트랙별 순위표와 코멘트 (심사위원은 읽기만) */
function actScoreSummary_(body) {
  var v = viewer_(body.key);
  if (!v) return fail_('KEY_INVALID');
  // 심사위원도 본다 (읽기만). 마감 · 결과 발표 · 시상 화면(score.state · results.state · results.award)은 운영진만
  if (v.role !== '운영진' && v.role !== '심사위원') return fail_('NOT_STAFF');
  seen_(v);
  var res = scoreTable_();
  return { ok: true, api: API_VERSION, now: nowMs_(), name: v.name, role: v.role, criteria: criteria_(), weight: judgeW_(), popMax: popMax_(),
           scoring: scoreState_(), scoreUntil: scoreUntil_(), scoreCustom: !!str_(props_().SCORE_UNTIL), judges: res.judges, tracks: res.tracks,
           results: resultsInfo_() };
}

/**
 * 운영진: { key, op } — 'close' 지금 마감 · 'open' 다시 열기(REOPEN_MIN 분 뒤 저절로 닫힘) · 'auto' 시간표대로(SCORE_UNTIL 속성을 지움)
 * 마감 시각은 스크립트 속성 SCORE_UNTIL 에 적는다.
 */
function actScoreState_(body) {
  var v = viewer_(body.key);
  if (!v) return fail_('KEY_INVALID');
  if (v.role !== '운영진') return fail_('NOT_STAFF');
  var op = String(body.op || '');
  if (op !== 'close' && op !== 'open' && op !== 'auto') return fail_('BAD_OP');
  var now = nowMs_(), votes = [];
  withLock_(function () {
    var P = PropertiesService.getScriptProperties(), u = cutMs_('SCORE_UNTIL');
    P.deleteProperty('SCORE_CLOSED');                     // 예전 마감 버튼이 남긴 값
    // 마감 = 결과 발표: 심사를 닫고, 아직 닫히지 않은 투표도 지금 닫고, 메인에 결과를 띄운다
    if (op === 'close') { P.setProperty('SCORE_UNTIL', iso_(now)); P.setProperty('RESULTS_AT', iso_(now)); votes = voteCloseAll_(P, now); }
    else if (op === 'open') P.setProperty('SCORE_UNTIL', iso_(Math.max(now + reopenMin_() * 60000, u > now ? u : 0)));
    else P.deleteProperty('SCORE_UNTIL');
  });
  propsDrop_();
  cacheDrop_('votes1');
  log_({ email: '열람:' + v.name, team: '' }, 'score.' + op, '', votes.length ? '투표도 마감: ' + votes.join(', ') : '');
  return { ok: true, scoring: scoreState_(), scoreUntil: scoreUntil_(), scoreCustom: !!str_(props_().SCORE_UNTIL), votesClosed: votes };
}

/* ================================================================
   결과 발표 — 메인 페이지 (로그인 없이)
   ----------------------------------------------------------------
   운영진이 종합 화면에서 '심사 마감'(이미 마감됐으면 '결과 발표')을 누르면 공개된다 — 두 트랙 투표가 아직이면 투표가 마감되는 대로.
   (그 단추가 RESULTS_AT 에 지금 시각을 적는다. 기본 'off' 라 14:25 자동 마감만으로는 뜨지 않는다.)
   등수는 최종 S 순서대로 PRIZES(등수마다 팀 수)에 맞춰 나눈다 — 해커톤 1등 1 · 2등 2 · 3등 3, 구현과제 1 – 4등 각 1.
   동점(S · 심사위원 점수 · 동점 문항까지 같음)이면 같은 등수를 준다. 점수는 내보내지 않는다 (등수 · 팀 번호 · 프로젝트 이름만).
   운영진: '결과 발표' (RESULTS_AT = 지금) · '결과 내리기' (RESULTS_AT = off). 시상 화면(/judge/award/)은 results.award (최종 S 포함).
   ================================================================ */

/** RESULTS_AT: 0 = 시각 조건 없음, Infinity = 내림(off) */
function resultsAt_() {
  var s = str_(conf_('RESULTS_AT'));
  if (/^off$/i.test(s)) return Infinity;
  return cutMs_('RESULTS_AT');
}
/** 'judging' 심사 · 투표 진행 중 · 'ready' 다 마감됐지만 발표 시각 전(또는 내림) · 'open' 공개 */
function resultsState_(at) {
  var now = at || nowMs_();
  if (scoreState_(now) !== 'closed') return 'judging';
  for (var i = 0, tr = voteTracks_(); i < tr.length; i++) if (voteState_(tr[i].key, now) !== 'closed') return 'judging';
  return now >= resultsAt_() ? 'open' : 'ready';
}
function resultsInfo_() {
  var at = resultsAt_(), p = str_(props_().RESULTS_AT);
  return { state: resultsState_(), at: at === Infinity ? -1 : at, custom: !!p };
}
/** 트랙마다 [{ place, teams: [{ no, title (, s) }] }] — scoreTable_ 의 S 순서대로 PRIZES 에 맞춰. withS 면 최종 S 도 (운영진 시상 화면) */
function resultsBuild_(withS) {
  var prizes = CONFIG.PRIZES || {};
  return scoreTable_().tracks.map(function (tr) {
    var counts = prizes[tr.key] || [], places = counts.map(function (n, i) { return { place: i + 1, teams: [] }; });
    var total = counts.reduce(function (a, n) { return a + n; }, 0), pos = 0, last = null;
    tr.rows.forEach(function (r) {
      if (r.rank === null || r.rank === undefined) return;              // 4문항을 다 채운 점수가 없는 팀
      var place;
      if (last && r.rank === last.rank) place = last.place;              // 동점은 같은 등수
      else {
        if (pos >= total) return;
        var c = 0;
        for (var i = 0; i < counts.length; i++) { c += counts[i]; if (pos < c) { place = i + 1; break; } }
      }
      var t = { no: r.no, title: r.title || '' };
      if (withS) t.s = r.S;
      places[place - 1].teams.push(t);
      pos++; last = { rank: r.rank, place: place };
    });
    return { key: tr.key, name: tr.name, places: places };
  });
}
/** 누구나: 결과 (공개 전에는 상태와 발표 시각만) */
function actResultsPublic_(body) {
  var now = nowMs_(), state = resultsState_(now), at = resultsAt_();
  var out = { ok: true, api: API_VERSION, now: now, state: state, at: at === Infinity ? -1 : at };
  if (state !== 'open') return out;
  var key = 'pub:r:' + Math.floor(now / 60000), hit = cacheGet_(key);   // 메인 페이지는 사람이 많다 — 1분 동안 같은 답
  if (!hit) { hit = { tracks: resultsBuild_() }; cachePut_(key, hit, 90); }
  out.tracks = hit.tracks;
  return out;
}
/** 운영진: 시상 화면 (/judge/award/) — 등수마다 팀 · 프로젝트 이름 · 최종 S. 공개 전에도 볼 수 있다 (리허설) */
function actResultsAward_(body) {
  var v = viewer_(body.key);
  if (!v) return fail_('KEY_INVALID');
  if (v.role !== '운영진') return fail_('NOT_STAFF');
  seen_(v);
  return { ok: true, api: API_VERSION, now: nowMs_(), scoring: scoreState_(), results: resultsInfo_(), tracks: resultsBuild_(true) };
}
/** 운영진: { key, op } — 'now' 지금 공개 · 'hide' 내리기 · 'auto' 시간표대로 (RESULTS_AT 속성) */
function actResultsState_(body) {
  var v = viewer_(body.key);
  if (!v) return fail_('KEY_INVALID');
  if (v.role !== '운영진') return fail_('NOT_STAFF');
  var op = String(body.op || '');
  if (op !== 'now' && op !== 'hide' && op !== 'auto') return fail_('BAD_OP');
  // 심사가 마감돼 있어야 한다. 투표가 아직이면 투표가 마감되는 대로 뜬다 ('심사 마감' 단추와 같게)
  if (op === 'now' && scoreState_() !== 'closed') return fail_('RESULTS_NOT_READY', { results: resultsInfo_() });
  var now = nowMs_(), votes = [];
  withLock_(function () {
    var P = PropertiesService.getScriptProperties();
    if (op === 'now') { P.setProperty('RESULTS_AT', iso_(now)); votes = voteCloseAll_(P, now); }   // 결과 발표 = 남은 투표도 지금 마감
    else if (op === 'hide') P.setProperty('RESULTS_AT', 'off');
    else P.deleteProperty('RESULTS_AT');
  });
  propsDrop_();
  cacheDrop_('votes1');
  log_({ email: '열람:' + v.name, team: '' }, 'results.' + op, '', votes.length ? '투표도 마감: ' + votes.join(', ') : '');
  return { ok: true, results: resultsInfo_(), votesClosed: votes };
}

/** 트랙별 순위표. 심사위원 목록은 `열람` 탭의 심사위원 + 점수를 낸 사람 */
function scoreTable_() {
  var sc = scores_(), all = states_(), crit = criteria_(), w = judgeW_(), tie = conf_('TIE_KEY');
  var vt = {};
  try { voteTally_().forEach(function (x) { vt[x.key] = x; }); } catch (e) {}
  var names = {}, vs = viewers_();
  Object.keys(vs).forEach(function (h) { if (vs[h].role === '심사위원') names[h.slice(0, 12)] = vs[h].name; });
  Object.keys(sc.judges).forEach(function (id) { if (!names[id]) names[id] = sc.judges[id].name; });
  var judges = Object.keys(names).map(function (id) { return { id: id, name: names[id] }; })
    .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });

  var tracks = voteTracks_().map(function (tr) {
    var vmap = {};
    ((vt[tr.key] || {}).rows || []).forEach(function (r) { vmap[r.no] = r; });
    var rows = voteTeams_(tr.key).map(function (no) {
      var per = {}, sum = 0, n = 0, cs = {}, comments = [];
      judges.forEach(function (j) {
        var r = sc.judges[j.id] && sc.judges[j.id].teams[no];
        if (!r) return;
        per[j.id] = { total: r.total, complete: r.complete, s: r.s };
        if (r.complete) {
          sum += r.total; n++;
          crit.forEach(function (k) { cs[k.key] = (cs[k.key] || 0) + Number(r.s[k.key]); });
        }
        if (r.comment) comments.push({ judge: j.name, text: r.comment });
      });
      var J = n ? sum / n : null, P = vmap[no] ? vmap[no].p : 0, avg = {};
      crit.forEach(function (k) { avg[k.key] = n ? round2_(cs[k.key] / n) : null; });
      return {
        no: no, title: (all[no] || {}).title || '', judges: per, scored: n,
        J: J === null ? null : round2_(J), P: P, votes: vmap[no] ? vmap[no].votes : 0,
        S: J === null ? null : round2_(w * J + P), avg: avg, comments: comments,
        _s: J === null ? -1 : w * J + P, _j: J === null ? -1 : J, _t: n ? cs[tie] / n : -1
      };
    });
    rows.sort(function (a, b) { return (b._s - a._s) || (b._j - a._j) || (b._t - a._t) || (a.no < b.no ? -1 : 1); });
    var rank = 0;
    rows.forEach(function (r, i) {
      var prev = rows[i - 1];
      if (!prev || r._s !== prev._s || r._j !== prev._j || r._t !== prev._t) rank = i + 1;
      r.rank = r.J === null ? null : rank;
    });
    rows.forEach(function (r) { delete r._s; delete r._j; delete r._t; });
    return { key: tr.key, name: tr.name, vote: (vt[tr.key] || {}).state || 'ready', rows: rows };
  });
  return { judges: judges, tracks: tracks };
}

/* ================================================================
   참가자 인기투표 — /judge/vote/
   ----------------------------------------------------------------
   트랙마다 시간표의 투표 시간(VOTE_H_FROM – VOTE_H_UNTIL …)에 저절로 열리고 닫힌다. 발표가 밀리거나 일찍 끝나면 운영진이
   투표 페이지에서 지금 열기 · 마감 · 5분 연장 · 5분 늦추기로 시각을 옮긴다(같은 이름의 스크립트 속성). 명단(`팀원` 탭)에 있는 참가자만 낸다 —
   신청서와 맞지 않는 계정은 로그인부터 거절한다(NOT_MEMBER).
   1인 VOTE_MAX 표 · 한 팀에 1표 · 자기 팀은 안 된다. 열려 있는 동안은 다시 골라 낼 수 있고 마지막에 낸 투표지만 센다.
   표는 사람 단위다 — 같은 사람이 계정을 둘 갖고 있어도(명단에 두 줄) 투표지 한 장을 함께 쓴다.

   `투표` 탭 한 줄 = 표 한 장. 누가 냈는지는 남기지 않는다(익명 표시만). 대신 줄마다 '검증' 값을 둔다:
     SHA-256( 비밀 솔트 | 투표지 | 트랙 | 투표자 | 투표자 팀 | 대상 팀 | 시각 )
   솔트는 스크립트 속성(VOTE_SALT)에만 있어서, 시트를 고칠 수 있는 사람도 대상 팀을 바꾸고 맞는 검증값을 만들 수 없다.
   셀 때는 검증값이 맞는 줄만, 그중에서도 투표자마다 가장 나중에 낸 투표지만 센다. 규칙(표 수 · 중복 · 자기 팀 · 트랙)을
   어긴 투표지와 검증이 안 맞는 줄은 세지 않고 운영진 결과에 '검증 실패'로 알린다.
   참가자는 자기 표마다 확인 코드(검증값 앞 6자리)를 받는다. 운영진은 `투표` 탭의 같은 값으로 그 표가 들어갔는지 확인할 수 있다.

   참가자 점수(조직 소개의 심사 기준): P = 15 × √min(1, v / 2v̄), v̄ = 그 트랙의 전체 표 / 그 트랙의 팀 수
   (15 = 100 × (1 − JUDGE_WEIGHT), 2 = POP_FULL_X)
   ================================================================ */

function voteTracks_() { return CONFIG.TRACKS.filter(function (tr) { return tr.key; }); }
function voteTrack_(key) {
  var hit = null;
  voteTracks_().forEach(function (tr) { if (tr.key === String(key || '')) hit = tr; });
  return hit;
}
function trackKeyOf_(no) {
  var n = Number(no), k = '';
  if (no === TEST_TEAM) return '';
  var mv = trackMoves_()[teamNo_(no)];
  if (mv) return mv;                                                  // TRACK_MOVES 로 옮긴 팀
  voteTracks_().forEach(function (tr) { if (n >= tr.from && n <= tr.to) k = tr.key; });
  return k;
}
/** TRACK_MOVES: { '09': 'H' } — 번호 범위와 다른 트랙으로 옮긴 팀 (한 실행 안에서 한 번만 읽는다) */
function trackMoves_() {
  if (MEMO.moves) return MEMO.moves;
  var out = {};
  String(conf_('TRACK_MOVES') || '').split(/[,;\n]/).forEach(function (part) {
    var m = /^\s*(\d{1,2})\s*(?::|=|->|→)\s*(\S+)\s*$/.exec(part);
    if (!m) return;
    var no = teamNo_(m[1]), key = trackKeyByName_(m[2]);
    if (no && key) out[no] = key;
  });
  return (MEMO.moves = out);
}
function trackKeyByName_(name) {
  var k = '';
  voteTracks_().forEach(function (tr) { if (tr.name === str_(name) || tr.key === str_(name)) k = tr.key; });
  return k;
}
/** 트랙의 투표 시간 { from, until } (ms, 없으면 0). 스크립트 속성이 있으면 그것, 없으면 CONFIG */
function voteWin_(key) { return { from: cutMs_('VOTE_' + key + '_FROM'), until: cutMs_('VOTE_' + key + '_UNTIL') }; }
/** 운영진 버튼으로 시각을 옮겨 두었는가 (속성이 있는가) */
function voteCustom_(key) { var p = props_(); return !!(str_(p['VOTE_' + key + '_FROM']) || str_(p['VOTE_' + key + '_UNTIL'])); }
/** 'ready' 열기 전 · 'open' 받는 중 · 'closed' 마감. at 을 주면 그 시각으로 (요청이 들어온 시각) */
function voteState_(key, at) {
  var w = voteWin_(key), now = at || nowMs_();
  if (w.from && now >= w.from && (!w.until || now < w.until)) return 'open';
  return w.from && w.until && now >= w.until ? 'closed' : 'ready';
}
/**
 * 아직 닫히지 않은 투표를 지금 닫는다 ('심사 마감 · 결과 발표' · '결과 발표'). 열리기 전이면 열지 않고 그대로 끝낸다.
 * 잠금 안에서 부른다. 닫은 트랙 이름 목록을 돌려준다.
 */
function voteCloseAll_(P, now) {
  var done = [];
  voteTracks_().forEach(function (tr) {
    if (voteState_(tr.key, now) === 'closed') return;
    var w = voteWin_(tr.key);
    if (!w.from || w.from > now) P.setProperty('VOTE_' + tr.key + '_FROM', iso_(now));
    P.setProperty('VOTE_' + tr.key + '_UNTIL', iso_(now));
    done.push(tr.name);
  });
  return done;
}
function voteMax_() { var n = Number(conf_('VOTE_MAX')); return n >= 1 && n <= 10 ? Math.floor(n) : 3; }
function voteSelf_() { return /^(1|true|yes|o|on)$/i.test(String(conf_('VOTE_SELF'))); }
function voteTeams_(key) { return teamNos_().filter(function (no) { return trackKeyOf_(no) === key; }); }

/**
 * 발표 순서 { 팀 번호: 트랙 안에서 몇 번째 } — 트랙마다 '마지막 제출' 이 늦은 팀부터 (11-14 공지:
 * 8시에 낸 01팀 · 10시에 낸 02팀이면 02팀이 먼저). 아무것도 내지 않은 팀은 맨 뒤 (팀 번호 순).
 * `팀` 탭 '순서' 칸에 숫자를 적은 팀은 그 숫자대로 맨 앞에 선다 (운영진이 손으로 바꿀 때).
 * 마감(+유예) 뒤에 운영진이 대신 올린 것은 '마지막 제출' 을 바꾸지 않으므로(teamPatch_) 순서가 흔들리지 않는다.
 */
function presentRanks_(all) {
  var out = {}, moves = trackMoves_();
  voteTracks_().forEach(function (tr) {
    voteTeams_(tr.key).map(function (no) { return all[no] || blank_(no); }).sort(function (x, y) {
      var ox = x.order || 0, oy = y.order || 0;
      if (ox || oy) { if (!ox) return 1; if (!oy) return -1; if (ox !== oy) return ox - oy; }
      var ax = x.at || 0, ay = y.at || 0;
      if (!ax !== !ay) return ax ? -1 : 1;                       // 낸 팀이 먼저
      var mx = !!moves[x.no], my = !!moves[y.no];
      if (mx !== my) return mx ? 1 : -1;                         // 다른 트랙에서 옮겨 온 팀은 그 트랙 맨 뒤 (안 낸 팀 앞)
      if (ax !== ay) return ay - ax;                             // 늦게 낸 팀이 먼저
      return x.no < y.no ? -1 : x.no > y.no ? 1 : 0;
    }).forEach(function (s, i) { out[s.no] = i + 1; });
  });
  return out;
}

/** 비밀 솔트. 처음 한 번 만들고 스크립트 속성에 둔다 (처음 설정에서 미리 만든다). 잠금 안에서 부르지 않는다. */
function voteSalt_() {
  var s = props_().VOTE_SALT;
  if (s) return s;
  return withLock_(function () {
    propsDrop_();
    var cur = props_().VOTE_SALT;
    if (cur) return cur;
    var v = secret_();
    PropertiesService.getScriptProperties().setProperty('VOTE_SALT', v);
    propsDrop_();
    return v;
  });
}
/** 투표자 = 사람: 팀 + 이름(띄어쓰기 · 대소문자 무시). 이름이 빈 줄이면 계정으로. 솔트를 섞어 남이 거꾸로 알아내지 못하게. */
function voterKey_(a, salt) {
  var who = nameKey_(a.name) || ('acct:' + (a.sub || a.email));
  return sha256hex_(salt + '|voter|' + a.team + '|' + who).slice(0, 16);
}
function voteSig_(salt, ballot, key, voter, voterTeam, team, at) {
  return sha256hex_([salt, 'v1', ballot, key, voter, voterTeam, team, at].join('|')).slice(0, 32);
}

/**
 * `투표` 탭을 검증하며 센다. 결과는 1분 캐시에 두고, 쓸 때마다 새로 만든다.
 *   { by: {투표자: {트랙: {teams:[…], codes:{팀: 코드}}}}, n: {팀: 표}, voters: {트랙: 사람 수}, bad: {트랙: 세지 않은 줄 수} }
 */
function votes_() {
  if (MEMO.votes) return MEMO.votes;
  var hit = cacheGet_('votes1');
  if (hit) return (MEMO.votes = hit);
  return voteCount_(table_('vote'), voteSalt_());
}
function voteCount_(t, salt) {
  var c = t.col, ballots = {}, bad = {};
  t.rows.forEach(function (row, pos) {
    var key = trackKeyByName_(row[c['트랙']]), ballot = str_(row[c['투표지']]), voter = str_(row[c['투표자(익명)']]);
    var vt = teamNo_(row[c['투표자 팀']]), team = teamNo_(row[c['대상 팀']]);
    var at = row[c['시각']] instanceof Date ? kst_(row[c['시각']].getTime()) : str_(row[c['시각']]);   // 날짜로 바뀌어 있어도 같은 글자로
    if (!key && !ballot && !voter && !team) return;                       // 빈 줄
    var sig = str_(row[c['검증']]).toLowerCase();
    if (!key || !ballot || !voter || !team || sig !== voteSig_(salt, ballot, key, voter, vt, team, at)) {
      if (key) bad[key] = (bad[key] || 0) + 1;
      return;
    }
    var id = voter + '|' + key;
    var b = ballots[id] = ballots[id] || {};
    // 순서: 투표지 번호의 시각(ms, 예전 투표지는 일련번호) → 같으면 시트에 먼저 붙은 줄
    (b[ballot] = b[ballot] || { voter: voter, key: key, vt: vt, seq: Number((/^B(\d+)/.exec(ballot) || [])[1]) || 0, pos: pos, rows: [] }).rows.push({ team: team, sig: sig });
  });
  var out = { by: {}, n: {}, voters: {}, bad: bad }, max = voteMax_(), self = voteSelf_();
  Object.keys(ballots).forEach(function (id) {
    // 투표자마다 가장 나중에 낸 투표지만
    var last = null;
    Object.keys(ballots[id]).forEach(function (bid) { var b = ballots[id][bid]; if (!last || b.seq > last.seq || (b.seq === last.seq && b.pos > last.pos)) last = b; });
    var seen = {}, ok = last.rows.length >= 1 && last.rows.length <= max, keep = [];
    last.rows.forEach(function (r) {
      if (seen[r.team] || (!self && r.team === last.vt)) ok = false;
      seen[r.team] = 1;
      // 투표한 뒤에 다른 트랙으로 옮긴 팀(TRACK_MOVES)은 그 표만 빼고, 같은 투표지의 나머지 표는 살린다
      // (검증값 덕분에 트랙이 다른 줄은 서버가 받은 뒤에 팀이 옮겨진 경우뿐이다)
      if (trackKeyOf_(r.team) === last.key) keep.push(r);
    });
    if (!ok) { out.bad[last.key] = (out.bad[last.key] || 0) + last.rows.length; return; }
    if (!keep.length) return;
    var mine = (out.by[last.voter] = out.by[last.voter] || {})[last.key] = { teams: [], codes: {} };
    keep.forEach(function (r) {
      mine.teams.push(r.team);
      mine.codes[r.team] = r.sig.slice(0, 6).toUpperCase();
      out.n[r.team] = (out.n[r.team] || 0) + 1;
    });
    out.voters[last.key] = (out.voters[last.key] || 0) + 1;
  });
  cachePut_('votes1', out, 60);
  return (MEMO.votes = out);
}

/** 심사위원 점수의 비중 (0 – 1) · 참가자 점수 만점 · 만점에 필요한 득표(팀당 평균의 몇 배) */
function judgeW_() { var w = Number(conf_('JUDGE_WEIGHT')); return w > 0 && w <= 1 ? w : 0.85; }
function popMax_() { return round2_(100 * (1 - judgeW_())); }
function popFull_() { var x = Number(conf_('POP_FULL_X')); return x > 0 && x <= 20 ? x : 2; }

/** 참가자 점수 P (popMax_ 점 만점, 기본 15). mean 은 그 트랙의 팀당 평균 득표. */
function popScore_(v, mean) {
  if (!(mean > 0)) return 0;
  return Math.round(popMax_() * Math.sqrt(Math.min(1, v / (popFull_() * mean))) * 100) / 100;
}
/** 트랙별 결과 — 운영진에게만 준다 */
function voteTally_() {
  var v = votes_(), all = states_(), people = roster_().people || 0;
  return voteTracks_().map(function (tr) {
    var nos = voteTeams_(tr.key), V = 0, w = voteWin_(tr.key);
    nos.forEach(function (no) { V += v.n[no] || 0; });
    var mean = nos.length ? V / nos.length : 0;
    return {
      key: tr.key, name: tr.name, state: voteState_(tr.key), from: w.from, until: w.until, custom: voteCustom_(tr.key),
      votes: V, teams: nos.length,
      mean: Math.round(mean * 100) / 100, full: Math.round(popFull_() * mean * 100) / 100, popMax: popMax_(), popFull: popFull_(),
      voters: v.voters[tr.key] || 0, eligible: people, bad: (v.bad || {})[tr.key] || 0,
      rows: nos.map(function (no) {
        var n = v.n[no] || 0;
        return { no: no, title: (all[no] || {}).title || '', votes: n, p: popScore_(n, mean) };
      })
    };
  });
}

/** 투표 페이지가 처음 · 가끔 부른다: 트랙별 상태, 팀 목록, 내 투표지 (운영진이면 결과까지) */
function actVoteMe_(body) {
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  var member = !!(a.team && !a.proxy && a.team !== TEST_TEAM);
  if (!member && !a.admin) return { ok: false, error: 'NOT_MEMBER', email: a.email, now: nowMs_() };
  var out = { ok: true, api: API_VERSION, now: nowMs_(), email: a.email, admin: a.admin, max: voteMax_(), self: voteSelf_() };
  var ses = sessionOpen_(a.claims);
  if (ses) { out.sid = ses.sid; out.sidLeft = ses.left; }
  var salt = voteSalt_(), all = states_();
  var mine = member ? (votes_().by[voterKey_(a, salt)] || {}) : {};
  out.me = member ? { team: a.team, track: trackOf_(a.team), trackKey: trackKeyOf_(a.team), name: a.name } : null;
  out.tracks = voteTracks_().map(function (tr) {
    var m = mine[tr.key] || { teams: [], codes: {} }, w = voteWin_(tr.key);
    return {
      key: tr.key, name: tr.name, state: voteState_(tr.key), from: w.from, until: w.until, mine: m.teams, codes: m.codes,
      teams: voteTeams_(tr.key).map(function (no) {
        var s = all[no] || blank_(no);
        return { no: no, title: s.title, desc: s.desc, url: s.url };
      })
    };
  });
  if (a.admin) out.tally = voteTally_();
  return out;
}

/** 투표지를 낸다: { track:'A', teams:['01','04','07'] }. 다시 내면 먼젓번 투표지는 세지 않는다. */
function actVoteSubmit_(body) {
  var t0 = nowMs_();                                       // 마감 시각은 요청이 들어온 때로 견준다 (잠금을 기다린 시간은 빼고)
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  if (!a.team || a.proxy || a.team === TEST_TEAM) return fail_('NOT_MEMBER', { email: a.email });
  var tr = voteTrack_(body.track);
  if (!tr) return fail_('BAD_TRACK');
  var st = voteState_(tr.key, t0);
  if (st !== 'open') return fail_(st === 'closed' ? 'VOTE_CLOSED' : 'VOTE_NOT_OPEN');
  var max = voteMax_(), self = voteSelf_(), seen = {};
  var pick = Array.isArray(body.teams) ? body.teams.slice(0, 20).map(function (x) { return teamNo_(x); }) : [];
  if (!pick.length) return fail_('VOTE_EMPTY');
  if (pick.length > max) return fail_('VOTE_TOO_MANY', { max: max });
  for (var i = 0; i < pick.length; i++) {
    var no = pick[i];
    if (!no || trackKeyOf_(no) !== tr.key || voteTeams_(tr.key).indexOf(no) === -1) return fail_('VOTE_BAD_TEAM', { team: no });
    if (seen[no]) return fail_('VOTE_DUP', { team: no });
    if (!self && no === a.team) return fail_('VOTE_SELF');
    seen[no] = 1;
  }
  if (!hit_('vote:' + a.sub, 20, 600)) return fail_('TOO_MANY');
  var salt = voteSalt_(), voter = voterKey_(a, salt);          // (솔트를 처음 만들 때만 잠근다)

  // 잠그지 않는다 — 발표가 끝나고 수십 명이 한꺼번에 내도 줄 서지 않게. appendRow 는 다른 실행과 겹쳐도 줄이 섞이지 않는다.
  // 투표지 번호는 시각(ms) + 임의 세 자리라 시트를 읽지 않고 만들 수 있고, 셀 때 '가장 나중 투표지'를 이 번호로 고른다.
  return once_(a, body.nonce, function () {
    propsDrop_();                                                // 운영진이 방금 닫았을 수 있다 — 캐시가 아니라 지금 값으로
    var now = voteState_(tr.key, t0);
    if (now !== 'open') return fail_(now === 'closed' ? 'VOTE_CLOSED' : 'VOTE_NOT_OPEN');
    // 투표지 번호: 받은 시각(ms) + 겹치지 않는 꼬리 (같은 1/1000초에 여럿이 내도 번호가 갈리게 — 세 자리 난수는 1/1000 로 겹쳤다)
    var ms = nowMs_(), at = kst_(ms), ballot = 'B' + ms + '-' + rand_(8);
    var sh = voteSheet_(), head = voteHead_(sh), codes = {}, recs = {};
    pick.forEach(function (no) {
      var sig = voteSig_(salt, ballot, tr.key, voter, a.team, no, at);
      codes[no] = sig.slice(0, 6).toUpperCase();
      var rec = recs[no] = { '시각': at, '트랙': tr.name, '투표지': ballot, '투표자(익명)': voter, '투표자 팀': a.team, '대상 팀': no, '검증': sig, '상태': '유효' };
      // ' 를 붙여 글자로 고정한다 (시각이 날짜로, '03' 이 3 으로 바뀌면 검증값이 맞지 않게 된다)
      sh.appendRow(head.map(function (h) { return rec[h] === undefined ? '' : "'" + rec[h]; }));
    });
    voteVerify_(sh, head, ballot, recs);
    cacheDrop_('votes1');
    // `기록` 에는 누가 냈는지도 남기지 않는다 — 시각이 `투표` 탭과 같아서, 이메일을 적으면 두 탭을 맞춰 보는 것만으로 누가 누구에게 줬는지 드러난다
    log_({ email: '(익명 투표)', team: '' }, 'vote.submit', tr.name, pick.length + '표');
    return { ok: true, track: tr.key, mine: pick.slice(), codes: codes };
  });
}

function voteSheet_() { return ss_().getSheetByName(TABS.vote.name) || table_('vote').sheet; }
/**
 * 방금 붙인 줄을 다시 읽어 적은 그대로인지 본다. 시트가 글자를 숫자 · 날짜로 바꿔 놓았으면(검증값이 어긋난다)
 * 그 줄만 글자 서식으로 다시 쓴다. 투표지 번호로 내 줄만 찾으므로 다른 실행이 붙인 줄은 건드리지 않는다.
 */
function voteVerify_(sh, head, ballot, recs) {
  try {
    var last = sh.getLastRow(), from = Math.max(2, last - Object.keys(recs).length - 60);
    if (last < from) return;
    var iB = head.indexOf('투표지'), iT = head.indexOf('대상 팀'), iV = head.indexOf('투표자(익명)');
    var vals = sh.getRange(from, 1, last - from + 1, head.length).getValues();
    vals.forEach(function (row, j) {
      if (str_(row[iB]) !== ballot) return;
      var rec = recs[teamNo_(row[iT])];
      // 내 줄만 — 같은 1/1000초에 같은 난수로 투표지 번호가 겹친 다른 사람의 줄은 건드리지 않는다
      if (!rec || iV < 0 || str_(row[iV]) !== String(rec['투표자(익명)'])) return;
      if (head.every(function (h, k) { return rec[h] === undefined || str_(row[k]) === String(rec[h]); })) return;
      var r = sh.getRange(from + j, 1, 1, head.length);
      r.setNumberFormat('@');
      r.setValues([head.map(function (h, k) { return rec[h] === undefined ? row[k] : String(rec[h]); })]);
    });
  } catch (e) {}
}
/** `투표` 탭의 머리줄만 읽는다 (탭 전체를 읽지 않게). 빠진 열이 있으면 한 번 채운다 */
function voteHead_(sh) {
  var read = function () { var n = sh.getLastColumn(); return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(function (h) { return str_(h); }) : []; };
  var head = read();
  if (TABS.vote.head.every(function (h) { return h === '번호' || head.indexOf(h) !== -1; })) return head;
  table_('vote', true);
  return read();
}

/**
 * 운영진: 트랙별 투표 시간을 옮긴다 { track:'H', op }. 시각은 스크립트 속성 VOTE_<트랙>_FROM · _UNTIL 에 적는다.
 *   open   지금 연다. 마감 시각이 지났거나 1분 안이면 REOPEN_MIN 분 뒤로
 *   close  지금 마감
 *   extend 마감을 5분 뒤로 (열려 있을 때)
 *   delay  여는 시각과 마감을 함께 5분 뒤로 (열기 전 — 발표가 밀릴 때)
 *   auto   시간표대로 (속성을 지워 CONFIG 의 시각으로)
 */
function actVoteAdmin_(body) {
  var a = actor_(body);
  if (a.error) return fail_(a.error);
  if (!a.admin) return fail_('NOT_ADMIN');
  var tr = voteTrack_(body.track);
  if (!tr) return fail_('BAD_TRACK');
  var op = String(body.op || '');
  if (['open', 'close', 'extend', 'delay', 'auto'].indexOf(op) === -1) return fail_('BAD_OP');
  voteSalt_();
  // 같은 누름을 다시 보내도(응답이 끊겨 화면이 다시 보낸 경우) '5분 연장' 이 두 번 되지 않게
  return once_(a, body.nonce, function () {
  var now = nowMs_(), F = 'VOTE_' + tr.key + '_FROM', U = 'VOTE_' + tr.key + '_UNTIL', STEP = 5 * 60000;
  var bad = withLock_(function () {
    propsDrop_();
    var P = PropertiesService.getScriptProperties(), w = voteWin_(tr.key), st = voteState_(tr.key, now);
    if (op === 'open') {
      if (!w.from || w.from > now) P.setProperty(F, iso_(now));
      if (w.until && w.until <= now + 60000) P.setProperty(U, iso_(now + reopenMin_() * 60000));
    } else if (op === 'close') {
      if (st !== 'open') return 'VOTE_NOT_OPEN';
      P.setProperty(U, iso_(now));
    } else if (op === 'extend') {
      if (st !== 'open' || !w.until) return 'VOTE_NOT_OPEN';
      P.setProperty(U, iso_(w.until + STEP));
    } else if (op === 'delay') {
      if (st !== 'ready' || !w.from) return 'VOTE_NOT_READY';
      P.setProperty(F, iso_(w.from + STEP));
      if (w.until) P.setProperty(U, iso_(w.until + STEP));
    } else {
      P.deleteProperty(F); P.deleteProperty(U);
    }
    return '';
  });
  propsDrop_();                                                  // 다른 실행도 바로 새 값을 보게
  if (bad) return fail_(bad, { track: tr.key, state: voteState_(tr.key) });
  var w2 = voteWin_(tr.key);
  log_(a, 'vote.' + op, tr.name, (w2.from ? kst_(w2.from).slice(11, 16) : '') + '–' + (w2.until ? kst_(w2.until).slice(11, 16) : ''));
  return { ok: true, track: tr.key, state: voteState_(tr.key), from: w2.from, until: w2.until, tally: voteTally_() };
  });
}

/* ================================================================
   공개 현황판 — /judge/ (열람 링크 없이 오는 사람 · 메인 메뉴 '제출·투표 현황')
   ----------------------------------------------------------------
   로그인 없이 누구나 본다. 그래서 팀 번호 · 낸 것의 유무 · 투표한 사람 수만 담는다 —
   프로젝트 이름 · 파일 · 링크 · 이메일 · 팀별 득표는 담지 않는다.
   제출 현황은 BOARD_SUBMIT_SEC(5분)마다, 투표한 사람 수는 BOARD_VOTE_SEC(1분)마다 새로 센다.
   그 사이에는 캐시에 둔 같은 값을 주므로, 화면을 몇 명이 띄워 두든 시트는 그 간격으로만 읽는다.
   투표가 열렸는지 · 닫혔는지는 시각으로 매번 판단한다.
   ================================================================ */

function boardSec_(k, def) { var n = Number(conf_(k)); return n >= 10 && n <= 3600 ? Math.floor(n) : def; }

function actStatusPublic_(body) {
  var now = nowMs_(), sSec = boardSec_('BOARD_SUBMIT_SEC', 300), vSec = boardSec_('BOARD_VOTE_SEC', 60);
  var sb = Math.floor(now / (sSec * 1000)), vb = Math.floor(now / (vSec * 1000));
  var ph = phase_(), sk = 'pub:s:' + sSec + ':' + sb + ':' + ph, sub = cacheGet_(sk);   // 마감 · 유예 끝에는 바로 새로 센다
  if (!sub) {
    var all = states_(), teams = [], sum = { teams: 0, complete: 0, deck: 0, product: 0 };
    voteTracks_().forEach(function (tr) {
      voteTeams_(tr.key).forEach(function (no) {
        var s = all[no] || blank_(no), deck = !!s.deck, product = !!(s.url || s.program), done = complete_(s);
        sum.teams++;
        if (done) sum.complete++;
        if (deck) sum.deck++;
        if (product) sum.product++;
        teams.push({ no: no, track: tr.key, deck: deck, product: product, done: done });
      });
    });
    sub = { at: now, teams: teams, sum: sum };
    // 발표 순서는 마감(10:00)이 지나야 보인다. 유예(올리던 것 마무리) 동안은 바뀔 수 있어 final: false
    if (ph === 'grace' || ph === 'closed') {
      var rk = presentRanks_(all);
      sub.order = { final: ph === 'closed', tracks: voteTracks_().map(function (tr) {
        return { key: tr.key, teams: voteTeams_(tr.key).map(function (no) { return { no: no, rank: rk[no] || 0, at: (all[no] || {}).at || 0 }; })
          .sort(function (x, y) { return x.rank - y.rank; }) };
      }) };
    }
    cachePut_(sk, sub, sSec + 30);
  }
  var vk = 'pub:v:' + vSec + ':' + vb, cnt = cacheGet_(vk);
  if (!cnt) {
    var v = votes_();
    cnt = { at: now, voters: v.voters || {} };
    cachePut_(vk, cnt, vSec + 30);
  }
  return {
    ok: true, api: API_VERSION, now: now, deadline: deadlineMs_(), graceMin: graceMin_(), phase: phase_(),
    submit: { at: sub.at, next: (sb + 1) * sSec * 1000, every: sSec, sum: sub.sum, teams: sub.teams, order: sub.order || null },
    vote: {
      at: cnt.at, next: (vb + 1) * vSec * 1000, every: vSec, eligible: roster_().people || 0,
      tracks: voteTracks_().map(function (tr) {
        var w = voteWin_(tr.key);
        return { key: tr.key, name: tr.name, state: voteState_(tr.key), from: w.from, until: w.until, voters: cnt.voters[tr.key] || 0 };
      })
    }
  };
}

/* ================================================================
   누구인가 — 구글 로그인 · 명단 · 운영진 · 열람 토큰
   ================================================================ */

/**
 * 요청을 보낸 계정과, 그 계정이 일하는 팀.
 *   { claims, email, sub, admin, proxy, team, name }  또는  { error }
 * 운영진(ADMINS)은 body.as 로 팀을 골라 대신 올릴 수 있다 (proxy). 그 밖의 사람이 as 를 보내도 무시한다.
 */
function actor_(body) {
  var claims = session_(body.sid) || verifyIdToken_(body.idToken);
  if (!claims) return { error: 'AUTH_FAILED' };
  var email = String(claims.email || '').toLowerCase();
  var admin = admins_().indexOf(email) !== -1;
  var m = member_(claims);
  var as = admin && body.as ? teamNo_(body.as) : '';
  if (as && !isTeam_(as)) return { error: 'BAD_TEAM' };
  return {
    claims: claims, email: email, sub: String(claims.sub || ''), admin: admin, proxy: !!as,
    team: as || (m ? m.team : ''), name: as ? '운영진' : (m ? m.name : '')
  };
}

/** 구글이 발급한 ID 토큰을 구글 서버에 직접 물어서 검증한다. (신청서 백엔드와 같은 방식) */
function verifyIdToken_(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) return null;
  var cache = cache_(), key = null;
  if (cache) {
    try {
      key = 'tok:' + sha256hex_(idToken);
      var hit = cache.get(key);
      if (hit) {
        var c = JSON.parse(hit);
        if (Number(c.exp) * 1000 > nowMs_()) return c;
      }
    } catch (e) {}
  }
  // 구글에 묻는 횟수에는 한 시간 한도를 둔다 — 엉터리 토큰을 쏟아부어 하루치 외부 요청 한도를 다 쓰게 만들지 못하게.
  // 한도에 걸려도 이미 로그인한 사람(세션 값)은 영향을 받지 않는다.
  if (!hit_('verify:' + Math.floor(nowMs_() / 3600000), VERIFY_PER_HOUR, 3700)) throw new Error('AUTH_BUSY');
  var res;
  try {
    res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true });
  } catch (e3) {
    throw new Error('AUTH_BUSY');        // 구글에 닿지 못했다. 원래 오류 문구에는 토큰이 섞여 있어 그대로 던지지 않는다
  }
  if (res.getResponseCode() !== 200) return null;
  var p = JSON.parse(res.getContentText());
  if (!CONFIG.CLIENT_ID || p.aud !== CONFIG.CLIENT_ID) return null;
  if (p.iss !== 'accounts.google.com' && p.iss !== 'https://accounts.google.com') return null;
  if (String(p.email_verified) !== 'true' || !p.email) return null;
  var left = Math.floor(Number(p.exp) - nowMs_() / 1000);
  if (!(left > 0)) return null;
  var keep = { sub: String(p.sub || ''), email: String(p.email), name: String(p.name || ''), exp: Number(p.exp) };
  if (cache && key && left > 30) { try { cache.put(key, JSON.stringify(keep), Math.min(left - 30, 300)); } catch (e2) {} }
  return keep;
}

/* ----------------------------------------------------------------
   로그인 유지
   구글 로그인 토큰은 한 시간이면 끝난다. 밤새 열어 두는 화면이 한 시간마다 끊기거나, 큰 파일을 올리는
   도중에 끊기지 않도록, 구글 토큰을 한 번 확인한 뒤에는 이 스크립트가 만든 세션 값(sid)으로 같은 사람임을 확인한다.
   - sid 는 캐시에만(해시로) 있다. 6시간 동안 쓰지 않으면 사라지고, 쓰는 동안에는 늘어나되 로그인한 지 18시간을 넘지 못한다.
   - sid 는 "누구인가"만 대신한다. 어느 팀인지 · 운영진인지는 요청마다 명단에서 다시 찾는다.
   ---------------------------------------------------------------- */
var VERIFY_PER_HOUR = 300;            // 구글에 로그인 토큰을 물어보는 횟수 (한 시간에)
var SESSION_TTL = 21600;              // 초. 캐시에 둘 수 있는 가장 긴 시간
var SESSION_MAX = 18 * 3600000;       // ms. 구글 로그인 한 번으로 이어 쓸 수 있는 가장 긴 시간

function sidKey_(sid) {
  sid = (typeof sid === 'string') ? sid : '';
  return /^[A-Za-z0-9_\-]{32,64}$/.test(sid) ? 'ss1:' + sha256hex_(sid) : '';
}
/** 세션 값이 살아 있으면 구글 토큰을 확인했을 때와 같은 모양으로 돌려준다. */
function session_(sid) {
  var k = sidKey_(sid);
  if (!k) return null;
  var rec = cacheGet_(k);
  if (!rec || !rec.sub || !rec.email || !(Number(rec.until) > nowMs_())) return null;
  return {
    sub: String(rec.sub), email: String(rec.email), name: String(rec.name || ''),
    exp: Math.floor(Number(rec.until) / 1000), t0: Number(rec.t0) || 0, sid: sid
  };
}
/**
 * 세션을 만들거나(구글 토큰으로 들어온 경우) 늘린다(세션 값으로 들어온 경우). { sid, left(초) } 를 돌려준다.
 * 줄 수 없으면 null — 그러면 화면은 구글 토큰으로 계속 쓴다.
 */
function sessionOpen_(claims) {
  if (!cache_() || !claims || !claims.sub || !claims.email) return null;
  var now = nowMs_(), old = !!claims.sid;
  // 새로 만드는 것은 계정마다 한 시간에 20번까지 (같은 계정으로 캐시를 채우지 못하게)
  if (!old && !hit_('ses:' + claims.sub, 20, 3600)) return null;
  var sid = old ? claims.sid : secret_();
  var t0 = old ? (claims.t0 || now) : now;
  var until = Math.min(now + SESSION_TTL * 1000, t0 + SESSION_MAX);
  var left = Math.floor((until - now) / 1000);
  if (left < 60) return old ? { sid: sid, left: Math.max(0, left) } : null;
  cachePut_(sidKey_(sid), { sub: claims.sub, email: claims.email, name: claims.name || '', t0: t0, until: until }, left);
  return { sid: sid, left: left };
}

function admins_() {
  if (MEMO.admins) return MEMO.admins;
  var list = (CONFIG.ADMINS || []).concat(String(props_().ADMINS || '').split(/[,\s]+/));
  return (MEMO.admins = list.map(function (s) { return String(s).trim().toLowerCase(); }).filter(function (s) { return s; }));
}

/** `팀원` 탭 → 계정 식별자 · 이메일로 찾는 표. 90초 동안 캐시에 둔다 (운영진이 시트를 고치면 늦어도 그 안에 반영). */
function roster_() {
  if (MEMO.roster) return MEMO.roster;
  var hit = cacheGet_('roster1');
  if (hit) return (MEMO.roster = hit);
  var t = table_('member'), c = t.col;
  var r = { sub: {}, mail: {}, teams: {}, people: 0 }, seenP = {};
  t.rows.forEach(function (row, i) {
    var no = teamNo_(row[c['팀']]);
    if (!no) return;
    if (/불참|제외|탈퇴|미배정/.test(str_(row[c['상태']]))) return;
    var rec = { team: no, name: str_(row[c['이름']]) };
    var sub = str_(row[c['계정 식별자']]), mail = mailKey_(row[c['이메일']]);
    if (sub && !r.sub[sub]) r.sub[sub] = rec;
    if (mail && !r.mail[mail]) r.mail[mail] = rec;
    r.teams[no] = (r.teams[no] || 0) + 1;
    // 사람 수 (같은 사람의 계정 여러 줄은 한 명). 연습용 팀은 빼고 센다
    var pk = no + '|' + (nameKey_(rec.name) || '#' + i);
    if (no !== TEST_TEAM && !seenP[pk]) { seenP[pk] = 1; r.people++; }
  });
  cachePut_('roster1', r, 90);
  return (MEMO.roster = r);
}

/** 계정 식별자를 먼저 보고, 없으면 이메일. 식별자는 계정마다 고정이라 주소가 바뀌어도 같은 사람이다. */
function member_(claims) {
  var r = roster_();
  var sub = String(claims.sub || ''), mail = mailKey_(claims.email);
  return (sub && r.sub[sub]) || (mail && r.mail[mail]) || null;
}

/** 이름 비교용: 빈칸을 없애고 소문자로. '홍 길동' 과 '홍길동' 을 같은 사람으로 본다. */
function nameKey_(v) {
  var s = str_(v);
  try { s = s.normalize('NFC'); } catch (e) {}
  return s.replace(/\s+/g, '').toLowerCase();
}

/**
 * 주소를 견주는 꼴. 지메일은 점과 +꼬리표를 가리지 않으므로(같은 계정이다) 둘을 뗀 꼴로 맞춘다 —
 * 손으로 적은 주소가 점 하나 달라서 "명단에 없다"가 되지 않게. 다른 메일은 소문자로만 맞춘다.
 */
function mailKey_(v) {
  var mail = str_(v).toLowerCase();
  var m = /^([^@\s]+)@(gmail\.com|googlemail\.com)$/.exec(mail);
  return m ? m[1].replace(/\+.*$/, '').replace(/\./g, '') + '@gmail.com' : mail;
}

/** `열람` 탭 → 토큰 해시로 찾는 표. 시트에는 해시만 있고 토큰 자체는 어디에도 남기지 않는다. */
function viewers_() {
  if (MEMO.viewers) return MEMO.viewers;
  var hit = cacheGet_('views1');
  if (hit) return (MEMO.viewers = hit);
  var t = table_('view'), c = t.col, out = {}, salt = String(props_().VOTE_SALT || '');
  t.rows.forEach(function (row, i) {
    var h = str_(row[c['토큰 해시']]).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) return;
    if (!/^(o|y|yes|true|사용|1)$/i.test(str_(row[c['사용']]))) return;
    // 이름을 넣어 만든 토큰은 지금 적힌 이름과 짝이 맞아야 한다 (검증 칸이 빈 예전 줄은 그대로 받는다)
    var sig = c['검증'] === undefined ? '' : str_(row[c['검증']]).toLowerCase();
    if (sig && (!salt || sig !== viewSig_(salt, str_(row[c['이름']]), h))) return;
    out[h] = { name: str_(row[c['이름']]), role: str_(row[c['역할']]) || '심사위원', until: time_(row[c['만료']]), row: i + 2 };
  });
  cachePut_('views1', out, 60);
  return (MEMO.viewers = out);
}

/** 열람 토큰의 이름 묶음: SHA-256(솔트 | view | 이름 | 토큰 해시) 앞 32자 */
function viewSig_(salt, name, hash) {
  return sha256hex_([salt, 'view', nameKey_(name), String(hash).toLowerCase()].join('|')).slice(0, 32);
}

function viewer_(key) {
  key = String(key == null ? '' : key).trim();
  if (key.length < 24 || key.length > 128) return null;
  var h = sha256hex_(key), v = viewers_()[h];
  if (!v) return null;
  if (v.until && nowMs_() > v.until) return null;
  return { name: v.name, role: v.role, hash: h, row: v.row };
}

/** 열람자가 마지막으로 들어온 시각. 10분에 한 번만 적는다 (볼 때마다 시트를 쓰지 않으려고). */
function seen_(v) {
  try {
    var cache = cache_(), k = 'seen:' + v.hash.slice(0, 24);
    if (!cache || cache.get(k)) return;
    cache.put(k, '1', 600);
    var t = table_('view');
    if (t.col['마지막 접속'] === undefined) return;
    t.sheet.getRange(v.row, t.col['마지막 접속'] + 1).setNumberFormat('@').setValue(kst_(nowMs_()));
  } catch (e) {}
}

/* ================================================================
   시각 · 마감
   ================================================================ */

function nowMs_() { return MEMO.now || Date.now(); }
function isoMs_(iso) { var t = iso ? Date.parse(String(iso)) : NaN; return isNaN(t) ? 0 : t; }
function openMs_() { return isoMs_(conf_('OPEN_AT')); }
function deadlineMs_() { return isoMs_(conf_('DEADLINE')); }
function graceMin_() { var g = Number(conf_('GRACE_MIN')); return (isNaN(g) || g < 0) ? 0 : Math.min(g, 120); }
function reopenMin_() { var m = Number(conf_('REOPEN_MIN')); return m >= 1 && m <= 180 ? m : 10; }
/**
 * 시각 설정 하나(투표 · 심사 마감) → ms. 비었거나 'none' 이면 0 (그쪽 끝이 없다).
 * 스크립트 속성에 손으로 적을 때는 '2026-11-14T12:40:00+09:00' 이나 '2026-11-14 12:40' (서울 시각) 처럼.
 */
function cutMs_(k) {
  var s = str_(conf_(k));
  if (!s || /^(none|off|없음|-)$/i.test(s)) return 0;
  return time_(s);
}
/** ms → '2026-11-14T12:40:00+09:00' (스크립트 속성에 적는 꼴) */
function iso_(ms) { return kst_(ms).replace(' ', 'T') + '+09:00'; }

/** 'before' 아직 안 열림 · 'open' 받는 중 · 'grace' 마감 직후(올리던 것만 마무리) · 'closed' 끝 */
function phase_() {
  var now = nowMs_(), o = openMs_(), d = deadlineMs_();
  if (o && now < o) return 'before';
  if (!d || now <= d) return 'open';
  if (now <= d + graceMin_() * 60000) return 'grace';
  return 'closed';
}

/** 지금 이 일을 해도 되는가. 되면 '' , 안 되면 오류 이름. what: 'edit' 새로 올리기·고치기 / 'finish' 올리던 것 마무리 */
function gate_(a, what) {
  if (a.proxy) return '';            // 운영진이 대신 올릴 때는 시각을 보지 않는다 (늦은 팀 구제는 운영진 판단)
  var p = phase_();
  if (p === 'before') return 'NOT_OPEN_YET';
  if (p === 'open') return '';
  if (p === 'grace') return what === 'finish' ? '' : 'CLOSED';
  return what === 'finish' ? 'LATE' : 'CLOSED';
}

function kst_(ms) { return Utilities.formatDate(new Date(ms), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'); }
function stamp_(ms) { return Utilities.formatDate(new Date(ms), 'Asia/Seoul', 'MMdd-HHmm'); }

/** 시트 칸의 시각 → ms. 스크립트가 쓴 'yyyy-MM-dd HH:mm:ss'(서울) 글자, 사람이 고쳐서 날짜가 된 칸, ISO 글자를 다 받는다. */
function time_(v) {
  if (v instanceof Date) return v.getTime();
  var s = str_(v);
  if (!s) return 0;
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + '+09:00') || 0;
  var t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

/* ================================================================
   팀 · 트랙
   ================================================================ */

/** '3' · 3 · 'team03' · 'Team 3' · '3팀' → '03'. 숫자가 없으면 '' */
function teamNo_(v) {
  var m = /(\d{1,3})/.exec(str_(v));
  if (!m) return '';
  var n = Number(m[1]);
  return n < 10 ? '0' + n : String(n);
}

function trackOf_(no) {
  if (no === TEST_TEAM) return '연습';
  var mv = trackMoves_()[teamNo_(no)];
  if (mv) { var nm = ''; CONFIG.TRACKS.forEach(function (tr) { if (tr.key === mv) nm = tr.name; }); if (nm) return nm; }
  var n = Number(no), name = '';
  CONFIG.TRACKS.forEach(function (tr) { if (n >= tr.from && n <= tr.to) name = tr.name; });
  return name;
}

/** 대회의 팀 번호 전부 (트랙 범위 + 명단에만 있는 번호). 연습용 팀은 뺀다. */
function teamNos_() {
  if (MEMO.nos) return MEMO.nos;
  var set = {};
  CONFIG.TRACKS.forEach(function (tr) { for (var n = tr.from; n <= tr.to; n++) set[teamNo_(n)] = 1; });
  Object.keys(roster_().teams).forEach(function (no) { if (no !== TEST_TEAM) set[no] = 1; });
  return (MEMO.nos = Object.keys(set).sort());
}
function isTeam_(no) { return no === TEST_TEAM || teamNos_().indexOf(no) !== -1; }
function teamList_(withTest) {
  var out = teamNos_().map(function (no) { return { no: no, track: trackOf_(no) }; });
  if (withTest) out.push({ no: TEST_TEAM, track: trackOf_(TEST_TEAM) });
  return out;
}

/* ================================================================
   팀 상태 — `팀` 탭과 `파일` 탭을 합친 것. 팀마다 캐시에 둔다.
   ================================================================ */

function blank_(no) {
  return { no: no, track: trackOf_(no), title: '', desc: '', url: '', video: '', order: 0, at: 0, by: '',
           deck: null, program: null, history: [] };
}

function buildStates_() {
  var tt = table_('team'), ft = table_('file'), out = {}, c = tt.col, f = ft.col;
  teamList_(true).forEach(function (tm) { out[tm.no] = blank_(tm.no); });
  tt.rows.forEach(function (row) {
    var s = out[teamNo_(row[c['팀']])];
    if (!s) return;
    s.title = str_(row[c['프로젝트']]); s.desc = str_(row[c['설명']]);
    s.url = str_(row[c['배포 주소']]); s.video = str_(row[c['데모 영상']]);
    s.order = Number(row[c['순서']]) || 0;
    s.at = time_(row[c['마지막 제출']]); s.by = str_(row[c['제출자']]);
  });
  ft.rows.forEach(function (row) {
    var s = out[teamNo_(row[f['팀']])], kind = kindOf_(row[f['종류']]);
    if (!s || !kind) return;
    var status = str_(row[f['상태']]);
    var x = {
      id: Number(row[f['번호']]) || 0, kind: kind, v: Number(row[f['버전']]) || 0,
      name: str_(row[f['이름']]), orig: str_(row[f['원래 이름']]), size: Number(row[f['크기']]) || 0,
      md5: str_(row[f['md5']]), mime: str_(row[f['형식']]), at: time_(row[f['올린 시각']]),
      by: str_(row[f['올린 사람']]), drive: str_(row[f['Drive ID']]),
      pdf: f['PDF ID'] !== undefined && str_(row[f['PDF ID']]) ? { drive: str_(row[f['PDF ID']]), size: Number(row[f['PDF 크기']]) || 0 } : null
    };
    if (!x.id) return;
    if (status === '현재') s[kind] = x;
    else if (status === '이전') s.history.push(x);
  });
  Object.keys(out).forEach(function (no) {
    out[no].history.sort(function (x, y) { return y.at - x.at || y.id - x.id; });
    out[no].history = out[no].history.slice(0, 20);
  });
  return out;
}

/** 모든 팀의 상태. 캐시에 다 있으면 시트를 읽지 않는다. */
function states_() {
  if (MEMO.states) return MEMO.states;
  var nos = teamList_(true).map(function (tm) { return tm.no; });
  var cache = cache_();
  if (cache) {
    try {
      var got = cache.getAll(nos.map(function (no) { return 'st1:' + no; })), out = {}, ok = true;
      nos.forEach(function (no) { var s = got['st1:' + no]; if (s) out[no] = JSON.parse(s); else ok = false; });
      if (ok) return (MEMO.states = out);
    } catch (e) {}
  }
  return refreshStates_();
}

/** 시트를 새로 읽어 상태를 다시 만들고 캐시에 채운다. 쓰기 뒤에 부른다. */
function refreshStates_() {
  try { SpreadsheetApp.flush(); } catch (e) {}
  MEMO.t = {};
  var out = buildStates_(), cache = cache_();
  if (cache) {
    try {
      var m = {};
      Object.keys(out).forEach(function (no) { m['st1:' + no] = JSON.stringify(out[no]); });
      cache.putAll(m, STATE_TTL);
    } catch (e2) {}
  }
  return (MEMO.states = out);
}

function stateOf_(no) { return states_()[no] || blank_(no); }

/** 한 팀이 쌓아 둘 수 있는 전체 용량(바이트). 0 이면 제한 없음. */
function teamCap_() {
  var g = Number(conf_('TEAM_MAX_GB'));
  return g > 0 ? Math.floor(g * 1024 * MB) : 0;
}
/** 그 팀이 지금까지 쌓아 둔 용량: 지금 제출물 + 옛날 자료. (올리다 만 것은 세지 않는다 — 끊겨서 다시 올리는 팀을 막지 않으려고) */
function teamBytes_(no) {
  var s = stateOf_(no), sum = 0;
  [s.deck, s.program].concat(s.history).forEach(function (x) { if (x) sum += Number(x.size) || 0; });
  return sum;
}
function complete_(s) { return !!(s.title && s.deck && (s.url || s.program)); }

/** 번호로 파일을 찾는다. team 을 주면 그 팀 것에서만 찾는다 (참가자). noTest 면 연습용 팀은 빼고. 올라온 파일(현재·이전)만. */
function fileById_(id, team, noTest) {
  var all = states_(), found = null;
  Object.keys(all).forEach(function (no) {
    if (found || (team && no !== team) || (noTest && no === TEST_TEAM)) return;
    var s = all[no];
    [s.deck, s.program].concat(s.history).forEach(function (x) { if (x && x.id === id && x.drive) found = x; });
  });
  return found;
}

/** 받는 사람에 맞춰 덜어 낸다. aud: 'member' 자기 팀 / 'judge' 심사위원 / 'staff' 운영진 */
function fileOut_(x, aud) {
  if (!x) return null;
  var o = { id: x.id, kind: x.kind, v: x.v, name: x.name, size: x.size, md5: x.md5, mime: x.mime, at: x.at };
  if (x.pdf) o.pdf = x.pdf.size || 1;                       // 보기용 PDF 가 있다 (크기). Drive 주소는 주지 않는다
  if (aud === 'member') { o.orig = x.orig; o.by = whoLabel_(x.by); }
  if (aud === 'staff') { o.orig = x.orig; o.by = x.by; o.driveUrl = fileUrl_(x.drive); if (x.pdf) o.pdfUrl = fileUrl_(x.pdf.drive); }
  return o;
}
function stateOut_(s, aud) {
  var o = {
    no: s.no, track: s.track, title: s.title, desc: s.desc, url: s.url, video: s.video,
    deck: fileOut_(s.deck, aud), program: fileOut_(s.program, aud),
    history: s.history.map(function (x) { return fileOut_(x, aud); }),
    at: s.at, complete: complete_(s), repo: repoUrl_(s.no)
  };
  if (aud === 'member') o.by = whoLabel_(s.by);
  else o.order = s.order;
  if (aud === 'staff') {
    o.by = s.by;
    var fid = props_()['F_' + s.no];
    o.folderUrl = fid ? folderUrl_(fid) : '';
  }
  return o;
}

/** 팀원에게 보여 줄 '올린 사람'. 명단의 이름이 있으면 이름, 없으면 가린 주소. */
function whoLabel_(by) {
  by = str_(by);
  if (!by) return '';
  if (by.indexOf('운영진') !== -1) return '운영진';
  var rec = roster_().mail[mailKey_(by)];
  if (rec && rec.name) return rec.name;
  var p = by.split('@');
  return p.length === 2 ? p[0].slice(0, 2) + '***@' + p[1] : by;
}
function byLabel_(a) { return a.proxy ? a.email + ' (운영진 대리)' : a.email; }

function repoUrl_(no) {
  if (!CONFIG.ORG || no === TEST_TEAM) return '';
  return 'https://github.com/' + CONFIG.ORG + '/' + String(CONFIG.REPO || '').replace('{no}', no);
}
function fileUrl_(id) { return id ? 'https://drive.google.com/file/d/' + id + '/view' : ''; }
function folderUrl_(id) { return id ? 'https://drive.google.com/drive/folders/' + id : ''; }

function limits_() {
  var o = {};
  Object.keys(KINDS).forEach(function (k) { o[k] = { label: KINDS[k].label, exts: KINDS[k].exts, max: KINDS[k].max }; });
  return o;
}

/* ================================================================
   시트
   ================================================================ */

function ss_() {
  if (!MEMO.ss) {
    var id = props_().SHEET_ID;
    MEMO.ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!MEMO.ss) throw new Error('스프레드시트를 찾지 못했습니다. 이 스크립트를 제출 시트에 붙여 만들거나 스크립트 속성 SHEET_ID 를 넣어 주세요.');
  }
  return MEMO.ss;
}

/**
 * 탭 하나를 통째로 한 번만 읽는다. { sheet, headers, col:{이름→칸}, rows:[[…]], n:마지막 행 번호 }
 * 탭이 없으면 만들고, 빠진 열은 끝에 덧붙인다. fresh 면 메모를 무시하고 다시 읽는다.
 */
function table_(key, fresh) {
  MEMO.t = MEMO.t || {};
  if (!fresh && MEMO.t[key]) return MEMO.t[key];
  var def = TABS[key], ss = def.book === 'score' ? scoreSs_() : ss_();
  var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
  var all = sh.getDataRange().getValues();
  var empty = all.length === 0 || (all.length === 1 && all[0].join('') === '');
  if (empty) {
    sh.getRange(1, 1, 1, def.head.length).setValues([def.head]);
    try { sh.setFrozenRows(1); sh.getRange(1, 1, 1, def.head.length).setFontWeight('bold'); } catch (e) {}
    all = [def.head.slice()];
  }
  var headers = all[0].map(function (h) { return String(h).trim(); });
  var col = {};
  headers.forEach(function (h, i) { if (h && col[h] === undefined) col[h] = i; });
  var missing = def.head.filter(function (h) { return col[h] === undefined; });
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    missing.forEach(function (h) { col[h] = headers.length; headers.push(h); });
  }
  var rows = all.slice(1).map(function (r) { while (r.length < headers.length) r.push(''); return r; });
  return (MEMO.t[key] = { key: key, sheet: sh, headers: headers, col: col, rows: rows, n: all.length });
}

/**
 * 한 행에 값을 쓴다 (열 이름으로). rowNo 가 0 이면 맨 아래 새 행.
 * 숫자 열만 숫자로 두고 나머지는 전부 텍스트 서식(@)으로 고정한 뒤에 쓴다 — '=' 로 시작하는 입력이 수식이 되지 않게.
 * 이웃한 열끼리 묶어 한 번에 쓰므로 시트를 오가는 횟수는 보통 한 번이다.
 */
function put_(t, rowNo, obj) {
  var isNew = !rowNo;
  if (isNew) rowNo = t.n + 1;
  var idx = [];
  Object.keys(obj).forEach(function (h) { if (t.col[h] !== undefined) idx.push(t.col[h]); });
  idx.sort(function (x, y) { return x - y; });
  var runs = [], cur = null;
  idx.forEach(function (c) {
    if (cur && c === cur.end + 1) cur.end = c;
    else { cur = { start: c, end: c }; runs.push(cur); }
  });
  var mem = isNew ? t.headers.map(function () { return ''; }) : t.rows[rowNo - 2];
  runs.forEach(function (r) {
    var vals = [], fmts = [];
    for (var c = r.start; c <= r.end; c++) {
      var h = t.headers[c], v = obj[h];
      var nf = NUMERIC[h], num = !!nf && typeof v === 'number' && isFinite(v);
      var out = num ? v : cell_(v);
      vals.push(out); fmts.push(num ? (typeof nf === 'string' ? nf : '0') : '@');
      mem[c] = out;
    }
    var range = t.sheet.getRange(rowNo, r.start + 1, 1, vals.length);
    range.setNumberFormats([fmts]);
    range.setValues([vals]);
  });
  if (isNew) { t.rows.push(mem); t.n = rowNo; }
  return rowNo;
}

/** `팀` 탭의 그 팀 줄을 고친다 (없으면 만든다). links: [{head, text, url}] 는 그 칸에 링크를 건다. */
function teamPatch_(a, patch, links) {
  var t = table_('team', true), i = -1;
  t.rows.forEach(function (row, j) { if (i < 0 && teamNo_(row[t.col['팀']]) === a.team) i = j; });
  var row = {};
  Object.keys(patch).forEach(function (h) { row[h] = patch[h]; });
  if (i < 0) { row['팀'] = a.team; row['트랙'] = trackOf_(a.team); }
  // 발표 순서는 마감 때의 '마지막 제출' 로 정한다 — 마감(+유예) 뒤에 운영진이 대신 올린 것은 시각을 바꾸지 않는다
  if (phase_() !== 'closed') {
    row['마지막 제출'] = kst_(nowMs_());
    row['제출자'] = byLabel_(a);
  }

  // '완료' 는 프로젝트 이름 + 발표 자료 + (배포 주소 또는 프로그램) 이 다 있을 때
  var cur = i < 0 ? null : t.rows[i];
  var val = function (h) { return row[h] !== undefined ? str_(row[h]) : (cur ? str_(cur[t.col[h]]) : ''); };
  row['완료'] = (val('프로젝트') && val('발표 자료') && (val('배포 주소') || val('프로그램'))) ? 'O' : '';

  var rowNo = put_(t, i < 0 ? 0 : i + 2, row);

  // 폴더와 파일 칸에는 Drive 로 가는 링크를 건다. 못 걸어도 제출은 된 것이다.
  try {
    var fid = props_()['F_' + a.team], all = (links || []).slice();
    if (fid && (i < 0 || !str_(t.rows[rowNo - 2][t.col['폴더']]))) all.push({ head: '폴더', text: 'team' + a.team, url: folderUrl_(fid) });
    all.forEach(function (l) {
      if (t.col[l.head] === undefined || !l.url) return;
      t.sheet.getRange(rowNo, t.col[l.head] + 1).setRichTextValue(
        SpreadsheetApp.newRichTextValue().setText(l.text).setLinkUrl(l.url).build());
      t.rows[rowNo - 2][t.col[l.head]] = l.text;
    });
  } catch (e) {}
  return rowNo;
}

function findFile_(t, id) {
  var c = t.col['번호'];
  for (var i = t.rows.length - 1; i >= 0; i--) if (Number(t.rows[i][c]) === id) return i;
  return -1;
}
function nextId_(t) {
  var c = t.col['번호'], max = 0;
  t.rows.forEach(function (row) { var n = Number(row[c]) || 0; if (n > max) max = n; });
  return max + 1;
}
function kindOf_(label) {
  var s = str_(label), found = '';
  Object.keys(KINDS).forEach(function (k) { if (KINDS[k].label === s) found = k; });
  return found;
}

/**
 * `기록` 탭에 한 줄. appendRow 는 다른 실행과 겹쳐도 줄이 섞이지 않는다.
 * appendRow 는 글자를 사람이 친 것처럼 해석하므로, 수식으로 읽힐 수 있는 글자로 시작하면 앞에 ' 를 붙여 글자로 고정한다.
 */
function log_(a, action, target, memo) {
  try {
    var sh = ss_().getSheetByName(TABS.log.name) || table_('log').sheet;
    sh.appendRow([kst_(nowMs_()), byLabel_(a), a.team || '', action, target || '', memo || ''].map(guard_));
  } catch (e) {}
}
function guard_(v) { var s = String(v == null ? '' : v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }

/* ================================================================
   Drive
   ================================================================ */

function driveReq_(method, path, payload) {
  var o = {
    url: 'https://www.googleapis.com' + path, method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  };
  if (payload !== undefined) { o.contentType = 'application/json; charset=UTF-8'; o.payload = JSON.stringify(payload); }
  return o;
}
function driveFetch_(method, path, payload) {
  var o = driveReq_(method, path, payload), url = o.url;
  delete o.url;
  return UrlFetchApp.fetch(url, o);
}
function driveFail_(res, what) {
  var code = res.getResponseCode(), text = '';
  try { text = res.getContentText().slice(0, 300); } catch (e) {}
  if (code === 403 && /has not been used|is disabled|accessNotConfigured/i.test(text)) {
    return new Error('DRIVE_API_OFF: Apps Script 편집기 왼쪽 "서비스 +" 에서 Drive API 를 추가해 주세요.');
  }
  if (code === 403 && /storageQuotaExceeded|storage quota|quota has been exceeded/i.test(text)) {
    return new Error('DRIVE_FULL: 제출물을 쌓는 Drive 의 저장 공간이 가득 찼습니다.');
  }
  return new Error('DRIVE_ERROR: ' + what + ' ' + code + ' ' + text);
}

/** 새 파일이 가질 ID 를 미리 받는다. 올리기가 끝난 뒤 이 ID 로 파일을 확인한다. */
function driveNewId_() {
  var res = driveFetch_('get', '/drive/v3/files/generateIds?count=1&space=drive');
  if (res.getResponseCode() !== 200) throw driveFail_(res, 'generateIds');
  return JSON.parse(res.getContentText()).ids[0];
}

/**
 * 이어 올리기 주소를 만든다. 이 주소는 그 파일 하나를 올리는 데만 쓸 수 있다.
 * origin 을 주면 그 출처의 브라우저가 이 주소로 직접 PUT 할 수 있다 (Drive 가 CORS 를 그 출처에 열어 준다).
 * { url, direct } 를 돌려준다.
 */
function driveSession_(meta, mime, size, origin) {
  var make = function (withOrigin) {
    var headers = {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size)
    };
    if (withOrigin) headers.Origin = origin;
    return UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify(meta),
      headers: headers, muteHttpExceptions: true
    });
  };
  var res = null, direct = false;
  if (origin) {
    try { res = make(true); direct = true; } catch (e) { res = null; }     // Origin 머리글을 못 붙이는 환경이면 없이 다시
  }
  if (!res) res = make(false);
  if (res.getResponseCode() !== 200) throw driveFail_(res, 'session');
  var loc = header_(res, 'Location');
  if (!loc) throw new Error('DRIVE_ERROR: no session location');
  return { url: loc, direct: direct };
}

function driveMeta_(id) {
  var res = driveFetch_('get', '/drive/v3/files/' + encodeURIComponent(id) +
    '?supportsAllDrives=true&fields=id,name,size,md5Checksum,mimeType,parents,trashed');
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw driveFail_(res, 'get');
  return JSON.parse(res.getContentText());
}
function driveTrash_(id) {
  try { driveFetch_('patch', '/drive/v3/files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=id', { trashed: true }); } catch (e) {}
}

function header_(res, name) {
  var h = res.getHeaders() || {}, want = name.toLowerCase(), out = '';
  Object.keys(h).forEach(function (k) { if (k.toLowerCase() === want) out = String(h[k]); });
  return out;
}
function sessionReply_(res, total) {
  var code = res.getResponseCode();
  if (code === 200 || code === 201) return { ok: true, done: true, next: total };
  if (code === 308) {
    var m = /bytes=0-(\d+)/.exec(header_(res, 'Range'));
    return { ok: true, done: false, next: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 404 || code === 410) return fail_('SESSION_GONE');
  return fail_('DRIVE_ERROR', { code: code });
}
function ticket_(id) {
  id = Number(id);
  return id > 0 ? cacheGet_('tk1:' + id) : null;
}

/** 허용한 출처면 그대로, 아니면 '' (그러면 중계 방식으로만 올라간다) */
function origin_(o) {
  o = String(o || '').replace(/\/+$/, '');
  return (CONFIG.ORIGINS || []).indexOf(o) !== -1 ? o : '';
}

/** 팀 폴더와 그 안의 '옛날 자료' 폴더 ID. 없으면 만든다. ID 는 스크립트 속성에 기억한다. */
function folders_(no) {
  var p = props_();
  if (p['F_' + no] && p['O_' + no]) return { team: p['F_' + no], old: p['O_' + no] };
  return withLock_(function () {
    propsDrop_();                       // 그 사이에 다른 실행이 만들었을 수 있다 — 캐시가 아니라 지금 값을 본다
    p = props_();
    var f = p['F_' + no], o = p['O_' + no];
    if (!f) f = childFolder_(rootFolder_(), 'team' + no).getId();
    if (!o) o = childFolder_(DriveApp.getFolderById(f), OLD_NAME).getId();
    var set = {};
    set['F_' + no] = f; set['O_' + no] = o;
    PropertiesService.getScriptProperties().setProperties(set, false);
    propsDrop_();
    return { team: f, old: o };
  });
}
function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name), first = null;
  while (it.hasNext()) {                                       // 휴지통에 든 것은 빼고, 여럿이면 가장 먼저 만든 것
    var f = it.next();
    if (!f.isTrashed() && (!first || f.getDateCreated().getTime() < first.getDateCreated().getTime())) first = f;
  }
  return first || parent.createFolder(name);
}
function rootFolder_() {
  var id = conf_('ROOT_FOLDER_ID') || props_().ROOT_AUTO;
  if (id) return DriveApp.getFolderById(id);
  var parents = DriveApp.getFileById(ss_().getId()).getParents();
  if (!parents.hasNext()) throw new Error('제출 폴더를 찾지 못했습니다. 스크립트 속성 ROOT_FOLDER_ID 에 폴더 ID 를 넣어 주세요.');
  var f = parents.next();
  PropertiesService.getScriptProperties().setProperty('ROOT_AUTO', f.getId());
  propsDrop_();
  return f;
}

/* ================================================================
   작은 도구들
   ================================================================ */

/**
 * 스크립트 속성. 요청마다 읽으면 하루 읽기 한도(개인 계정 5만 번)에 닿을 수 있어서 — 열어 둔 화면들이
 * 1분에 한 번씩 새로 읽는다 — 캐시에 1분 동안 둔다. 그래서 속성을 고치면 늦어도 1분 뒤에 반영된다.
 */
function props_() {
  if (!MEMO.props) {
    var p = cacheGet_('props1');
    if (!p) {
      p = PropertiesService.getScriptProperties().getProperties() || {};
      cachePut_('props1', p, 60);
    }
    MEMO.props = p;
  }
  return MEMO.props;
}
/** 속성을 방금 고쳤거나, 꼭 지금 값이어야 할 때 */
function propsDrop_() { MEMO.props = null; cacheDrop_('props1'); }
/** 스크립트 속성에 있으면 그 값, 없으면 CONFIG. (마감 같은 값을 재배포 없이 바꾸려고) */
function conf_(k) {
  var p = props_();
  return (p[k] !== undefined && p[k] !== null && String(p[k]) !== '') ? p[k] : CONFIG[k];
}

function cache_() {
  if (MEMO.cache === undefined) { try { MEMO.cache = CacheService.getScriptCache(); } catch (e) { MEMO.cache = null; } }
  return MEMO.cache;
}
function cacheGet_(k) {
  var c = cache_();
  if (!c) return null;
  try { var s = c.get(k); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function cachePut_(k, v, ttl) {
  var c = cache_();
  if (!c) return;
  try { var s = JSON.stringify(v); if (s.length < 95000) c.put(k, s, ttl); } catch (e) {}
}
function cacheDrop_(k) { var c = cache_(); if (c) { try { c.remove(k); } catch (e) {} } }

/** 같은 일을 너무 자주 하지 못하게. windowSec 동안 limit 번까지. */
function hit_(key, limit, windowSec) {
  var c = cache_();
  if (!c) return true;
  try {
    var k = 'rl:' + key, n = Number(c.get(k)) || 0;
    if (n >= limit) return false;
    c.put(k, String(n + 1), windowSec);
  } catch (e) {}
  return true;
}

/** 쓰기는 한 번에 하나씩. 20초 안에 차례가 안 오면 BUSY — 화면이 잠깐 뒤 다시 보낸다. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('BUSY');
  try { return fn(); } finally { try { lock.releaseLock(); } catch (e) {} }
}

/** 같은 요청이 두 번 와도 한 번만 처리한다 (응답이 끊겨 화면이 다시 보냈을 때). */
function once_(a, nonce, fn) {
  if (!nonce) return fn();
  var key = 'once:' + a.sub + ':' + String(nonce).slice(0, 64);
  var prev = cacheGet_(key);
  if (prev) { prev.replay = true; return prev; }
  var res = fn();
  if (res && res.ok) cachePut_(key, res, 600);
  return res;
}

function fail_(error, extra) {
  var o = { ok: false, error: error };
  if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/** 사용자 글자를 다듬는다: 제어 문자 제거, 길이 제한. multi 가 아니면 줄바꿈도 빈칸으로. */
function clean_(v, max, multi) {
  var s = String(v === null || v === undefined ? '' : v).replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, '');
  s = multi ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

/** 셀에 넣기 전: 앞의 '=' 를 걷어낸다. (텍스트 서식도 같이 걸지만 두 겹으로 막는다) */
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'O' : '';
  return String(v).replace(/^[=\s]+/, function (m) { return m.replace(/=/g, ''); });
}

/**
 * 주소 검사. http · https 만 받는다. 스킴 없이 적으면 https 로 본다.
 * 빈 값은 '' (지우기), 잘못된 값은 null.
 */
function url_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';
  if (s.length > 500 || /[\s<>"`\\^{|}\u0000-\u001F\u007F]/.test(s)) return null;
  // 스킴이 없으면 붙인다. 'host:8080/…' 의 'host:' 는 스킴이 아니다. 숫자 IP 는 보통 인증서가 없으니 http 로 본다.
  if (!/^[a-z][a-z0-9+.\-]*:/i.test(s) || /^[a-z0-9.\-]+:\d+(\/|$)/i.test(s)) {
    s = (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s) ? 'http://' : 'https://') + s;
  }
  var m = /^https?:\/\/([^\/?#]+)([\/?#].*)?$/i.exec(s);
  if (!m) return null;
  var host = m[1];
  if (host.indexOf('@') !== -1) return null;                      // user:pass@host — 다른 곳으로 속일 수 있다
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.\-]*[a-z0-9])?)(:\d{1,5})?$/i.test(host)) return null;
  return s;
}

/** 올린 파일의 원래 이름: 경로를 떼고 제어 문자를 지운다. 시트에 참고로만 남는다. */
function fileName_(v) {
  var s = clean_(v, 300, false).replace(/^.*[\/\\]/, '');
  return s.slice(-120);
}
function ext_(name) {
  var m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

function rand_(n) {
  return Utilities.getUuid().replace(/-/g, '').slice(0, n);
}
/** 남이 맞힐 수 없는 43글자 (세션 값 · 열람 토큰에 쓴다) */
function secret_() {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  return Utilities.base64EncodeWebSafe(raw).replace(/[=]+$/, '');
}
function sha256hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s)).map(function (b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
