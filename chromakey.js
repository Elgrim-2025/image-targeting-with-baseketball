/**
 * chromakey.js
 * 8th Wall ECS용 크로마키 셰이더 + 플랫폼별 영상 포맷 분기
 *
 * ┌──────────────┬────────────────────────────────────────────────┐
 * │  Android     │  assets/t-final.webm  사용                      │
 * │              │  → WebM에 알파채널이 있으면 크로마키 불필요       │
 * │              │    WEBM_HAS_ALPHA = true 로 설정하세요           │
 * │  iOS / 기타  │  assets/t-final.mp4   + 크로마키 셰이더          │
 * └──────────────┴────────────────────────────────────────────────┘
 *
 * [파일 준비]
 *   assets/t-final.mp4   ← 기존 크로마키 MP4
 *   assets/t-final.webm  ← 안드로이드용 WebM (새로 추가)
 */
(function () {
  'use strict';

  // ═══════════════════════ 설정값 ═══════════════════════════════════════════
  var WEBM_HAS_ALPHA = true;   // true  → 안드로이드에서 크로마키 없이 WebM 알파 사용
                               // false → 안드로이드도 크로마키 적용

  var KEY_R      = 0.0;   // 키 색상 Red   (0.0 ~ 1.0)
  var KEY_G      = 1.0;   // 키 색상 Green ← 초록 배경 기본값
  var KEY_B      = 0.0;   // 키 색상 Blue

  var SIMILARITY = 0.35;  // 제거 강도 (높을수록 더 많이 제거)
  var SMOOTHNESS = 0.08;  // 가장자리 부드러움
  // ══════════════════════════════════════════════════════════════════════════

  // ── 플랫폼 감지 ────────────────────────────────────────────────────────────
  var IS_ANDROID = /Android/i.test(navigator.userAgent);
  var USE_CHROMA = !(IS_ANDROID && WEBM_HAS_ALPHA); // WebM 알파 사용 시만 false

  console.log('[ChromaKey] 플랫폼:', IS_ANDROID ? 'Android (WebM)' : 'iOS/기타 (MP4)');
  console.log('[ChromaKey] 크로마키 적용:', USE_CHROMA);

  // ── GLSL 셰이더 ────────────────────────────────────────────────────────────
  var vertSrc = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var fragSrc = [
    'precision mediump float;',
    'uniform sampler2D map;',
    'uniform vec3 keyColor;',
    'uniform float similarity;',
    'uniform float smoothness;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec4 col = texture2D(map, vUv);',
    '  // YCbCr 색차 기반 크로마키 (밝기 분리 → 조명에 강인)',
    '  float Y1  = 0.299*keyColor.r + 0.587*keyColor.g + 0.114*keyColor.b;',
    '  float Cr1 = keyColor.r - Y1;',
    '  float Cb1 = keyColor.b - Y1;',
    '  float Y2  = 0.299*col.r + 0.587*col.g + 0.114*col.b;',
    '  float Cr2 = col.r - Y2;',
    '  float Cb2 = col.b - Y2;',
    '  float dist  = sqrt((Cr2-Cr1)*(Cr2-Cr1) + (Cb2-Cb1)*(Cb2-Cb1));',
    '  float alpha = smoothstep(similarity, similarity + smoothness, dist);',
    '  gl_FragColor = vec4(col.rgb, alpha);',
    '}'
  ].join('\n');

  // ── 안드로이드: 비디오 소스를 WebM으로 교체 ──────────────────────────────────
  function swapToWebM(vid) {
    if (!IS_ANDROID) return;

    // src 속성 또는 currentSrc에서 경로 추출
    var src = vid.getAttribute('src') || vid.currentSrc || '';
    if (!src) {
      // <source> 태그 방식일 경우
      var sources = vid.querySelectorAll('source');
      for (var i = 0; i < sources.length; i++) {
        src = sources[i].src || sources[i].getAttribute('src') || '';
        if (src) break;
      }
    }

    if (!src) {
      console.warn('[ChromaKey] 비디오 src를 찾지 못했습니다. WebM 교체 건너뜀.');
      return;
    }

    // 안드로이드 전용 알파 WebM 파일로 교체
    var webmSrc = src.replace(/[^/\\]+\.mp4(\?.*)?$/i, 'output-01.webm');
    if (webmSrc === src) {
      console.log('[ChromaKey] 경로 치환 실패, src:', src);
      return;
    }

    console.log('[ChromaKey] Android WebM 교체:', src, '→', webmSrc);
    vid.src = webmSrc;
    vid.load();
  }

  var shaderApplied = false;

  // ── 메인: 비디오 메시 탐색 → (WebM 교체) → (크로마키 셰이더) 적용 ────────────
  function applyToScene() {
    if (shaderApplied) return;
    if (!window.THREE || !window.XR8 || !XR8.Threejs) return;

    var xrData = XR8.Threejs.xrScene();
    if (!xrData || !xrData.scene) return;

    xrData.scene.traverse(function (obj) {
      if (shaderApplied || !obj.isMesh) return;

      var mat = obj.material;
      if (!mat || !mat.map || !(mat.map.image instanceof HTMLVideoElement)) return;

      var vid = mat.map.image;
      vid.loop        = true;
      vid.muted       = true;
      vid.playsInline = true;

      // 1) 안드로이드면 WebM으로 교체
      swapToWebM(vid);

      // 2) 크로마키 셰이더 교체 (WebM 알파 사용 시 건너뜀)
      if (USE_CHROMA) {
        var newMat = new THREE.ShaderMaterial({
          uniforms: {
            map:        { value: mat.map },
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
        mat.dispose();
        obj.material = newMat;
        console.log('[ChromaKey] 크로마키 셰이더 적용 완료 ✓');
      } else {
        // WebM 알파 채널 사용: 기존 재질에 투명도만 활성화
        mat.transparent = true;
        mat.depthWrite  = false;
        console.log('[ChromaKey] WebM 알파채널 모드 (크로마키 없음) ✓');
      }

      shaderApplied = true;
    });
  }

  // ── 씬 준비까지 최대 30초 재시도 ────────────────────────────────────────────
  function startRetry() {
    var attempts = 0;
    var id = setInterval(function () {
      applyToScene();
      attempts++;
      if (shaderApplied || attempts >= 60) clearInterval(id);
    }, 500);
  }

  // ── 비디오 엘리먼트 탐색 (셰이더 교체 전·후 모두 대응) ────────────────────────
  function findVideo() {
    if (!window.XR8 || !XR8.Threejs) return null;
    var xrData = XR8.Threejs.xrScene();
    if (!xrData || !xrData.scene) return null;

    var found = null;
    xrData.scene.traverse(function (obj) {
      if (found || !obj.isMesh || !obj.material) return;
      var mat = obj.material;
      if (mat.map && mat.map.image instanceof HTMLVideoElement) {
        found = mat.map.image;
      } else if (mat.uniforms && mat.uniforms.map &&
                 mat.uniforms.map.value &&
                 mat.uniforms.map.value.image instanceof HTMLVideoElement) {
        found = mat.uniforms.map.value.image;
      }
    });
    return found;
  }

  // ── 이미지 타겟 발견 → 영상 재생 ────────────────────────────────────────────
  window.addEventListener('xrimagefound', function (e) {
    console.log('[ChromaKey] 이미지 타겟 발견:', e && e.detail && e.detail.name);
    applyToScene();

    var vid = findVideo();
    if (vid) {
      vid.currentTime = 0;
      vid.play().catch(function (err) {
        console.warn('[ChromaKey] 영상 재생 실패:', err);
      });
    }
  });

  // ── 이미지 타겟 소실 → 영상 일시정지 ───────────────────────────────────────
  window.addEventListener('xrimagelost', function () {
    console.log('[ChromaKey] 이미지 타겟 소실');
    var vid = findVideo();
    if (vid) vid.pause();
  });

  // ── 진입점 ───────────────────────────────────────────────────────────────
  if (window.XR8) {
    startRetry();
  } else {
    window.addEventListener('xrloaded', startRetry);
  }
})();
