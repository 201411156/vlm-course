# VLM 워크북

비전-언어 모델(VLM)이 실제로 어떻게 동작하는지를 **읽는 대신 만져보며** 익히는
14장짜리 공개 학습 노트. 모든 실습은 브라우저 안에서 돈다 — 서버도, 계정도,
외부 API 호출도 없다.

전 14장 공개.

| | 장 | 핵심 |
|---|---|---|
| 01 | 이미지가 토큰이 되기까지 | 패치 분할, 토큰 수, 어텐션 비용 |
| 02 | 두 세계를 잇는 프로젝터 | 정렬, linear · MLP · resampler |
| 03 | 해상도와 토큰 예산 | 동적 해상도, 타일 분할, 브라우저 WebGPU 실습 |
| 04 | 그라운딩 — 좌표를 말하게 하기 | 박스를 텍스트로, 좌표 표기법 |
| 05 | 제로샷 검출의 하한선 | 학습 없이 어디까지, 어디서 무너지나 |
| 06 | LoRA — 큰 모델을 얇게 고치기 | 저랭크 어댑터, 무엇을 얼릴 것인가 |
| 07 | 데이터 만들기 — instruction | 합성과 검증 |
| 08 | 판정기로 쓰는 VLM | 생성 모델을 분류기처럼 |
| 09 | 제약 채점과 확률 읽기 | 로짓을 직접 읽는 채점 |
| 10 | 멀티모달 판정기 전환 | 텍스트 파이프라인에 이미지 붙이기 |
| 11 | 서빙 — 양자화와 지연 | INT8·INT4, KV 캐시, 배치 |
| 12 | 소형 VLM의 역습 | 작은 모델이 이기는 조건 |
| 13 | 비디오 — 시간축 토큰 | 프레임 샘플링, 폭발하는 토큰 |
| 14 | 에이전틱 VLM | 보고, 판단하고, 도구를 부르는 루프 |

## 로컬 미리보기

```bash
./scripts/serve.sh          # → http://localhost:8000
```

`file://` 로 열면 안 된다(localStorage·상대경로).

## 구조

```
index.html                    목차 · 진행률
chapters/01.html ~ 14.html    본문 14장
assets/css/base.css           디자인 시스템 (색 토큰 · 타이포 · LAB/퀴즈 카드)
assets/js/site.js             챕터 레지스트리 · 레일 · 테마 · 퀴즈 엔진 · 진행상태
assets/js/index.js            목차 렌더
assets/js/labs/chNN-*.js      장별 LAB 스크립트 (23개)
                              ch03-webgpu.js + ch03-webgpu-worker.js 는
                              선택형 WebGPU 실습(사용자가 버튼을 눌러야 모델 다운로드)
_headers                      Cloudflare Pages 헤더 규칙
404.html
docs/DEPLOY.md                배포 안내 (wrangler · GitHub 연동)
docs/webgpu_lab_plan.md       브라우저 내 실제 VLM 추론 LAB 타당성 조사
docs/AUTHORING.md             집필 규약
scripts/serve.sh              로컬 서버
```

**빌드 단계가 없다.** 저장소 루트가 곧 배포 디렉터리다.

## 장을 추가하려면

1. `assets/js/site.js` 의 `CHAPTERS` 에서 해당 장의 `status` 를 `'live'` 로 바꾸고
   `quizzes: ['q1','q2']` 를 채운다. 레일과 목차는 여기 하나만 보고 그려진다.
2. `chapters/NN.html` 을 만든다. `chapters/02.html` 을 복사해 시작하는 게 빠르다.
   - `<body data-chapter="NN">` — 진행상태 저장 키가 된다.
   - 퀴즈 마크업 규약: `<div class="opts" id="q1">` 안의 `button[data-a="1"]` 이 정답,
     해설은 같은 번호의 `<div class="expl" id="e1">`. 배선은 `site.js` 가 자동으로 한다.
3. LAB 스크립트는 `assets/js/labs/chNN-*.js` 로 두고 페이지 하단에서 `defer` 로 로드.

## 디자인 규칙

- **모달리티 2색**: 시각 = teal(`--vis`), 언어 = amber(`--lang`). 이 대응은 사이트
  전체에서 절대 뒤집지 않는다. 인라인 표기는 `<span class="tok v">` / `<span class="tok l">`.
- 서체: 제목 Gowun Batang · 본문 IBM Plex Sans KR · 수치 IBM Plex Mono.
- 테마는 다크가 기본, 시스템 설정을 따르며 레일 하단 버튼으로 auto/light/dark 순환.
  **색은 반드시 CSS 변수로만 쓴다** — 캔버스 안에서도 `getComputedStyle` 로 읽어 쓴다.
- 본문 최대 폭 66ch. LAB은 카드, 확인 문제도 같은 카드를 쓴다.

## 범위

공개 문헌과 공개 모델만 다룬다. 벤치마크 순위표나 "어떤 모델을 써야 하나"는
다루지 않는다 — 순위표는 반년이면 갈리지만 설계 이유는 오래 간다.

## 라이선스

미정. 정할 때까지 개인 학습 노트로 취급한다.
