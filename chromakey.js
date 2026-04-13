// ── 1) 이미지 타겟 데이터 주입 ───────────────────────────────────────────────
// bundle.js가 xrloaded에서 XrController.configure({imageTargetData:[]}) 호출 전에
// 가로채서 컴파일된 타겟 데이터를 넣어준다.
(function () {
  var dataPromise = fetch('./assets/image-targets/t-Sample.json')
    .then(function (r) { return r.json(); })
    .catch(function (e) { console.error('[IT] JSON 로드 실패:', e); return null; });

  function intercept() {
    var orig = XR8.XrController.configure.bind(XR8.XrController);
    XR8.XrController.configure = function (opts) {
      opts = opts || {};
      dataPromise.then(function (data) {
        if (data) { opts.imageTargetData = [data]; console.log('[IT] 타겟 주입:', data.name); }
        orig(opts);
      });
    };
  }

  if (window.XR8) { intercept(); }
  else { window.addEventListener('xrloaded', intercept); }
})();

// ── 2) 크로마키 셰이더 + 이미지 인식 이벤트 ────────────────────────────────
(function () {
  'use strict';

  // ══ 설정값 ══════════════════════════════════════════════════════
  var KEY_R      = 0.0;   // 키 색상 (초록: G=1, 나머지=0)
  var KEY_G      = 1.0;
  var KEY_B      = 0.0;
  var SIMILARITY = 0.35;
  var SMOOTHNESS = 0.08;
  // ════════════════════════════════════════════════════════════════

  var vertSrc = [
    'varying vec2 vUv;',
    'void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'
  ].join('');

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
    '  gl_FragColor=vec4(c.rgb,smoothstep(similarity,similarity+smoothness,d));',
    '}'
  ].join('');

  var applied = false;
  var videoEl = null; // 발견한 비디오 엘리먼트 캐시

  // ── Three.js 씬 가져오기 (ECS는 CloudStudioThreejs 사용) ─────────
  function getScene() {
    if (window.XR8) {
      if (XR8.CloudStudioThreejs && XR8.CloudStudioThreejs.xrScene)
        return XR8.CloudStudioThreejs.xrScene();
      if (XR8.Threejs && XR8.Threejs.xrScene)
        return XR8.Threejs.xrScene();
    }
    return null;
  }

  // ── 셰이더 적용 ────────────────────────────────────────────────
  function applyShader() {
    if (applied) return;
    if (!window.THREE) return;
    var xr = getScene();
    if (!xr || !xr.scene) return;

    xr.scene.traverse(function (obj) {
      if (applied || !obj.isMesh) return;
      var mat = obj.material;
      if (!mat || !mat.map) return;
      if (!(mat.map.image instanceof HTMLVideoElement)) return;

      videoEl           = mat.map.image;
      videoEl.loop      = true;
      videoEl.muted     = true;
      videoEl.playsInline = true;
      videoEl.pause();
      videoEl.currentTime = 0;

      // 새 VideoTexture — 매 프레임 자동 갱신
      var vTex = new THREE.VideoTexture(videoEl);
      vTex.minFilter = THREE.LinearFilter;
      vTex.magFilter = THREE.LinearFilter;
      vTex.generateMipmaps = false;

      var newMat = new THREE.ShaderMaterial({
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

      mat.dispose();
      obj.material = newMat;
      applied = true;
      console.log('[CK] 크로마키 셰이더 적용 ✓');
    });
  }

  // ── 비디오 DOM 탐색 폴백 (씬 traversal 실패 시) ─────────────────
  function findVideoFromDOM() {
    if (videoEl) return videoEl;
    var vids = document.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      // 카메라 피드(xr-canvas용)가 아닌 컨텐츠 영상 찾기
      if (v.src && (v.src.indexOf('.mp4') > -1 || v.src.indexOf('blob') > -1)) {
        videoEl = v;
        return v;
      }
    }
    return null;
  }

  // ── 이미지 인식됨 ───────────────────────────────────────────────
  function onImageFound() {
    console.log('[CK] 이미지 인식!');
    applyShader();
    var vid = videoEl || findVideoFromDOM();
    if (vid) {
      vid.currentTime = 0;
      vid.play().catch(function (e) { console.warn('[CK] play() 실패:', e.message); });
    }
  }

  // ── 이미지 소실 ────────────────────────────────────────────────
  function onImageLost() {
    console.log('[CK] 이미지 소실');
    var vid = videoEl || findVideoFromDOM();
    if (vid) vid.pause();
  }

  // ── Camera Pipeline Module 등록 (xrloaded 이후, XR8.run() 이전) ─
  function registerPipeline() {
    XR8.addCameraPipelineModules([{
      name: 'chromakey',
      listeners: [
        { event: 'reality.imagefound',   process: onImageFound },
        { event: 'reality.imageupdated', process: onImageFound },
        { event: 'reality.imagelost',    process: onImageLost  }
      ],
      onStart: function () {
        // 씬이 준비되면 셰이더 적용 시도
        var n = 0;
        var id = setInterval(function () {
          applyShader();
          if (applied || ++n >= 60) clearInterval(id);
        }, 500);
      }
    }]);
    console.log('[CK] pipeline module 등록 완료');
  }

  if (window.XR8) { registerPipeline(); }
  else { window.addEventListener('xrloaded', registerPipeline); }

})();
