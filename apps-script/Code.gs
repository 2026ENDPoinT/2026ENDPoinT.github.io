/**
 * ENDPoinT 참가 신청 수신 엔드포인트 (Google Apps Script 웹 앱)
 * ---------------------------------------------------------------
 * 사이트(index.html)에서 구글 로그인 후 제출한 신청서를
 * 지정한 구글 스프레드시트 탭에 한 행씩 기록한다.
 *
 * [배포 방법]
 *  1. 응답을 쌓을 스프레드시트를 연다 → 확장 프로그램 → Apps Script
 *  2. 이 파일 전체를 Code.gs 에 붙여넣는다
 *  3. 아래 CONFIG 값을 채운다
 *  4. 함수 목록에서 setup 을 한 번 실행한다 (탭/헤더 자동 생성 + 권한 승인)
 *  5. 배포 → 새 배포 → 유형: 웹 앱
 *       - 실행 계정: 나
 *       - 액세스 권한: 모든 사용자
 *  6. 발급되는 https://script.google.com/macros/s/..../exec 주소를
 *     index.html 의 APPLY_ENDPOINT 에 넣는다
 *
 * [주의] 코드를 고칠 때마다 "배포 관리 → 편집 → 버전: 새 버전"으로
 *        다시 배포해야 반영된다. URL 은 그대로 유지된다.
 *
 * [속도] Apps Script 에서 느린 것은 자바스크립트가 아니라 시트를 오가는 횟수다.
 *        openById 한 번, getValues 한 번이 각각 수백 ms 다. 그래서 이 파일은
 *        한 번의 요청 안에서 스프레드시트를 한 번만 열고, 각 탭을 한 번만 읽어
 *        MEMO 에 담아 두고 돌려 쓴다. 쓰기 뒤에도 시트를 다시 읽지 않고
 *        MEMO 를 직접 고친다. (그 전에는 글 하나 올릴 때 시트를 5번 읽었다)
 */

var CONFIG = {
  // 응답을 쌓을 스프레드시트 ID
  // https://docs.google.com/spreadsheets/d/[여기가 ID]/edit
  SHEET_ID: '1OuBWYahA6O3JIpN3ITZdqsH8wB64_Tb1diamCjOq97U',

  // 기록할 탭 이름. 구글 폼 응답 탭에 직접 쓰면 폼 제출과 충돌하므로 별도 탭 권장
  SHEET_NAME: '웹신청',

  // OAuth 2.0 클라이언트 ID (....apps.googleusercontent.com)
  // 사이트에서 보낸 로그인 토큰이 정말 우리 사이트에서 발급된 것인지 검증하는 데 쓴다
  CLIENT_ID: '100824066944-7s6di7cbhsedtnms675fka8bbbka3u7p.apps.googleusercontent.com',

  // 특정 도메인 계정만 허용하려면 입력 (예: 'seoultech.ac.kr')
  // 빈 문자열이면 모든 구글 계정 허용
  ALLOWED_DOMAIN: '',

  // true  : 같은 이메일이 다시 제출하면 기존 행을 덮어쓴다 (수정 제출)
  // false : 제출할 때마다 새 행이 쌓인다
  UPDATE_IF_EXISTS: true,

  // 팀 모집 게시판을 저장할 탭 (Board.gs). 없으면 자동 생성
  BOARD_SHEET: '게시판'
};

/**
 * 시트 헤더(= 열 순서).
 * 사이트가 보내는 JSON 의 key 와 이름이 같아야 그 열에 들어간다.
 * 순서를 바꾸거나 열을 추가해도 이름만 맞으면 코드 수정 없이 동작한다.
 */
var HEADERS = [
  '제출시각',
  '이메일',
  '성함',
  '학번',
  '학년',
  '연락처',
  '소속동아리',
  '희망역할',
  '기술스택 및 개발 경험',
  '팀 보유 여부 및 팀원',
  '전체 일정 참석 가능여부',
  '기타',
  '계정 식별자'
];

/** 이 스크립트가 아는 기능의 세대. 사이트가 doGet 으로 먼저 확인한다. */
var API_VERSION = 5;

/**
 * 한 번의 요청이 끝날 때까지만 사는 메모.
 * 실행마다 새로 만들어지므로 사용자 사이에 값이 섞이지 않는다.
 */
var MEMO = { ss: null, sheet: null, apply: null, mine: {} };

/** 최초 1회 실행: 탭과 헤더 행을 만들고 권한을 승인한다. */
function setup() {
  var sh = getSheet_();
  Logger.log('준비 완료: ' + sh.getName() + ' (' + sh.getLastRow() + '행)');
}

/**
 * 배포 상태 확인용. 브라우저로 /exec 주소를 열면 이게 보인다.
 * api 는 이 스크립트가 어떤 기능까지 아는지 알리는 표시다.
 * 신청서 화면은 2 이상일 때 기존 신청 조회를, 게시판은 3 이상일 때 게시판 API 를,
 * 5 이상일 때 한 번에 다 받아오는 init 을 쓴다.
 * (옛 버전이 조회 요청을 '빈 제출'로 잘못 처리해 기존 답변을 지우는 것을 막는다)
 */
function doGet() {
  return json_({ ok: true, service: 'ENDPoinT apply endpoint', api: API_VERSION });
}

/** 사이트에서 오는 신청서 수신 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // 1) 구글 로그인 토큰 검증 — 이메일 위조를 막는 핵심 단계
    var claims = verifyIdToken_(body.idToken);
    if (!claims) {
      return json_({ ok: false, error: 'AUTH_FAILED' });
    }

    // 1-1) 로그인 직후 첫 요청. 신청 내역과 게시판 목록을 한 번에 돌려준다.
    //      화면마다 따로 묻던 것을 합친 것이다. Apps Script 는 같은 사용자의 요청을
    //      줄 세워 처리하므로, 요청 두 개가 하나가 되면 기다리는 시간도 통째로 사라진다.
    //      두 탭 모두 이 실행 안에서 한 번씩만 읽히므로 실제 비용은 조회 하나와 비슷하다.
    if (body.action === 'init') {
      return json_({
        ok: true,
        api: API_VERSION,
        me: findMine_(claims),
        board: board_('list', claims, body)
      });
    }

    // 1-2) 조회 요청이면 기존 신청 내용을 돌려주고 끝낸다
    if (body.action === 'me') {
      return json_(findMine_(claims));
    }

    // 1-3) 팀 모집 게시판 (Board.gs)
    if (body.action && String(body.action).indexOf('board.') === 0) {
      return json_(board_(String(body.action).slice(6), claims, body));
    }

    // 1-4) 그 밖의 action 은 거부한다. (신청서 제출은 action 없이 오거나 'submit')
    if (body.action && body.action !== 'submit') {
      return json_({ ok: false, error: 'UNKNOWN_ACTION' });
    }

    // 2) 동시 제출로 행이 겹치지 않도록 잠금
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      // 화면이 응답을 못 받아 같은 내용을 다시 보내도 한 번만 처리한다
      return json_(once_(claims, body.nonce, function () {
        return submit_(claims, body.answers || {});
      }));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ------------------------------ 신청서 ------------------------------ */

/** 신청 값을 시트 한 행에 쓴다. 이메일은 폼 입력이 아니라 토큰에서 가져온다. */
function submit_(claims, answers) {
  answers['제출시각'] = new Date();
  answers['이메일'] = claims.email;
  answers['계정 식별자'] = claims.sub;

  var d = applyData_();
  var row = d.headers.map(function (h) { return toCell_(answers[h]); });

  var target = CONFIG.UPDATE_IF_EXISTS ? findRowByAccount_(d, claims) : 0;
  var isNew = !(target > 0);
  if (isNew) target = d.lastRow + 1;

  var range = d.sheet.getRange(target, 1, 1, row.length);
  // 셀 서식을 한 번에 건다. '=' 로 시작하는 입력이 수식으로 해석되지 않도록 전부
  // 텍스트(@)로 고정하고, 제출시각 칸만 날짜로 둔다. 계정 식별자(21자리 숫자)가
  // 숫자로 바뀌어 정밀도를 잃는 것도 이걸로 막는다.
  // (예전에는 서식을 두 번 나눠 걸어서 시트를 한 번 더 오갔다)
  range.setNumberFormats([d.headers.map(function (h) {
    return h === '제출시각' ? 'yyyy-mm-dd hh:mm:ss' : '@';
  })]);
  range.setValues([row]);
  SpreadsheetApp.flush();

  // 이 실행 안에서 뒤이어 신청 내역을 읽는 곳(게시판의 이름 조회 등)이
  // 방금 쓴 값을 보도록 메모도 같이 고친다. 시트를 다시 읽지 않기 위해서다.
  if (isNew) { d.values.push(row); d.lastRow = target; }
  else { d.values[target - 2] = row; }
  MEMO.mine = {};

  return { ok: true, row: target, updated: !isNew };
}

/* ------------------------------ 내부 함수 ------------------------------ */

/**
 * 같은 요청이 두 번 와도 한 번만 처리한다.
 * 화면은 응답이 끊기면 같은 nonce 로 한 번 더 보낸다. 그때 이미 처리한 결과를
 * 그대로 돌려주어, 글이 두 개 생기거나 "이미 있습니다" 라는 엉뚱한 오류가 뜨는 것을 막는다.
 */
function once_(claims, nonce, fn) {
  if (!nonce) return fn();

  var cache = null, key = null;
  try {
    cache = CacheService.getScriptCache();
    key = 'once:' + String(claims.sub) + ':' + String(nonce).slice(0, 64);
    var hit = cache.get(key);
    if (hit) {
      var prev = JSON.parse(hit);
      prev.replay = true;          // 화면이 "다시 보낸 것이 먹혔다"고 알 수 있게
      return prev;
    }
  } catch (e) { cache = null; }

  var res = fn();
  // 성공만 담는다. 실패는 다시 눌렀을 때 진짜로 다시 시도되어야 한다.
  if (cache && res && res.ok) {
    try { cache.put(key, JSON.stringify(res), 600); } catch (e2) {}
  }
  return res;
}

/** 구글이 발급한 ID 토큰을 구글 서버에 직접 물어서 검증한다. */
function verifyIdToken_(idToken) {
  if (!idToken) return null;

  // 같은 토큰을 다시 받으면 구글에 또 묻지 않는다.
  // 요청마다 붙던 0.3~0.6초의 왕복이 사라진다. 검증을 통과한 토큰만 담고,
  // 열쇠는 토큰 자체의 해시라 그 토큰을 가진 쪽만 꺼낼 수 있다.
  var cache = null, key = null;
  try {
    cache = CacheService.getScriptCache();
    key = 'tok:' + Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }

  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) return null;

  var p = JSON.parse(res.getContentText());

  // 우리 사이트용 토큰이 맞는가
  if (!CONFIG.CLIENT_ID || p.aud !== CONFIG.CLIENT_ID) return null;
  // 발급자가 구글이 맞는가
  if (p.iss !== 'accounts.google.com' && p.iss !== 'https://accounts.google.com') return null;
  // 인증된 이메일인가
  if (String(p.email_verified) !== 'true' || !p.email) return null;
  // 도메인 제한이 걸려 있으면 확인
  if (CONFIG.ALLOWED_DOMAIN) {
    var suffix = '@' + CONFIG.ALLOWED_DOMAIN.toLowerCase();
    if (String(p.email).toLowerCase().slice(-suffix.length) !== suffix) return null;
  }

  // 검증을 다 통과한 뒤에만 담는다. 토큰의 남은 수명과 5분 중 짧은 쪽까지만 산다.
  if (cache) {
    var left = Math.floor(Number(p.exp) - Date.now() / 1000) - 30;
    if (left > 0) { try { cache.put(key, JSON.stringify(p), Math.min(left, 300)); } catch (e2) {} }
  }
  return p;
}

/** 스프레드시트는 한 번만 연다. openById 는 한 번에 수백 ms 가 든다. */
function ss_() {
  if (!CONFIG.SHEET_ID) throw new Error('CONFIG.SHEET_ID 가 비어 있습니다');
  if (!MEMO.ss) MEMO.ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  return MEMO.ss;
}

/** 대상 탭을 가져오고, 없으면 헤더까지 만들어 준다. */
function getSheet_() {
  if (MEMO.sheet) return MEMO.sheet;
  var ss = ss_();
  var sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return (MEMO.sheet = sh);
}

/**
 * 신청 탭을 통째로 한 번만 읽어 둔다.
 * 예전에는 사람을 찾을 때 열 하나, 못 찾으면 또 한 열, 내용을 읽을 때 또 한 행 —
 * 이렇게 세 번 오갔다. 지금은 한 번 읽어 놓고 자바스크립트로 뒤진다.
 */
function applyData_() {
  if (MEMO.apply) return MEMO.apply;
  var sh = getSheet_();
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  return (MEMO.apply = { sheet: sh, headers: headers, values: values, lastRow: lastRow });
}

/**
 * 이미 제출한 사람이면 그 행 번호를, 없으면 0 을 돌려준다.
 * 계정 식별자를 먼저 보고, 없으면 이메일로 찾는다.
 * (식별자는 구글 계정마다 고정이라, 이메일 주소가 바뀌어도 같은 사람으로 인식한다)
 */
function findRowByAccount_(d, claims) {
  var subCol = d.headers.indexOf('계정 식별자');
  var mailCol = d.headers.indexOf('이메일');
  var sub = String(claims.sub || '').toLowerCase();
  var mail = String(claims.email || '').toLowerCase();
  var byMail = 0;

  for (var i = 0; i < d.values.length; i++) {
    if (subCol > -1 && sub && String(d.values[i][subCol]).toLowerCase() === sub) return i + 2;
    if (!byMail && mailCol > -1 && mail && String(d.values[i][mailCol]).toLowerCase() === mail) byMail = i + 2;
  }
  return byMail;
}

/**
 * 이 계정이 낸 신청서를 돌려준다. 신청서 화면에서 기존 내용을 불러와 보여주고
 * 수정할 수 있게 하는 데 쓴다.
 * 계정 식별자는 화면에 쓸 일이 없으므로 돌려주지 않는다.
 */
function findMine_(claims) {
  // 한 번의 실행 안에서 같은 사람을 두 번 찾지 않는다.
  // (init 은 신청 내역과 게시판 요약에서 각각 한 번씩 부른다)
  var memoKey = String(claims.sub || claims.email || '');
  if (MEMO.mine[memoKey]) return MEMO.mine[memoKey];

  var d = applyData_();
  var row = findRowByAccount_(d, claims);
  if (!row) return (MEMO.mine[memoKey] = { ok: true, found: false });

  var values = d.values[row - 2] || [];
  var answers = {};
  d.headers.forEach(function (h, i) {
    if (h === '계정 식별자') return;
    var v = values[i];
    answers[h] = (v instanceof Date) ? v.toISOString() : v;
  });
  return (MEMO.mine[memoKey] = { ok: true, found: true, row: row, answers: answers });
}

/**
 * 사용자 문자열을 셀에 넣기 전에 다듬는다.
 * '=' 로 시작하면 시트가 수식으로 해석할 수 있으므로 앞의 '=' 를 걷어낸다.
 * (쓸 때 텍스트 서식도 같이 걸지만, 두 겹으로 막는다)
 */
function safeText_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/^[=\s]+/, function (m) { return m.replace(/=/g, ''); });
}

/** 배열·객체를 시트 셀에 들어갈 문자열로 편다. */
function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return safeText_(v.map(function (x) { return safeText_(x); }).join(', '));
  if (typeof v === 'boolean') return v ? 'O' : '';
  if (typeof v === 'object') return safeText_(JSON.stringify(v));
  if (typeof v === 'number') return v;
  return safeText_(v);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
