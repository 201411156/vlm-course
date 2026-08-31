# WebGPU 실습 타당성 조사 — 브라우저에서 진짜 VLM 돌리기

작성 2026-08-31 · 상태: **조사 완료, 구현 미착수**

지금 워크북의 LAB은 전부 순수 JS 시뮬레이션이다(1장 패치 분할, 2장 임베딩 정렬).
"진짜 모델이 진짜 이미지를 보고 답하는" LAB을 한 번쯤 넣고 싶다 —
서버 없이, 방문자 브라우저 안에서. 이 문서는 그게 가능한지, 어떻게 할지에 대한 조사다.

---

## 0. 결론

**실용적이다. 지금 바로 구현 가능하다.**

| 항목 | 권장 |
|---|---|
| 모델 | `HuggingFaceTB/SmolVLM-256M-Instruct` (공식 ONNX 포함) |
| 런타임 | `@huggingface/transformers` (transformers.js) v4.1.0 이상, 또는 검증된 v3.7.1 고정 |
| 백엔드 | `device: 'webgpu'` (ONNX Runtime Web) |
| 가중치 | 모듈별 dtype 지정 → **약 160~190MB** (fp32 그대로면 ~1GB) |
| 호스팅 | 가중치는 **HF CDN 직결**, Cloudflare Pages에는 HTML/JS만 |
| 특수 헤더 | **불필요** (COOP/COEP 없이 WebGPU 동작) |

가장 큰 제약은 성능이 아니라 **최초 다운로드 용량**이다. 그래서 이 LAB은
"페이지 열면 자동 실행"이 아니라 **명시적 동의 버튼 뒤에** 두어야 한다.

---

## 1. transformers.js — 현재 API 형태

- 패키지는 `@huggingface/transformers`. 구 `@xenova/transformers`는 폐기됐다.
  npm 최신 = **4.2.0**.
- v3부터 `device: 'webgpu'` 한 줄로 WebGPU 가속이 켜지고, 백엔드는 **ONNX Runtime Web**이다.
  ([HF 블로그](https://huggingface.co/blog/transformersjs-v3))
- `dtype`: `fp32` · `fp16` · `q8`/`int8`/`uint8` · `q4`/`bnb4`/`q4f16`.
  ([dtypes 가이드](https://huggingface.co/docs/transformers.js/guides/dtypes))
- VLM처럼 ONNX 파일이 여러 개인 모델은 **서브모듈별로 다른 dtype**을 줄 수 있다.
  SmolVLM은 `pipeline()`이 아니라 `AutoProcessor` + `AutoModelForVision2Seq`를
  직접 쓰는 게 공식 예제의 패턴이다.

> ⚠ **버전 함정**: v4.0.0/v4.0.1 구간에 SmolVLM 회귀가 있었고 v4.1.0에서 복구됐다
> ([릴리스 노트](https://github.com/huggingface/transformers.js/releases)).
> 버전을 고정할 거면 **v4.1.0 이상** 또는 공식 예제가 쓰는 **v3.7.1**로.

## 2. 모델 선택 — 왜 SmolVLM-256M인가

HF Hub API로 실측한 ONNX 파일 크기(단위 MB):

**SmolVLM-256M-Instruct**

| 모듈 | fp32 | fp16 | int8 | q4f16 |
|---|---:|---:|---:|---:|
| vision_encoder | 374.3 | 187.3 | 94.2 | 55.0 |
| embed_tokens | 113.5 | 56.8 | 28.4 | 56.8 |
| decoder_model_merged | 540.6 | 270.4 | 137.2 | 77.0 |
| **합계** | **~1030** | **~514** | **~260** | **~189** |

**SmolVLM-500M-Instruct** 은 같은 순서로 ~2030 / ~1020 / ~511 / ~358MB.

실전 팁 두 개:

1. `embed_tokens`는 `q4`/`bnb4`로 지정해도 **파일이 fp32와 동일 크기로 나온다**
   (양자화가 실질 적용되지 않음). `int8`로 따로 지정하는 게 이득.
   → `embed_tokens: int8` + `vision_encoder: q4f16` + `decoder: q4f16` = **약 160MB**.
2. `q4f16`은 GPU가 `shader-f16` feature를 지원해야 한다(공식 워커도
   `adapter.features.has("shader-f16")`로 분기한다). 호환성 최우선이면
   전부 `int8`(~260MB, f16 불필요).

공식 데모는 단순함을 위해 그냥 `dtype: "fp32"`(~1GB)를 쓴다.
**공개 교육 사이트라면 반드시 낮춰 쓸 것.**

대안 모델 비교 — 전부 transformers.js로 동작은 하지만 용량이 3~15배다.

| 모델 | 대표 quant 총합 | 비고 |
|---|---|---|
| SmolVLM-256M | ~189MB (최적화 ~160MB) | ✅ 채택 |
| SmolVLM-500M | ~358MB | 품질 더 필요할 때 |
| [FastVLM-0.5B](https://huggingface.co/onnx-community/FastVLM-0.5B-ONNX) | ~807MB | Apple, 데모 존재 |
| [Moondream2](https://huggingface.co/vikhyatk/moondream2/tree/onnx) | 442MB~1.22GB | |
| [Florence-2-base-ft](https://huggingface.co/spaces/Xenova/florence2-webgpu) | (미실측) | 캡션/그라운딩 특화 |
| [Qwen2-VL-2B](https://huggingface.co/onnx-community/Qwen2-VL-2B-Instruct) | 수 GB | 모바일에서 불가 |

iOS Safari는 탭당 메모리가 대략 300~450MB 수준이라, 800MB급 이상은
모바일에서 아예 못 뜰 위험이 크다. **256M이 유일하게 안전한 선택.**

**동작 확인된 공개 데모**
- [HuggingFaceTB/SmolVLM-256M-Instruct-WebGPU](https://huggingface.co/spaces/HuggingFaceTB/SmolVLM-256M-Instruct-WebGPU)
- [webml-community/smolvlm-realtime-webgpu](https://huggingface.co/spaces/webml-community/smolvlm-realtime-webgpu) — 실시간 웹캠
- [transformers.js-examples/smolvlm-webgpu](https://github.com/huggingface/transformers.js-examples/tree/main/smolvlm-webgpu) — 소스

## 3. 브라우저 요구사항

| 브라우저 | WebGPU 기본 활성화 |
|---|---|
| Chrome / Edge (데스크톱) | 113+ |
| Chrome (Android) | 121+ (Android 12+, Qualcomm/ARM GPU) |
| Firefox | Windows 141+, macOS(Apple Silicon) 145+ · Linux/Android 미완 |
| Safari | macOS Tahoe 26 / iOS 26 / iPadOS 26+ |

([web.dev 정리](https://web.dev/blog/webgpu-supported-major-browsers))

- 미지원 시 `device: 'wasm'` 폴백 가능하지만 느리다 — HF 공식 블로그는
  "WebGPU가 WASM 대비 최대 100배"라고 표현한다(상대치만 제시).
- 최초 다운로드 후 **Cache API**에 저장되어 재방문은 즉시 로드된다.
- Safari의 WebGPU 구현은 아직 device-lost/탭 크래시 보고가 있다
  ([wgpu#3735](https://github.com/gfx-rs/wgpu/issues/3735)) — "지원 = 안정"이 아니다.

성능 수치는 **1차 출처가 있는 tok/s 벤치마크를 찾지 못했다.**
문서에 쓸 때는 "노트북급 GPU에서 실시간에 가까운 응답, 통합 GPU에서도 수 초 내"
정도로 보수적으로만 서술할 것. 정확한 숫자가 필요하면 위 데모로 직접 측정.

## 4. Cloudflare Pages 쪽 제약 — 실측 결론

두 가지를 실제로 확인했다.

1. **CORS 문제 없음.** HF Hub의 파일 서빙은 `access-control-allow-origin: *`를
   내려준다. 프록시도, 자체 호스팅도 필요 없다.
2. **COOP/COEP 불필요.** 운영 중인 SmolVLM WebGPU Space는 COEP 헤더 없이
   COOP만 걸고도 정상 동작한다. 크로스 오리진 격리(SharedArrayBuffer)는
   **멀티스레드 WASM에만** 필요한 조건이지 WebGPU의 조건이 아니다.

→ 이 LAB만을 위한 `_headers` 설정은 **필요 없다.**

WASM 폴백 경로의 CPU 성능까지 챙기고 싶을 때만 아래를 추가한다(점진적 개선).

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: credentialless
```

`require-corp` 대신 `credentialless`를 쓰면 CORP 헤더 없는 크로스 오리진
서브리소스(폰트 등)가 깨지지 않는다. Chrome/Edge 위주 지원이고,
Safari/Firefox는 그냥 싱글스레드로 폴백하므로 안전하다.
(`_headers`는 규칙 100개, 줄당 2000자 제한 —
[문서](https://developers.cloudflare.com/pages/configuration/headers/))

**가중치는 HF CDN 직결을 권장한다.** Cloudflare에 수백 MB를 올려 배포를
무겁게 만들 이유가 없고, 클라이언트 캐싱도 동일하게 작동한다.
트레이드오프는 HF 쪽 장애에 대한 통제권이 없다는 것.

## 5. 구현 스케치

```html
<script type="module">
import {
  AutoProcessor, AutoModelForVision2Seq, TextStreamer, load_image
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

const MODEL = "HuggingFaceTB/SmolVLM-256M-Instruct";

if (!("gpu" in navigator)) { fallbackToSimulation(); }
const adapter = await navigator.gpu.requestAdapter();
const f16 = adapter?.features.has("shader-f16");

const processor = await AutoProcessor.from_pretrained(MODEL);
const model = await AutoModelForVision2Seq.from_pretrained(MODEL, {
  device: "webgpu",
  dtype: f16
    ? { embed_tokens: "int8", vision_encoder: "q4f16", decoder_model_merged: "q4f16" } // ~160MB
    : { embed_tokens: "int8", vision_encoder: "int8",  decoder_model_merged: "int8"  }, // ~260MB
  progress_callback: p => updateProgressBar(p),
});

const image = await load_image(fileOrCanvasBlob);
const messages = [{ role: "user",
  content: [{ type: "image" }, { type: "text", text: prompt }] }];
const text = processor.apply_chat_template(messages, { add_generation_prompt: true });
const inputs = await processor(text, [image]);

const streamer = new TextStreamer(processor.tokenizer, {
  skip_prompt: true, skip_special_tokens: true,
  callback_function: chunk => appendOutput(chunk),
});
await model.generate({ ...inputs, max_new_tokens: 256, do_sample: false, streamer });
</script>
```

**모델 로딩은 Web Worker로 분리할 것.** 공식 예제도 `src/worker.js` 패턴이다.
메인 스레드가 막히면 다운로드 진행률 UI가 죽는다.

## 6. 워크북에 어떻게 넣을 것인가

붙일 자리 후보:

- **3장(해상도와 토큰 예산)** — 같은 이미지를 해상도만 바꿔 넣고
  답이 어떻게 달라지는지 / 지연이 어떻게 달라지는지를 **실제 모델로** 보여준다.
  1장의 시뮬레이션과 짝이 맞는다. ← 가장 유력
- **5장(제로샷 검출의 하한선)** — 방문자가 자기 사진을 올려 zero-shot이
  어디서 무너지는지 직접 본다. "부재 판정을 못 한다"를 체감시키기에 좋다.
- **12장(소형 VLM의 역습)** — 256M이 브라우저에서 도는 것 자체가 논증이다.

**UX 규칙 3개**
1. 자동 시작 금지. `모델 내려받고 실행하기 (약 160MB)` 버튼 뒤에 둔다.
2. 진행률 표시 + "Wi-Fi 권장" 고지. 재방문 시 캐시 적중이면 그 사실을 알린다.
3. 3단계 폴백:
   - WebGPU 있음 → 실제 추론
   - 없음 + 데스크톱 → `device:'wasm'` (느림을 고지)
   - 그 외 → **순수 JS 시뮬레이션 LAB**으로 대체.
     미리 계산해둔 이미지-응답 쌍을 타이핑 이펙트로 재생.
     개념 전달에는 충분하고 리스크가 0이다.

## 7. 남은 확인거리

- 정량 tok/s: 1차 출처 없음 → 직접 측정 필요.
- `credentialless` COEP가 SharedArrayBuffer를 완전히 켜는지: 문서상 확답 없음.
  멀티스레드 WASM을 실제로 켤 때 별도 검증.
- Florence-2 / Qwen2-VL의 quant별 정확한 총량 미실측
  (필요하면 `/api/models/<repo>/tree/main/onnx`로 동일하게 조회 가능).
