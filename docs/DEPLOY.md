# 배포 — Cloudflare Pages

이 사이트는 **빌드 단계가 없다.** 저장소 루트가 곧 배포될 디렉터리다.
프레임워크도, 번들러도, `node_modules`도 없다. HTML/CSS/JS 파일 그대로 올라간다.

- 빌드 명령: **없음** (비워 둔다)
- 출력 디렉터리: **`/`** (저장소 루트)
- Node 버전: 무관

---

## 0. 먼저 — 로컬에서 확인

```bash
./scripts/serve.sh          # http://localhost:8000
```

`file://` 로 열면 안 된다. `localStorage`와 상대 경로가 정상 동작하려면
HTTP로 서빙해야 한다.

---

## 경로 A — GitHub 연동 (권장)

한 번 연결해두면 `git push` 할 때마다 자동 배포되고, PR마다 프리뷰 URL이 생긴다.

### 사용자가 할 일

1. **GitHub에 빈 저장소를 만든다** (예: `vlm-course`). Public/Private 무관.
2. 원격을 붙이고 푸시한다.
   ```bash
   git remote add origin git@github.com:<계정>/vlm-course.git
   git branch -M main
   git push -u origin main
   ```
3. **Cloudflare 대시보드** → Workers & Pages → Create → Pages →
   **Connect to Git** → GitHub 계정 인증 → 방금 만든 저장소 선택.
4. 빌드 설정 화면에서:
   - Framework preset: **None**
   - Build command: **(비움)**
   - Build output directory: **`/`**
5. Save and Deploy. 1분 내로 `https://<프로젝트명>.pages.dev` 가 뜬다.

### 커스텀 도메인

프로젝트 → Custom domains → Set up a custom domain →
서브도메인 입력(예: `vlm.example.com`).
도메인이 이미 Cloudflare에 있으면 CNAME이 자동으로 잡히고,
없으면 안내에 따라 네임서버를 옮기거나 CNAME을 직접 추가한다.

---

## 경로 B — wrangler 로 직접 배포

GitHub을 거치지 않고 로컬에서 바로 올린다. CI가 필요 없을 때 간편하다.

### 사용자가 할 일

1. **Cloudflare API 토큰 발급**
   대시보드 → My Profile → API Tokens → Create Token →
   템플릿 **"Edit Cloudflare Workers"** 사용, 또는 커스텀 토큰에
   `Account · Cloudflare Pages · Edit` 권한을 준다.
   Account ID는 대시보드 우측 사이드바에서 복사한다.

2. **환경변수로 넣는다** (셸 히스토리에 남기지 말 것)
   ```bash
   export CLOUDFLARE_API_TOKEN=...
   export CLOUDFLARE_ACCOUNT_ID=...
   ```

3. **첫 배포** — 프로젝트가 없으면 대화형으로 만들어준다.
   ```bash
   npx wrangler@latest pages deploy . --project-name=vlm-course
   ```
   이후 배포도 같은 명령. `--branch=main` 을 주면 프로덕션으로,
   생략하고 다른 브랜치명을 주면 프리뷰 배포가 된다.

4. 출력된 `https://<해시>.<프로젝트명>.pages.dev` 로 확인.

> 두 경로를 섞어도 된다. GitHub 연동을 해둔 프로젝트에 wrangler로 밀어 넣는 것도
> 가능하지만, 어느 쪽이 "진짜"인지 헷갈리므로 **하나만 고르는 것을 권한다.**

---

## 배포에 포함되는 것 / 안 되는 것

Cloudflare Pages는 저장소 루트 전체를 올리되, 아래는 특별 취급한다.

| 파일 | 역할 |
|---|---|
| `_headers` | 응답 헤더 규칙. 그대로 적용된다. |
| `_redirects` | 리다이렉트 규칙. 지금은 없음. |
| `404.html` | 없는 경로에 대한 응답. |

`docs/`, `scripts/`, `README.md` 도 그대로 올라가 웹에서 접근 가능해진다.
숨기고 싶으면 `_redirects` 로 막거나 별도 브랜치로 분리한다.
(지금은 전부 공개해도 무방한 내용만 들어 있다.)

---

## 체크리스트 — 배포 전

- [ ] `./scripts/serve.sh` 로 열어 1장/2장 LAB이 다 동작하는가
- [ ] 라이트/다크 테마 토글이 두 방향 모두 정상인가
- [ ] 모바일 폭(760px 미만)에서 레일이 숨고 본문이 가로 스크롤 없이 읽히는가
- [ ] 퀴즈를 풀고 새로고침했을 때 상태가 유지되는가
- [ ] 목차의 진행률 바가 갱신되는가

## 사용자가 정해야 할 것

1. **저장소를 GitHub에 올릴 것인가** — 경로 A/B 선택이 여기서 갈린다.
2. **Pages 프로젝트명** — 그대로 `<이름>.pages.dev` 가 된다.
3. **커스텀 서브도메인 사용 여부**와 그 이름.
4. **API 토큰** (경로 B를 고를 경우) — 발급은 사용자만 할 수 있다.
