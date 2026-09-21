# 백엔드 연동 가이드

> 2026년 9월 22일 갱신. 구글 콘솔 화면이 2025년에 크게 바뀌어서, 이 문서는 **바뀐 화면 기준**으로 썼습니다.
> 예전 `apps-script/README.md`의 메뉴 경로는 지금 존재하지 않습니다.

---

## 0. 지금 어디까지 돼 있나

| | 상태 | 확인 |
|---|---|---|
| 신청서 화면 (01~07) | 완료 | 실제 구글 폼 질문과 1:1 |
| 제출 → 시트 기록 코드 | 완료 | `apps-script/Code.gs` |
| 개인정보처리방침 · 이용약관 | 완료 | 일부 빈칸만 남음 (9절) |
| 1단계 · 구글 OAuth 설정 | **완료** | `2026endpoint.github.io` 원본 허용 확인 |
| 2단계 · Apps Script 배포 | **완료** | `/exec` 응답 · 토큰 검증 동작 확인 |
| 3단계 · 프론트에 값 넣기 | **로컬만** | 커밋·푸시해야 실제 사이트에 반영 |
| 기존 신청 조회·수정 | **완료** | 5절 — `Code.gs` 재배포 필요 |
| 4단계 · 팀 모집 게시판 | 가짜 데이터 | 6절 |

> ⚠️ **배포 순서**: `Code.gs`를 먼저 재배포하고, 그다음 사이트를 푸시하세요.
> 순서가 바뀌어도 데이터는 안전합니다 — 신청서 화면이 `doGet`의 `api` 값을 먼저 확인해서,
> 옛 버전이면 조회를 아예 요청하지 않습니다. 다만 그동안은 조회·수정 기능이 동작하지 않습니다.

**지금 상태**: 로컬에서는 구글 로그인 버튼까지 뜹니다. 하지만 **배포된 사이트는 아직 미리보기 모드**입니다 — `CFG` 값이 커밋되지 않아서입니다. `index.html`을 커밋·푸시하면 바로 실제 모드로 바뀝니다.

**남은 시간**: 1차 모집 시작이 10월 5일이니 **약 2주**입니다.

---

## 1. 전체 그림

서버를 따로 두지 않습니다. GitHub Pages는 파일만 내보내는 정적 호스팅이라 비밀값을 숨길 데가 없기 때문입니다. 대신 **구글 시트에 붙은 Apps Script**가 백엔드 역할을 합니다.

```
브라우저                                    구글
──────────────────────────────────────────────────────────────
① 구글 로그인 (GIS)  ─────────────────▶  ID 토큰(JWT) 발급
                     ◀─────────────────
② 01~07 작성
③ fetch POST ────────────────────────▶  Apps Script 웹 앱
   { idToken, answers }                   ├ 토큰을 구글에 다시 물어 검증
                                          ├ 이메일을 토큰에서 꺼냄 (위조 불가)
                                          └ 스프레드시트에 행 추가
④ { ok:true } ◀───────────────────────
⑤ 운영진이 시트 → 엑셀
```

**핵심 두 가지**

- **비밀값이 사이트에 안 박힙니다.** 클라이언트 ID는 공개돼도 되는 값입니다. 시트를 건드릴 권한은 Apps Script 소유자(운영진 계정)에게만 있습니다.
- **이메일을 신뢰할 수 있습니다.** 사용자가 입력한 이메일이 아니라, 구글이 서명한 토큰에서 꺼내 씁니다. 남의 이름으로 제출할 수 없습니다.

---

## 2. 1단계 — 구글 OAuth 클라이언트 만들기 (약 15분)

[console.cloud.google.com](https://console.cloud.google.com) 접속.

> **예전 문서와 달라진 점**
> `API 및 서비스 → OAuth 동의 화면` 메뉴는 **없어졌습니다.** 지금은 `Google Auth 플랫폼`(Google Auth Platform) 아래 **브랜딩 / 대상 / 데이터 액세스 / 클라이언트** 네 탭으로 쪼개져 있습니다. 예전 안내를 보고 메뉴를 못 찾은 게 정상입니다.

### 2-1. 프로젝트 만들기

상단 프로젝트 선택 → `새 프로젝트` → 이름 아무거나 (예: `endpoint-2026`) → 만들기.

### 2-2. 브랜딩 (Branding)

`Google Auth 플랫폼` → `브랜딩`. 처음이면 **시작하기** 마법사가 뜹니다. 한 페이지에서 네 단계를 훑는 형태입니다.

| 항목 | 넣을 값 |
|---|---|
| 앱 이름 | `ENDPoinT` |
| 사용자 지원 이메일 | 운영진이 실제로 확인하는 주소 |
| 앱 로고 | 선택. **넣지 않는 걸 권합니다** (아래 설명) |
| 애플리케이션 홈페이지 | `https://2026endpoint.github.io/` |
| 개인정보처리방침 링크 | `https://2026endpoint.github.io/privacy/` |
| 서비스 약관 링크 | `https://2026endpoint.github.io/terms/` |
| 승인된 도메인 | `2026endpoint.github.io` |
| 개발자 연락처 | 운영진 이메일 |

> **순서 주의**: 승인된 도메인을 **먼저** 등록해야 홈페이지·처리방침 URL을 받아줍니다. 순서가 바뀌면 "등록되지 않은 도메인"이라며 거부합니다.

> **로고를 넣지 말라는 이유**: 로고를 등록하면 구글이 **브랜드 확인(brand verification)** 을 요구할 수 있고, 그러면 Search Console에서 도메인 소유 확인을 해야 합니다. 로고 없이도 로그인은 정상 동작합니다. 나중에 여유 있을 때 붙이세요.

### 2-3. 대상 (Audience)

- 사용자 유형: **외부(External)**
- 게시 상태: **`앱 게시`**(Publish app) 버튼을 눌러 `테스트` → `프로덕션`(In production)으로 전환
  - 버튼 이름이 `프로덕션으로 푸시`로 보일 수도 있습니다. 상태 표시가 **프로덕션**이면 된 겁니다.

> **왜 꼭 프로덕션인가**: `테스트` 상태로 두면 **미리 등록한 테스트 사용자 100명만** 로그인됩니다. 신청자가 로그인하려다 막힙니다.

> **심사 받아야 하나요? — 아니요.** 우리가 쓰는 범위는 `openid`, `email`, `profile` 뿐이고 이건 **민감하지 않은 범위(non-sensitive)** 로 분류됩니다. 민감·제한 범위를 쓸 때만 확인 절차가 필요합니다. 그냥 프로덕션으로 전환하면 됩니다.

### 2-4. 데이터 액세스 (Data Access)

범위는 **건드리지 마세요.** 구글 로그인 기본 범위가 이미 들어 있습니다. 여기서 범위를 추가하면 심사 대상이 될 수 있습니다.

### 2-5. 클라이언트 (Clients)

`클라이언트` → `클라이언트 만들기`

- 애플리케이션 유형: **웹 애플리케이션**
- 이름: 아무거나 (예: `endpoint-web`)
- **승인된 JavaScript 원본** — 배포 주소와, 로컬에서 띄우는 주소를 **모두** 넣습니다.
  2026-09-22 확인 기준 현재 등록된 값:
  ```
  https://2026endpoint.github.io   ← 실제 서비스
  http://localhost:5173            ← Vite 기본 포트
  http://localhost:5501            ← Live Server (5500이 사용 중이면 여기로 올라감)
  http://127.0.0.1:3000
  ```

  > **호스트와 포트가 정확히 같아야 합니다.** 구글은 `localhost`와 `127.0.0.1`을 다른 원본으로 보고,
  > `:5500`과 `:5501`도 다른 원본입니다. 등록되지 않은 주소로 열면 버튼은 떠도 콘솔에
  > `The given origin is not allowed for the given client ID`가 찍히며 로그인이 안 됩니다.
  > **다른 포트를 쓰게 되면 그 주소를 여기에 추가**하세요. 반영에 몇 분 걸릴 수 있습니다.
- **승인된 리디렉션 URI**: 비워둡니다. ID 토큰 방식이라 필요 없습니다.

만들면 `...apps.googleusercontent.com` 형태의 **클라이언트 ID**가 나옵니다. **이 값을 복사해 두세요.** (같이 나오는 클라이언트 보안 비밀번호는 안 씁니다.)

> **Google Sheets API를 켜야 하나요? — 아니요.** Apps Script가 시트를 직접 다루므로 API 사용 설정이 필요 없습니다.

---

## 3. 2단계 — 시트와 Apps Script (약 15분)

### 3-1. 스프레드시트

응답을 쌓을 스프레드시트를 만들거나 엽니다. 주소에서 ID를 복사합니다.

```
https://docs.google.com/spreadsheets/d/⬛⬛⬛여기가 ID⬛⬛⬛/edit
```

`웹신청` 탭은 코드가 알아서 만듭니다. 미리 만들 필요 없습니다.

> **구글 폼 응답 탭에 직접 쓰지 않는 이유**: 폼이 응답을 넣을 때 행을 밀어내서 서로 엉킵니다. 별도 탭에 쌓고, 엑셀로 옮길 때 합치는 편이 안전합니다.

### 3-2. Apps Script 배포

1. 스프레드시트 → `확장 프로그램` → `Apps Script`
2. [apps-script/Code.gs](apps-script/Code.gs) 내용을 전부 붙여넣기
3. 맨 위 `CONFIG` 채우기
   ```js
   SHEET_ID : '3-1에서 복사한 시트 ID',
   CLIENT_ID: '2-5에서 복사한 클라이언트 ID',
   ```
4. 함수 선택창에서 `setup` 실행 → 권한 승인 팝업 허용 (한 번만)
5. `배포` → `새 배포` → 유형 **웹 앱**
   - 실행 계정: **나**
   - 액세스 권한: **모든 사용자**
6. 나오는 `https://script.google.com/macros/s/.../exec` 주소 복사

> **"모든 사용자"가 불안한데요?** URL이 공개돼도 안전합니다. 코드가 받은 ID 토큰을 구글 서버에 직접 조회해서 검증하고(`verifyIdToken_`), 우리 클라이언트 ID로 발급된 토큰이 아니면 거부합니다. 신청자는 Apps Script 동의 화면을 볼 일이 없습니다 — "실행 계정: 나"라서 스크립트는 운영진 권한으로 돌아갑니다.

> **코드를 고칠 때마다** `배포 관리` → 연필 아이콘 → 버전 **새 버전** → 배포. 이걸 안 하면 옛날 코드가 계속 돕니다. URL은 그대로 유지됩니다.

---

## 4. 3단계 — 프론트에 값 넣기 (1분)

[index.html](index.html) 아래쪽 `참가 신청 폼` 스크립트의 `CFG`를 채웁니다. (`Ctrl+F`로 `CLIENT_ID` 검색)

```js
var CFG = {
  CLIENT_ID: '....apps.googleusercontent.com',               // 2-5
  ENDPOINT:  'https://script.google.com/macros/s/.../exec',   // 3-2
  DRAFT_KEY: 'endpoint.apply.v2'
};
```

두 값이 채워지는 순간 미리보기 모드가 풀리고 **실제 구글 로그인 버튼**이 뜹니다. 코드에 이렇게 돼 있습니다.

```js
var DEV = !CFG.CLIENT_ID || !CFG.ENDPOINT;
```

### 확인하는 법

```bash
python -m http.server 5501
# http://localhost:5501/#/apply
```

VS Code의 Live Server를 써도 됩니다. **단, 열리는 주소가 2-5에 등록된 것과 같아야 합니다.**
Live Server는 5500이 이미 사용 중이면 조용히 **5501**로 올라가므로, 주소창을 한 번 확인하세요.

`file://`로 열면 구글 로그인이 **동작하지 않습니다.** 반드시 `http://`로 접속하세요.

본인 계정으로 한 번 제출해 보고 시트에 행이 생기는지 확인하면 끝입니다.

---

## 5. 현재 API 규격

### POST `/exec` — 신청서 제출 (구현 완료)

```
요청  Content-Type: text/plain;charset=utf-8
      { "idToken": "<구글 ID 토큰>", "answers": { "성함": "홍길동", ... } }

응답  { "ok": true,  "row": 5, "updated": false }
      { "ok": false, "error": "AUTH_FAILED" }
```

`answers`의 키는 **시트 헤더 이름과 같아야** 그 열에 들어갑니다. `HEADERS`에 없는 키는 조용히 버려집니다.

| 신청서 | 시트 열 |
|---|---|
| (서버가 기록) | 제출시각, 이메일, 계정 식별자 |
| 01 기본 정보 | 성함, 학번, 학년, 연락처 |
| 02 소속 동아리 | 소속동아리 |
| 03 희망 역할 | 희망역할 |
| 04 기술 스택 | 기술스택 및 개발 경험 |
| 05 팀 | 팀 보유 여부 및 팀원 |
| 06 참석 일정 | 전체 일정 참석 가능여부 |
| 07 기타 | 기타 |

항목을 바꾸려면 [index.html](index.html)의 `SCHEMA` 배열에 있는 `k` 값과 [Code.gs](apps-script/Code.gs)의 `HEADERS` 배열, **양쪽 이름을 맞추면** 됩니다. 열 순서는 자유입니다.

### POST `/exec` — 내 신청서 조회 (구현 완료)

로그인하면 신청서 화면이 이 요청을 먼저 보내, 이 계정이 이미 냈는지 확인합니다.

```
요청  { "action": "me", "idToken": "<구글 ID 토큰>" }

응답  { "ok": true, "found": true, "row": 5, "answers": { "성함": "홍길동", ... } }
      { "ok": true, "found": false }
```

- **찾는 기준**: `계정 식별자`(구글 계정 고유값)를 먼저 보고, 없으면 `이메일`로 찾습니다.
  식별자는 계정마다 고정이라 이메일 주소가 바뀌어도 같은 사람으로 인식합니다.
- `계정 식별자`는 화면에 쓸 일이 없어 응답에 담지 않습니다.
- 여러 개 고른 항목은 시트에 `NL, TCP` 처럼 한 칸에 합쳐져 있고, 화면이 이를 다시 쪼개 체크박스에 반영합니다.

화면은 이 결과에 따라 세 가지로 동작합니다.

| 상태 | 화면 |
|---|---|
| 신청 이력 없음 | 평소대로 빈 신청서 |
| 신청 이력 있음 | 시트 값으로 채워진 **읽기 전용** + `수정하기` 버튼 |
| 수정하기 누름 | 입력 가능 + `수정 내용 저장` · `취소` 버튼 |

저장은 제출과 같은 엔드포인트를 쓰며, 서버가 같은 행을 덮어씁니다. 새 행이 생기지 않습니다.

> **옛 버전 보호**: `doGet` 이 돌려주는 `api: 2` 를 먼저 확인합니다. 이 표시가 없는(재배포 전) 서버에는
> 조회를 요청하지 않습니다. 옛 `doPost` 는 `{action:'me'}` 를 **빈 제출**로 잘못 처리해
> 기존 답변을 지워버리기 때문입니다.

### 왜 `Content-Type`이 `text/plain`인가 — 중요

`application/json`으로 보내면 브라우저가 먼저 **preflight(OPTIONS) 요청**을 던집니다. Apps Script는 이 OPTIONS에 CORS 헤더를 붙여주지 못해서 **제출이 통째로 막힙니다.**

`text/plain`은 CORS 규격상 "단순 요청"이라 preflight가 없습니다. 그래서 바로 POST가 나가고, `/exec`가 `script.googleusercontent.com`으로 넘기는 응답에 `Access-Control-Allow-Origin: *`이 붙어 있어 결과 JSON까지 읽을 수 있습니다.

> **실제 배포본으로 검증했습니다** (2026-09-22). 브라우저에서 이 방식으로 POST하니 HTTP 200과
> `{"ok":false,"error":"AUTH_FAILED"}`를 정상적으로 **읽어왔고**, CORS 오류는 없었습니다.
> 가짜 토큰이 거부된 것이므로 토큰 검증도 살아 있습니다.

```js
headers: { 'Content-Type': 'text/plain;charset=utf-8' }   // 이 줄을 바꾸지 마세요
```

> Apps Script의 `ContentService`는 **응답 헤더를 직접 지정할 수 없습니다.** 인터넷에 도는 "doOptions에 CORS 헤더를 넣어라"는 해법은 이 제약 때문에 잘 동작하지 않습니다.
>
> 만약 배포 후 콘솔에 CORS 오류가 뜨면 → 응답 읽기를 포기하는 `mode:'no-cors'`로 바꾸면 전송 자체는 됩니다(성공 여부를 못 읽을 뿐). 그래도 안 되면 Cloudflare Workers 같은 곳으로 옮겨야 합니다.

---

## 6. 4단계 — 앞으로 만들 API (진짜 남은 작업)

팀 모집 게시판(`#/teams`)이 **아직 가짜 데이터**입니다. [index.html](index.html)의 `var POSTS = [...]` 에 12건이 박혀 있고, `지원하기`·`팀에 초대`·`팀원 모집글 쓰기` 버튼은 아무 동작도 하지 않습니다. `내 신청 상태` 패널도 고정 문구입니다.

이걸 실제 신청 데이터와 잇는 게 남은 백엔드 작업입니다. 엔드포인트 두 개면 됩니다.

### GET `?action=board` — 게시판 목록

```
요청  GET  https://script.google.com/macros/s/.../exec?action=board

응답  { "ok": true, "items": [
        { "kind":"person", "club":"NL", "title":"백엔드 · 2학년, 팀 찾습니다",
          "tags":["Spring","MySQL"], "meta":"전체 일정 참석 가능" }
      ] }
```

> **개인정보를 서버에서 걸러야 합니다.** [개인정보처리방침 04](privacy/)에 *"성함, 연락처, 이메일, 학번은 게시하지 않습니다"* 라고 이미 약속해 뒀습니다. 프론트에서 숨기는 게 아니라 **서버 응답에 아예 담지 않아야** 합니다.

`Code.gs`에 붙일 뼈대입니다. **기존 `doGet`(배포 확인용)을 이걸로 교체**하고 `board_`를 새로 추가하세요.
`getSheet_`, `json_`은 이미 있는 함수라 그대로 씁니다.

```js
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'board') return json_(board_());
  return json_({ ok: true, service: 'ENDPoinT apply endpoint' });
}

function board_() {
  var sh = getSheet_();
  if (sh.getLastRow() < 2) return { ok: true, items: [] };
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues();
  var col = function (r, name) { return r[headers.indexOf(name)]; };

  var items = rows.map(function (r) {
    var team = String(col(r, '팀 보유 여부 및 팀원') || '');
    var solo = /없|혼자|미정/.test(team);
    return {
      kind: solo ? 'person' : 'team',
      club: String(col(r, '소속동아리') || ''),
      title: (solo ? '팀 찾는 중 · ' : '팀원 모집 · ') + String(col(r, '희망역할') || ''),
      tags: String(col(r, '기술스택 및 개발 경험') || '').split(/[,\/]/)
              .map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 3),
      meta: String(col(r, '전체 일정 참석 가능여부') || '')
      // 성함·학번·연락처·이메일은 절대 담지 않는다
    };
  });
  return { ok: true, items: items };
}
```

프론트는 `POSTS` 상수를 지우고 이걸로 바꾸면 됩니다.

```js
fetch(CFG.ENDPOINT + '?action=board')
  .then(function (r) { return r.json(); })
  .then(function (d) { POSTS = d.items || []; render(); })
  ['catch'](function () { /* 실패해도 빈 보드로 두고 안내 문구 */ });
```

> 시트를 매번 읽으면 느리니 `CacheService`로 1~5분 캐시를 두는 걸 권합니다. 모집 기간에 방문이 몰려도 견딥니다.

### POST `{ action:'me' }` — 내 신청 상태

```
요청  { "action": "me", "idToken": "<구글 ID 토큰>" }
응답  { "ok": true, "found": true, "answers": { ... } }
```

같은 계정으로 다시 로그인했을 때 **이전에 쓴 내용을 불러와** 수정 제출할 수 있게 하는 용도입니다. 지금은 브라우저 임시저장(localStorage)에만 남아 있고, 제출이 끝나면 지워집니다(공용 PC 대비). 그래서 다른 기기에서 고치려면 처음부터 다시 써야 합니다.

토큰은 주소창·서버 로그에 남지 않도록 **GET이 아니라 POST 본문**으로 보내세요.

### 지원하기 / 팀에 초대 버튼

여기까지 만들면 "누가 누구에게 지원했는가"를 저장할 곳이 필요합니다. 시트에 `지원내역` 탭을 하나 더 두고 `(신청자 식별자, 대상 식별자, 시각)`을 쌓는 정도면 충분합니다. **다만 이건 없어도 행사는 돌아갑니다** — 팀 매칭을 운영진이 수동으로 한다면 게시판은 "읽기 전용"으로 두고 연락은 오프라인으로 돌리는 게 현실적입니다. 2주 안에 할 일로는 무리일 수 있으니 우선순위를 낮게 두세요.

---

## 7. 한도와 비용

전부 무료입니다. Apps Script 무료(consumer) 계정 한도:

| 항목 | 한도 | 우리 사용량 |
|---|---|---|
| UrlFetch 호출 | 20,000회 / 일 | 제출 1건당 1회 (토큰 검증) |
| 스크립트 실행 시간 | 6분 / 실행 | 1초 미만 |
| 동시 실행 | 30개 / 사용자 | 최대 120명 규모라 여유 |

제출이 하루 만에 몰려도 한도의 1%도 안 씁니다.

---

## 8. 막혔을 때

| 증상 | 원인과 해결 |
|---|---|
| 로그인 버튼이 안 뜬다 | `CLIENT_ID`가 비었거나, 접속 주소가 **승인된 JavaScript 원본**과 다름. `file://`로 열었는지 확인 |
| 버튼은 뜨는데 눌러도 안 됨 | 광고 차단 확장 프로그램. 시크릿 창에서 확인 |
| "액세스 차단됨" 화면 | 게시 상태가 `테스트`. 2-3에서 **프로덕션으로 푸시** |
| 제출은 되는데 시트가 빈다 | `SHEET_ID` 오타, 또는 코드 수정 후 **새 버전으로 재배포** 안 함 |
| 콘솔에 CORS 오류 | `Content-Type`을 건드렸는지 확인 (5절) |
| `AUTH_FAILED` | `Code.gs`의 `CLIENT_ID`와 `index.html`의 `CLIENT_ID`가 다름. 또는 1시간 지나 토큰 만료 — 다시 로그인 |
| 열이 비어서 들어감 | `SCHEMA`의 `k`와 `HEADERS` 이름 불일치 (띄어쓰기까지 같아야 함) |

---

## 9. 코드 말고 채워야 할 빈칸

정책 문서의 빈칸은 페이지에 **빨간 점선**으로 표시돼 있습니다.

- [ ] 개인정보처리방침·이용약관 — 시행일, 문의 이메일, 개인정보 보호책임자 이름·직책
- [ ] 동아리 한 줄 소개 5개 (`[EC 한 줄 소개]` 등)
- [ ] 상금·상품 (`[확정 후 공지]`)
- [ ] 문의 채널, 인스타그램·GitHub·문의 메일 링크
- [ ] 파비콘 (지금 없어서 `/favicon.ico` 404)

---

## 10. 참고

- [OAuth 동의 화면 설정 (공식)](https://developers.google.com/workspace/guides/configure-oauth-consent)
- [OAuth 앱 브랜딩 관리](https://support.google.com/cloud/answer/15549049)
- [Apps Script 할당량](https://developers.google.com/apps-script/guides/services/quotas)
- [FedCM 마이그레이션](https://developers.google.com/identity/gsi/web/guides/fedcm-migration) — 버튼 방식은 **선택 사항**이라 지금 코드 그대로 둬도 됩니다
