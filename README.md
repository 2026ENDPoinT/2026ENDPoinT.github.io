<div align="center">

<img src="assets/img/hero-1024.png" width="420" alt="ENDPoinT 엠블럼">

# ENDPoinT

**서울과학기술대학교 컴퓨터공학과 5개 학술 동아리 연합 해커톤**

EC · NL · 다락방 · Plum · TCP

2026 / 11 / 13 (금) – 11 / 14 (토)

1박 2일 · 미래관 109호

<br>

[![site](https://img.shields.io/badge/2026endpoint.github.io-191919?style=for-the-badge&logo=github&logoColor=white)](https://2026endpoint.github.io)
&nbsp;
![HTML](https://img.shields.io/badge/HTML-6AA3F0?style=for-the-badge&logoColor=white)
![Apps Script](https://img.shields.io/badge/Apps%20Script-E8636D?style=for-the-badge&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-828282?style=for-the-badge&logoColor=white)

</div>

<br>

---

## 소개

서로 다른 스택과 성격을 가진 다섯 학술 동아리가 **처음으로 함께 여는 해커톤**입니다.
동아리 회원을 중심으로 최대 120명을 모집하며, 개발 경험이 적은 참가자도 함께할 수 있도록
본 행사 전에 사전 교육과 연사·멘토링 세션을 나누어 운영합니다.

이 저장소는 행사 안내 · 참가 신청 · 팀 모집 게시판을 담은 **공식 웹사이트**입니다.

<br>

## 행사 개요

| | |
|---|---|
| **일시** | 2026년 11월 13일 (금) – 14일 (토), 1박 2일 |
| **장소** | 서울과학기술대학교 미래관 109호 |
| **규모** | 5개 동아리 · 최대 120명 |
| **팀 구성** | 팀당 2~6명 · 동아리를 섞어 구성 가능, 개인 신청 시 운영진이 매칭 |
| **트랙** | **해커톤 트랙** — 주제를 받아 서비스를 새로 제작<br>**구현과제 트랙** — 주어진 과제를 단계별로 구현 |
| **심사** | 심사위원 점수 60% + 참가자 투표 40% |

<br>

## 진행 일정

| | | |
|---|---|---|
| **STEP 1** | 10.05 – 10.16 *(예정)* | **참가 신청** — 사이트에서 개인 또는 팀 단위로 신청 |
| **STEP 2** | 11.04 (수) | **1차 · 팀 발표와 교육** — 팀 구성 발표, AI 미니 세미나, Git · 협업 도구 교육 |
| **STEP 3** | 11.11 (수) 19:30 | **2차 · 연사 세션과 멘토링** — 현직 선배·졸업생 세션, 팀별 멘토링과 중간 데모 |
| **STEP 4** | 11.13 (금) – 11.14 (토) | **본 해커톤** — 1박 2일 진행 후 발표 · 심사 · 시상 |

<br>

## 주최 동아리 · 임원진

| 동아리 | 임원 | 참가 규모 |
|:---|:---|:---|
| **NL** | 박제영 | - |
| **PLUM** | 조용준 | - |
| **TCP** | 박연오 | - |
| **EC** | 신우빈 | - |
| **다락방** | 문시현 | - |

<br>

## 문의

| 역할 | 담당 | 메일 |
|:---|:---|:---|
| **사이트 총괄** | 박제영 | [recognize@seoultech.ac.kr](mailto:recognize@seoultech.ac.kr) |
| **행사 총괄** | 박연오 | [24101209@seoultech.ac.kr](mailto:24101209@seoultech.ac.kr) |

행사 진행에 대한 문의는 소속 동아리 운영진에게 먼저 전달해 주세요.

<br>

---

## 사이트 구성

```
.
├── index.html            메인 · 참가 신청 폼 · 팀 모집 게시판 (단일 파일 SPA)
├── privacy/index.html    개인정보처리방침
├── terms/index.html      이용약관
├── assets/
│   ├── img/              동아리 로고 · 히어로 이미지
│   ├── legal.css         약관 페이지 스타일
│   └── legal.js
├── apps-script/
│   ├── Code.gs           신청서 수신 · 조회 · 수정 엔드포인트
│   └── Board.gs          팀 모집 게시판 (스프레드시트 DB)
└── BACKEND.md            구글 OAuth · Apps Script 배포 가이드
```

**프런트엔드** 는 빌드 도구 없이 순수 HTML · CSS · JavaScript로 작성했고, GitHub Pages로 배포합니다.
**백엔드** 는 Google Apps Script 웹 앱이며, 구글 스프레드시트를 DB로 사용합니다.
신청서와 게시판은 구글 로그인(OAuth)으로 본인 확인을 거칩니다.

## 로컬에서 보기

정적 사이트라 파일을 그대로 열어도 되지만, 구글 로그인을 확인하려면 로컬 서버가 필요합니다.

```bash
python -m http.server 8000
# → http://localhost:8000
```

백엔드 연동 설정(OAuth 클라이언트 발급, Apps Script 배포, `EPCONFIG` 값 입력)은
[BACKEND.md](BACKEND.md) 에 단계별로 정리되어 있습니다.

<br>

<div align="center">

**ENDPoinT** · 서울과학기술대학교 연합 해커톤
EC · NL · 다락방 · Plum · TCP

</div>
