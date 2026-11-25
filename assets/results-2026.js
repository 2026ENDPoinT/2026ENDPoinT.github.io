/* ENDPoinT 2026 결과 — 홈의 '결과 발표' · '2026 우승 서비스 소개' · '수상팀 발표자료' 가 이 파일 하나만 읽는다.
   서버에 묻지 않는다 (행사가 끝나 바뀌지 않는다). 점수 · 투표 수 · 심사 코멘트는 넣지 않는다 — 등수만.

   [고치는 법]
     등수        tracks — 제출 서버 results.public 응답을 그대로 옮긴 것 (동점은 같은 등수에 여러 팀).
     발표자료    decks  — 팀 번호 → Google Drive 파일 ID ('공개 발표자료 (수상팀)' 폴더의 사본).
                 파일을 바꾸면 ID 만 고친다. ID 가 없는 팀은 '발표자료 보기' 단추가 나오지 않는다 (등수는 그대로).
     우승 소개   winners — 두 팀을 같은 틀 · 같은 양으로. 글은 팀 발표자료 · 제출 설명에 있는 사실만.
                 화면 캡처는 assets/winners/ — 원본 src (가로 1440, 보기 창) 와 카드용 thumb (가로 720).
                 영상 · 캡처는 두 팀 모두 팀이 보낸 시연 자료에서 만든 것. 캡션은 두 팀 같은 형식(화면 이름 · 영상 길이)만. */
window.EP2026 = {
  // 출처: POST results.public (제출 서버, 2026-11-25 조회). state 'open', 응답의 at(공개 시각) = 2026-11-14 15:22:09 KST
  source: { action: 'results.public', fetched: '2026-11-25', openedAt: '2026-11-14T15:22:09+09:00' },
  tracks: [
    { key: 'H', name: '해커톤', places: [
      { place: 1, teams: [{ no: '19', title: 'EIDOS' }] },
      { place: 2, teams: [{ no: '12', title: '사이.' }, { no: '14', title: 'Momentree' }] },
      { place: 3, teams: [{ no: '13', title: 'STack' }, { no: '20', title: '수강나침반' }, { no: '17', title: '장학금 헌터' }] }
    ] },
    { key: 'A', name: '구현과제', places: [
      { place: 1, teams: [{ no: '05', title: 'POLARIS - Academic Navigator' }] },
      { place: 2, teams: [{ no: '03', title: 'PLANIT' }] },
      { place: 3, teams: [{ no: '02', title: 'ST Mate' }] },
      { place: 4, teams: [{ no: '10', title: '대학생 성적 관리 프로그램 for 컴퓨터공학과' }] }
    ] }
  ],

  // 팀 번호 → Drive 파일 ID. 보기: https://drive.google.com/file/d/<ID>/preview · 새 탭: /view
  decks: {
    '19': '1wus6wlBa9vEmhFi2zkx_Rj1SX4fiuzA8',
    '12': '1l0ovJTAUNUH0DcSWTxaaaOrGejMee-uj',
    '14': '1dvTn0lQgc8o4hIxkgLCbCBduv_1SXKsW',
    '13': '1o8pI0xM8NRen2ibl0LtN8vo7hCVcanuM',
    '20': '1ryLoUQDCwZIQBtX8GKRn4xLpd7_WNAnB',
    '17': '1quPkxVyzJvStnM7LbAkRE0y5K5Q9K4c7',
    '05': '1c5iknK6Rf96hxg5ondfOpG1F8MiBt2Wo',
    '03': '1WE930yLPzv7KG1248M9FcuqYr9wQiXjW',
    '02': '1kmJOh6xWwKAoIYBKio8TMkhzsyYCGih9',
    '10': '18TvvLPLixGrQJ2GO1rLaeUGN92uxhzi5'   // 3쪽 화면 캡처의 이름 · 학번을 픽셀째 지운 사본
  },

  // 두 1등 팀 — 트랙 순서(결과 발표와 같게: 해커톤 → 구현과제)로 나란히, 같은 크기
  winners: [
    {
      no: '19', track: 'H', name: 'EIDOS',
      line: '강의 PDF를 학습 단계별 숏폼 강의 시리즈로',
      video: { src: 'assets/winners/eidos-demo.mp4', poster: 'assets/winners/eidos-demo-poster.jpg', w: 428, h: 748,
               caption: '시연 영상 (67초)' },
      shots: [
        { src: 'assets/winners/eidos-upload.jpg', thumb: 'assets/winners/eidos-upload-720.jpg', w: 1440, h: 900, alt: 'EIDOS 강의 PDF 올리기 화면', caption: 'PDF 올리기' },
        { src: 'assets/winners/eidos-player.jpg', thumb: 'assets/winners/eidos-player-720.jpg', w: 1440, h: 900, alt: 'EIDOS 세로 플레이어와 원본 페이지 패널', caption: '플레이어 · 원본 패널' }
      ],
      points: [
        '강의 PDF(100쪽까지)를 올리고 입문 · 기본 · 심화 중 학습 모드를 고르면, 개념 · 예시 단위의 짧은 클립 시리즈가 만들어지고 완성된 것부터 위아래로 넘겨 봅니다.',
        '영상을 ‘생성’하지 않고 ‘설계’합니다. AI가 장면 설계도를 쓰고 브라우저가 그 설계대로 그려, 숫자 · 수식 · 코드가 뭉개지지 않습니다.',
        '장면을 따라 원본 강의자료의 근거 페이지가 옆 패널에서 함께 바뀝니다. 로그인 없이 기기별 ‘내 강의함’에 저장됩니다.'
      ],
      links: [
        { k: '서비스', href: 'https://2026endpoint.github.io/team19/' },
        { k: '코드', href: 'https://github.com/2026ENDPoinT/team19' }
      ]
    },
    {
      no: '05', track: 'A', name: 'POLARIS',
      line: '성적을 입력하면 예상 학점과 목표 평점 달성 가능성을 알려 주는 학업 의사결정 지원 서비스',
      video: { src: 'assets/winners/polaris-demo.mp4', poster: 'assets/winners/polaris-demo-poster.jpg', w: 1280, h: 720,
               caption: '시연 영상 (53초)' },
      shots: [
        { src: 'assets/winners/polaris-predict.jpg', thumb: 'assets/winners/polaris-predict-720.jpg', w: 1440, h: 780, alt: 'POLARIS 성적 예측 — 기말고사 필요 점수 화면', caption: '성적 예측' },
        { src: 'assets/winners/polaris-withdraw.jpg', thumb: 'assets/winners/polaris-withdraw-720.jpg', w: 1440, h: 780, alt: 'POLARIS 수강 철회 비교 화면', caption: '수강 철회 비교' }
      ],
      points: [
        '과목별 점수 · 평균 · 표준편차로 Z-점수와 예상 등급을 내고, 몬테카를로 시뮬레이션(3,000회)으로 목표 평점에 닿을 가능성을 계산합니다.',
        '수강 철회 시나리오와 재수강했을 때의 평점 변화를 비교하고, 목표에 필요한 최소 등급을 보여 줍니다.',
        '졸업까지의 학점 이수 계획을 세웁니다. 로그인 없이 브라우저별로 저장됩니다.'
      ],
      links: [
        { k: '서비스', href: 'https://polaris-okov.onrender.com/', note: '오래 쉬던 서버라 첫 접속이 느릴 수 있습니다' },
        { k: '코드', href: 'https://github.com/2026ENDPoinT/team05' }
      ]
    }
  ]
};
