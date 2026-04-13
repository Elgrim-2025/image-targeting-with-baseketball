/**
 * chromakey.js
 * - Android : assets/output-01.webm (알파채널 내장, 크로마키 없음)
 * - iOS/기타: assets/t-final.mp4    (크로마키 셰이더 적용)
 *
 * 이미지 트래킹: assets/image-targets/t-Sample.json 을 XrController에 주입
 */

// ── 이미지 타겟 데이터 주입 ────────────────────────────────────────────────────
// bundle.js 가 xrloaded 에서 XrController.configure({imageTargetData:[]}) 를 호출하기 전에
// configure 를 가로채 컴파일된 타겟 데이터를 넣어준다.
(function () {
  'use strict';

  var targetDataPromise = fetch('./assets/image-targets/t-Sample.json')
    .then(function (r) { return r.json(); })
    .catch(function (e) { console.error('[ImageTarget] JSON 로드 실패:', e); return null; });

  function interceptConfigure() {
    if (!window.XR8 || !XR8.XrController) return;

    var _orig = XR8.XrController.configure.bind(XR8.XrController);

    XR8.XrController.configure = function (opts) {
      opts = opts || {};
      targetDataPromise.then(function (data) {
        if (data) {
          opts.imageTargetData = [data];
          console.log('[ImageTarget] imageTargetData 주입 완료:', data.name);
        }
        _orig(opts);
      });
    };

    console.log('[ImageTarget] XrController.configure 인터셉트 완료');
  }

  if (window.XR8 && XR8.XrController) {
    interceptConfigure();
  } else {
    window.addEventListener('xrloaded', interceptConfigure);
  }
})();
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ═══════════════════ 설정값 ══════════════════════════════════════
  var KEY_R      = 0.0;   // 크로마키 색상 R (초록 배경: G=1, 나머지=0)
  var KEY_G      = 1.0;
  var KEY_B      = 0.0;
  var SIMILARITY = 0.35;  // 제거 강도
  var SMOOTHNESS = 0.08;  // 가장자리 부드러움
  // ═════════════════════════════════════════════════════════════════

  var IS_ANDROID = /Android/i.test(navigator.userAgent);

  console.log('[CK] 플랫폼:', IS_ANDROID ? 'Android → WebM 알파' : 'iOS/기타 → MP4 크로마키');

  // ── GLSL 셰이더 (iOS/기타용) ──────────────────────────────────────
  var vertSrc = [
    'varying vec2 vUv;',
    'void main(){',
    '  vUv=uv;',
    '  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);',
    '}'
  ].join('\n');

  var fragSrc = [
    'precision mediump float;',
    'uniform sampler2D map;',
    'uniform vec3 keyColor;',
    'uniform float similarity;',
    'uniform float smoothness;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec4 c=texture2D(map,vUv);',
    '  float Y1=0.299*keyColor.r+0.587*keyColor.g+0.114*keyColor.b;',
    '  float Cr1=keyColor.r-Y1; float Cb1=keyColor.b-Y1;',
    '  float Y2=0.299*c.r+0.587*c.g+0.114*c.b;',
    '  float Cr2=c.r-Y2; float Cb2=c.b-Y2;',
    '  float d=sqrt((Cr2-Cr1)*(Cr2-Cr1)+(Cb2-Cb1)*(Cb2-Cb1));',
    '  float a=smoothstep(similarity,similarity+smoothness,d);',
    '  gl_FragColor=vec4(c.rgb,a);',
    '}'
  ].join('\n');

  var applied = false;

  // ── 안드로이드: 비디오 src를 output-01.webm으로 교체 ─────────────
  function swapToWebM(vid) {
    // src 추출 (여러 방식 대응)
    var src = vid.src || vid.currentSrc || '';
    if (!src && vid.children.length) {
      src = vid.children[0].src || vid.children[0].getAttribute('src') || '';
    }
    if (!src) { console.warn('[CK] video src 없음, WebM 교체 건너뜀'); return; }

    // 경로에서 파일명만 교체
    var webmSrc = src.replace(/[^/?#]*\.mp4([?#].*)?$/i, 'output-01.webm');
    if (webmSrc === src) { console.log('[CK] 교체 불필요:', src); return; }

    console.log('[CK] WebM 교체:', webmSrc);
    vid.src  = webmSrc;
    vid.load();
  }

  // ── 메인: 씬 탐색 → VideoTexture 생성 → 재질 교체 ───────────────
  function applyToScene() {
    if (applied) return;
    if (!window.THREE || !window.XR8 || !XR8.Threejs) return;

    var xrData = XR8.Threejs.xrScene();
    if (!xrData || !xrData.scene) return;

    xrData.scene.traverse(function (obj) {
      if (applied || !obj.isMesh) return;

      var mat = obj.material;
      if (!mat || !mat.map) return;
      if (!(mat.map.image instanceof HTMLVideoElement)) return;

      var vid        = mat.map.image;
      vid.loop       = true;
      vid.muted      = true;
      vid.playsInline = true;

      // ① 즉시 정지 — 이미지 인식 전까지 재생 금지
      vid.pause();
      vid.currentTime = 0;

      // ② Android면 WebM으로 소스 교체
      if (IS_ANDROID) swapToWebM(vid);

      // ② 핵심 수정: 새 THREE.VideoTexture 생성 (매 프레임 자동 갱신)
      var vTex        = new THREE.VideoTexture(vid);
      vTex.minFilter  = THREE.LinearFilter;
      vTex.magFilter  = THREE.LinearFilter;
      vTex.generateMipmaps = false;

      var newMat;

      if (IS_ANDROID) {
        // Android: WebM 알파채널 → 기본 재질 (크로마키 불필요)
        newMat = new THREE.MeshBasicMaterial({
          map:         vTex,
          transparent: true,
          side:        THREE.DoubleSide,
          depthWrite:  false
        });
        console.log('[CK] Android: MeshBasicMaterial + WebM 알파 ✓');
      } else {
        // iOS: 크로마키 ShaderMaterial
        newMat = new THREE.ShaderMaterial({
          uniforms: {
            map:        { value: vTex },
            keyColor:   { value: new THREE.Color(KEY_R, KEY_G, KEY_B) },
            similarity: { value: SIMILARITY },
            smoothness: { value: SMOOTHNESS }
          },
          vertexShader:   vertSrc,
          fragmentShader: fragSrc,
          transparent:    true,
          side:           THREE.DoubleSide,
          depthWrite:     false
        });
        console.log('[CK] iOS: 크로마키 ShaderMaterial ✓');
      }

      mat.dispose();
      obj.material = newMat;
      applied = true;
    });
  }

  // ── 씬 준비까지 0.5초 간격으로 최대 30초 재시도 ─────────────────
  function startRetry() {
    var n = 0;
    var id = setInterval(function () {
      applyToScene();
      // 셰이더 적용 전후 모두 — 인식 전 영상이 흘러나오지 않도록 강제 정지
      var vid = findVideo();
      if (vid && !vid.paused) vid.pause();
      if (applied || ++n >= 60) clearInterval(id);
    }, 500);
  }

  // ── 비디오 엘리먼트 탐색 (이벤트 핸들러용) ──────────────────────
  function findVideo() {
    if (!window.XR8 || !XR8.Threejs) return null;
    var xrData = XR8.Threejs.xrScene();
    if (!xrData || !xrData.scene) return null;
    var v = null;
    xrData.scene.traverse(function (obj) {
      if (v || !obj.isMesh || !obj.material) return;
      var m = obj.material;
      if (m.map && m.map.image instanceof HTMLVideoElement)
        v = m.map.image;
      else if (m.uniforms && m.uniforms.map &&
               m.uniforms.map.value &&
               m.uniforms.map.value.image instanceof HTMLVideoElement)
        v = m.uniforms.map.value.image;
    });
    return v;
  }

  // ── 이미지 타겟 발견 → 재생 ─────────────────────────────────────
  window.addEventListener('xrimagefound', function (e) {
    console.log('[CK] 이미지 발견:', e && e.detail && e.detail.name);
    applyToScene();
    var vid = findVideo();
    if (vid) { vid.currentTime = 0; vid.play().catch(function(){}); }
  });

  // ── 이미지 타겟 소실 → 정지 ────────────────────────────────────
  window.addEventListener('xrimagelost', function () {
    console.log('[CK] 이미지 소실');
    var vid = findVideo();
    if (vid) vid.pause();
  });

  // ── 진입점 ──────────────────────────────────────────────────────
  if (window.XR8) { startRetry(); }
  else { window.addEventListener('xrloaded', startRetry); }

})();
