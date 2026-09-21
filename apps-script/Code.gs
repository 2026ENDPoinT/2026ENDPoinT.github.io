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
 */

var CONFIG = {
  // 응답을 쌓을 스프레드시트 ID
  // https://docs.google.com/spreadsheets/d/[여기가 ID]/edit
  SHEET_ID: '',

  // 기록할 탭 이름. 구글 폼 응답 탭에 직접 쓰면 폼 제출과 충돌하므로 별도 탭 권장
  SHEET_NAME: '웹신청',

  // OAuth 2.0 클라이언트 ID (....apps.googleusercontent.com)
  // 사이트에서 보낸 로그인 토큰이 정말 우리 사이트에서 발급된 것인지 검증하는 데 쓴다
  CLIENT_ID: '',

  // 특정 도메인 계정만 허용하려면 입력 (예: 'seoultech.ac.kr')
  // 빈 문자열이면 모든 구글 계정 허용
  ALLOWED_DOMAIN: '',

  // true  : 같은 이메일이 다시 제출하면 기존 행을 덮어쓴다 (수정 제출)
  // false : 제출할 때마다 새 행이 쌓인다
  UPDATE_IF_EXISTS: true
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

/** 최초 1회 실행: 탭과 헤더 행을 만들고 권한을 승인한다. */
function setup() {
  var sh = getSheet_();
  Logger.log('준비 완료: ' + sh.getName() + ' (' + sh.getLastRow() + '행)');
}

/**
 * 배포 상태 확인용. 브라우저로 /exec 주소를 열면 이게 보인다.
 * api 는 이 스크립트가 어떤 기능까지 아는지 알리는 표시다.
 * 신청서 화면은 이 값을 먼저 확인하고, 2 이상일 때만 기존 신청 조회를 요청한다.
 * (옛 버전이 조회 요청을 '빈 제출'로 잘못 처리해 기존 답변을 지우는 것을 막는다)
 */
function doGet() {
  return json_({ ok: true, service: 'ENDPoinT apply endpoint', api: 2 });
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

    // 1-2) 조회 요청이면 기존 신청 내용을 돌려주고 끝낸다
    if (body.action === 'me') {
      return json_(findMine_(claims));
    }

    // 2) 신청 값 정리 (이메일은 폼 입력이 아니라 토큰에서 가져온다)
    var answers = body.answers || {};
    answers['제출시각'] = new Date();
    answers['이메일'] = claims.email;
    answers['계정 식별자'] = claims.sub;

    // 3) 동시 제출로 행이 겹치지 않도록 잠금
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sh = getSheet_();
      var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      var row = headers.map(function (h) { return toCell_(answers[h]); });

      var target = CONFIG.UPDATE_IF_EXISTS ? findRowByAccount_(sh, headers, claims) : 0;
      if (target > 0) {
        sh.getRange(target, 1, 1, row.length).setValues([row]);
      } else {
        sh.appendRow(row);
        target = sh.getLastRow();
      }
      SpreadsheetApp.flush();
      return json_({ ok: true, row: target, updated: CONFIG.UPDATE_IF_EXISTS && target > 0 });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ------------------------------ 내부 함수 ------------------------------ */

/** 구글이 발급한 ID 토큰을 구글 서버에 직접 물어서 검증한다. */
function verifyIdToken_(idToken) {
  if (!idToken) return null;

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
  return p;
}

/** 대상 탭을 가져오고, 없으면 헤더까지 만들어 준다. */
function getSheet_() {
  if (!CONFIG.SHEET_ID) throw new Error('CONFIG.SHEET_ID 가 비어 있습니다');
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sh;
}

/**
 * 이미 제출한 사람이면 그 행 번호를, 없으면 0 을 돌려준다.
 * 계정 식별자를 먼저 보고, 없으면 이메일로 찾는다.
 * (식별자는 구글 계정마다 고정이라, 이메일 주소가 바뀌어도 같은 사람으로 인식한다)
 */
function findRowByAccount_(sh, headers, claims) {
  if (sh.getLastRow() < 2) return 0;
  var n = sh.getLastRow() - 1;

  function findIn(name, want) {
    var col = headers.indexOf(name) + 1;
    if (col < 1 || !want) return 0;
    var values = sh.getRange(2, col, n, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0]).toLowerCase() === String(want).toLowerCase()) return i + 2;
    }
    return 0;
  }

  return findIn('계정 식별자', claims.sub) || findIn('이메일', claims.email);
}

/**
 * 이 계정이 낸 신청서를 돌려준다. 신청서 화면에서 기존 내용을 불러와 보여주고
 * 수정할 수 있게 하는 데 쓴다.
 * 계정 식별자는 화면에 쓸 일이 없으므로 돌려주지 않는다.
 */
function findMine_(claims) {
  var sh = getSheet_();
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = findRowByAccount_(sh, headers, claims);
  if (!row) return { ok: true, found: false };

  var values = sh.getRange(row, 1, 1, headers.length).getValues()[0];
  var answers = {};
  headers.forEach(function (h, i) {
    if (h === '계정 식별자') return;
    var v = values[i];
    answers[h] = (v instanceof Date) ? v.toISOString() : v;
  });
  return { ok: true, found: true, row: row, answers: answers };
}

/** 배열·객체를 시트 셀에 들어갈 문자열로 편다. */
function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'O' : '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
