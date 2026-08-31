# 배포 — GitHub Pages

이 저장소는 **GitHub Pages(main 브랜치 루트)** 로 배포됩니다. 빌드 단계가 없어 `git push origin main` 이 곧 배포입니다(반영까지 1~3분).

- 라이브: https://vlm-study.kwjin.dev
- 커스텀 도메인: `CNAME` 파일(`vlm-study.kwjin.dev`) — 삭제하지 말 것. DNS는 Cloudflare에 `CNAME vlm-study → 201411156.github.io` (DNS only).
- `.nojekyll` — Jekyll 처리를 끄는 마커(밑줄로 시작하는 경로 보호). 삭제하지 말 것.
- HTTPS: GitHub가 Let's Encrypt 인증서를 자동 발급·갱신하며 `https_enforced` 가 켜져 있습니다.

## 로컬 미리보기
```
scripts/serve.sh   # http://localhost:8000
```

## 새 장 추가 절차
1. `chapters/NN.html` 작성(템플릿: `chapters/02.html`), 실습은 `assets/js/labs/chNN-*.js`
2. `assets/js/site.js` 의 `CHAPTERS` 에서 해당 장 `status:'live'`, `quizzes:[...]` 갱신
3. 이전/다음 장 링크 직결, `docs/AUTHORING.md` 검증 항목 통과
4. commit → push → 라이브 URL 200 확인

## 문제 시
- 배포 상태: `gh api repos/201411156/vlm-course/pages --jq '{status,https_enforced}'`
- 인증서가 안 나오면 도메인을 뗐다 다시 붙이기(`cname` null → 재설정)
