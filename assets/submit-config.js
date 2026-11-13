/* ==============================================================
   [설정] 결과물 제출(/submit/) · 심사위원 현황판(/judge/) 의 연결 정보
   --------------------------------------------------------------
   ENDPOINT 가 비어 있는 동안에는 서버에 아무것도 보내지 않습니다.
     - 배포된 사이트: "준비하고 있습니다" 안내만 보입니다.
     - 로컬(localhost 등): 예시 자료로 화면을 보여 주는 미리보기 모드로 열립니다.
   배포 방법은 SUBMIT.md 를 보세요.
   ============================================================== */
window.EPSUBMIT = {
  // index.html 의 EPCONFIG.CLIENT_ID 와 같은 값 (공개돼도 되는 값입니다)
  CLIENT_ID: '100824066944-7s6di7cbhsedtnms675fka8bbbka3u7p.apps.googleusercontent.com',

  // 제출용 Apps Script 웹 앱 주소 (…/exec). 신청서 백엔드(EPCONFIG.ENDPOINT)와는 다른 주소입니다.
  ENDPOINT: 'https://script.google.com/macros/s/AKfycbwWtxx_pF7GM0UpiBlJ_hkVtiHGkn2IQWehNTRRr6-M4xK57sDVRIeZIFw8wALO-1aF/exec',

  // 서버 응답을 받기 전에 화면에 보여 줄 마감 시각. 실제 판정은 서버가 합니다.
  DEADLINE: '2026-11-14T10:00:00+09:00'
};
