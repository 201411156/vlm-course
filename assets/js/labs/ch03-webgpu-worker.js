/* ==========================================================================
   LAB 3-2 — 실제 추론 엔진 (transformers.js)

   이 파일은 두 가지 방식으로 쓰입니다.
     ① 모듈 워커로 로드 — 기본 경로. 메인 스레드가 막히지 않습니다.
     ② 메인 스레드에서 dynamic import 후 createEngine() 호출 — 모듈 워커를
        지원하지 않는 브라우저용 폴백.
   두 경우 모두 같은 메시지 프로토콜을 씁니다.

   ── 근거 (2026-08 확인) ─────────────────────────────────────────────────
   · 패키지: @huggingface/transformers (구 @xenova/transformers는 폐기)
     버전 3.7.1 고정 — Hugging Face 공식 예제 transformers.js-examples/
     smolvlm-webgpu 가 고정한 바로 그 버전입니다.
   · 모델: HuggingFaceTB/SmolVLM-256M-Instruct (공식 ONNX 동봉).
     config.model_type = "idefics3", image_token_id = 49190,
     processor_config.image_seq_len = 64,
     preprocessor_config = { size:{longest_edge:2048},
                             max_image_size:{longest_edge:512},
                             do_image_splitting:true }
   · dtype 서브모듈 키는 정확히 셋: embed_tokens · vision_encoder ·
     decoder_model_merged (모델 저장소의 onnx/ 파일 목록과 model.sessions 키가
     모두 일치). q4f16 파일은 셋 다 존재합니다.
   · progress_callback 이벤트: { status, name, file, progress, loaded, total },
     status ∈ initiate|download|progress|done. progress 는 0~1이 아니라 0~100.
   · generate() 는 프롬프트를 포함한 [batch, prompt+new] 텐서를 돌려줍니다 —
     반드시 prompt 길이만큼 잘라내야 답만 남습니다.

   ── 해상도를 실제로 바꾸는 법 ────────────────────────────────────────────
   Idefics3 이미지 프로세서는 _call(images, {do_image_splitting, ...}) 만
   받습니다. size / longest_edge 를 호출 인자로 넘기면 **조용히 무시됩니다**.
   또 기본 size.longest_edge 가 2048이고 업스케일 가드가 없어서, 원본을 미리
   줄여 넣어도 어차피 2048로 늘려 타일을 냅니다 — 즉 이미지를 리사이즈하는
   것만으로는 토큰이 줄지 않습니다.
   그래서 호출 직전에 인스턴스 필드를 직접 갈아끼웁니다. preprocess()가
   매번 this.size 를, 타일 분할이 매번 this.max_image_size 를 다시 읽으므로
   이 방법이 실제로 먹습니다.
   ========================================================================== */

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';
const MODEL_ID = 'HuggingFaceTB/SmolVLM-256M-Instruct';
const MAX_NEW = 48;
const FALLBACK_IMAGE_TOKEN_ID = 49190;

/* WebGPU에서 shader-f16 이 되면 q4f16(≈160MB), 아니면 int8(≈260MB).
   wasm 백엔드는 f16 경로가 없으므로 항상 int8. */
const DTYPE_F16 = {
  embed_tokens: 'int8',            /* q4 계열로 지정해도 파일이 안 줄어듭니다 */
  vision_encoder: 'q4f16',
  decoder_model_merged: 'q4f16'
};
const DTYPE_INT8 = {
  embed_tokens: 'int8',
  vision_encoder: 'int8',
  decoder_model_merged: 'int8'
};

export function createEngine(post) {
  let lib = null, processor = null, model = null, imageTokenId = FALLBACK_IMAGE_TOKEN_ID;

  async function load(msg) {
    lib = await import(/* @vite-ignore */ CDN);
    const { AutoProcessor, AutoModelForVision2Seq } = lib;

    const device = msg.device === 'wasm' ? 'wasm' : 'webgpu';
    const dtype = (device === 'webgpu' && msg.f16) ? DTYPE_F16 : DTYPE_INT8;

    const progress_callback = (p) => {
      if (!p || !p.file) return;
      post({
        type: 'progress',
        status: p.status,
        file: p.file,
        /* transformers.js 는 0~100 으로 줍니다 */
        pct: typeof p.progress === 'number' ? p.progress : null,
        loaded: p.loaded || 0,
        total: p.total || 0
      });
    };

    post({ type: 'stage', text: '프로세서 설정을 가져오는 중…' });
    processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });

    post({ type: 'stage', text: '가중치를 내려받는 중… (첫 방문만)' });
    model = await AutoModelForVision2Seq.from_pretrained(MODEL_ID, {
      device, dtype, progress_callback
    });

    if (model.config && typeof model.config.image_token_id === 'number') {
      imageTokenId = model.config.image_token_id;
    }
    post({ type: 'ready', device, dtype: (device === 'webgpu' && msg.f16) ? 'q4f16' : 'int8' });
  }

  async function run(msg) {
    const { RawImage, TextStreamer } = lib;
    const image = await RawImage.fromBlob(msg.blob);

    /* ── 해상도 노브 ── 호출 인자가 아니라 인스턴스 필드를 바꿔야 먹습니다 */
    const ip = processor.image_processor;
    ip.size = { longest_edge: msg.longestEdge };
    ip.max_image_size = { longest_edge: msg.tile || 512 };
    ip.do_image_splitting = true;

    const messages = [{
      role: 'user',
      content: [{ type: 'image' }, { type: 'text', text: msg.prompt }]
    }];
    const text = processor.apply_chat_template(messages, { add_generation_prompt: true });
    const inputs = await processor(text, [image]);

    const promptLen = inputs.input_ids.dims[1];
    let imageTokens = 0;
    const ids = inputs.input_ids.data;
    for (let i = 0; i < ids.length; i++) {
      if (Number(ids[i]) === imageTokenId) imageTokens++;
    }
    /* pixel_values: [batch, patches, ch, h, w] — 실제로 잘린 타일 수 */
    const pv = inputs.pixel_values && inputs.pixel_values.dims;
    const patches = pv && pv.length >= 2 ? pv[1] : null;
    const tileSide = pv && pv.length >= 5 ? pv[pv.length - 1] : null;

    post({
      type: 'prepared',
      key: msg.key, promptLen, imageTokens, patches, tileSide,
      srcW: image.width, srcH: image.height
    });

    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk) => post({ type: 'token', key: msg.key, text: chunk })
    });

    const t0 = performance.now();
    const out = await model.generate({
      ...inputs,
      max_new_tokens: MAX_NEW,
      do_sample: false,
      repetition_penalty: 1.1,
      streamer
    });
    const ms = performance.now() - t0;

    /* generate 결과에는 프롬프트가 그대로 붙어 있습니다 */
    const trimmed = out.slice(null, [promptLen, null]);
    const answer = processor.batch_decode(trimmed, { skip_special_tokens: true })[0] || '';
    const newTokens = out.dims[1] - promptLen;

    post({
      type: 'result',
      key: msg.key,
      promptLen, imageTokens, patches, tileSide,
      newTokens, ms,
      answer: answer.trim(),
      tps: newTokens > 0 ? (newTokens / (ms / 1000)) : 0
    });
  }

  return {
    async handle(msg) {
      try {
        if (msg.type === 'load') await load(msg);
        else if (msg.type === 'run') await run(msg);
      } catch (err) {
        post({
          type: 'error',
          phase: msg && msg.type,
          key: msg && msg.key,
          message: (err && (err.message || String(err))) || '알 수 없는 오류'
        });
      }
    }
  };
}

/* 워커로 로드되었을 때만 자기 자신을 배선합니다 */
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  const engine = createEngine((m) => self.postMessage(m));
  self.onmessage = (e) => engine.handle(e.data);
}
