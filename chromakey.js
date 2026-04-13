// ── 1) 이미지 타겟 데이터 주입 ───────────────────────────────────────────────
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

// ── 2) 크로마키 셰이더 ──────────────────────────────────────────────────────
(function () {
  'use strict';

  // ══ 설정값 ══════════════════════════════════════════════════════
  var KEY_R      = 0.0;
  var KEY_G      = 1.0;
  var KEY_B      = 0.0;
  var SIMILARITY = 0.35;
  var SMOOTHNESS = 0.08;
  // ════════════════════════════════════════════════════════════════

  // bundle.js 씬 데이터의 plane 엔티티 ID (이걸로 메시를 확실하게 찾음)
  var PLANE_EID = 'ac088bbe-c677-4fc2-96a3-ed1601dd1df5';

  var vertSrc =
    'varying vec2 vUv;' +
    'void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';

  var fragSrc =
    'precision mediump float;' +
    'uniform sampler2D map;' +
    'uniform vec3 keyColor;' +
    'uniform float similarity;' +
    'uniform float smoothness;' +
    'varying vec2 vUv;' +
    'void main(){' +
    '  vec4 c=texture2D(map,vUv);' +
    '  float Y1=0.299*keyColor.r+0.587*keyColor.g+0.114*keyColor.b;' +
    '  float Cr1=keyColor.r-Y1;float Cb1=keyColor.b-Y1;' +
    '  float Y2=0.299*c.r+0.587*c.g+0.114*c.b;' +
    '  float Cr2=c.r-Y2;float Cb2=c.b-Y2;' +
    '  float d=sqrt((Cr2-Cr1)*(Cr2-Cr1)+(Cb2-Cb1)*(Cb2-Cb1));' +
    '  gl_FragColor=vec4(c.rgb,smoothstep(similarity,similarity+smoothness,d));' +
    '}';

  var applied = false;
  var planeMesh = null;

  function getScene() {
    if (!window.XR8) return null;
    if (XR8.CloudStudioThreejs && XR8.CloudStudioThreejs.xrScene)
      return XR8.CloudStudioThreejs.xrScene();
    if (XR8.Threejs && XR8.Threejs.xrScene)
      return XR8.Threejs.xrScene();
    return null;
  }

  // ── 플레인 메시 탐색 (eid 우선, 폴백으로 VideoTexture 보유 메시) ─
  function findPlaneMesh() {
    if (planeMesh) return planeMesh;
    var xr = getScene();
    if (!xr || !xr.scene) return null;

    var found = null;
    xr.scene.traverse(function (obj) {
      if (found || !obj.isMesh) return;

      // 1순위: 엔티티 ID 매칭
      if (obj.userData && obj.userData.eid === PLANE_EID) {
        found = obj;
        console.log('[CK] 플레인 메시 발견 (eid 매칭)');
        return;
      }

      // 2순위: video 텍스처 보유 메시
      var mat = obj.material;
      if (mat && mat.map && mat.map.image instanceof HTMLVideoElement) {
        found = obj;
        console.log('[CK] 플레인 메시 발견 (VideoTexture 매칭)');
      }
    });

    planeMesh = found;
    return found;
  }

  // ── 크로마키 셰이더 적용 ───────────────────────────────────────
  function applyShader() {
    if (applied) return;
    if (!window.THREE) return;

    var obj = findPlaneMesh();
    if (!obj) return;

    var mat = obj.material;

    // 비디오 텍스처가 아직 로드되지 않았으면 재시도
    if (!mat || !mat.map || !mat.map.image) {
      console.log('[CK] 비디오 텍스처 대기 중...');
      return;
    }

    var vid = mat.map.image;

    // 씬 로드 시 자동재생 즉시 차단
    vid.pause();
    vid.currentTime = 0;

    // VideoTexture 새로 생성 (매 프레임 자동 갱신 보장)
    var vTex = new THREE.VideoTexture(vid);
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
    console.log('[CK] 크로마키 셰이더 적용 완료 ✓');
  }

  // ── Camera Pipeline Module ─────────────────────────────────────
  function registerPipeline() {
    XR8.addCameraPipelineModules([{
      name: 'chromakey',

      listeners: [
        {
          event: 'reality.imagefound',
          process: function (e) {
            console.log('[CK] 이미지 인식:', e && e.detail && e.detail.name);
            applyShader();
            var obj = findPlaneMesh();
            if (obj && obj.material && obj.material.uniforms) {
              var vid = obj.material.uniforms.map.value.image;
              vid.loop = true;
              vid.muted = false;
              vid.play().catch(function () {});
            }
          }
        },
        {
          event: 'reality.imageupdated',
          process: function () { applyShader(); }
        },
        {
          event: 'reality.imagelost',
          process: function () {
            // 인식 소실돼도 영상 계속 재생 (루프)
          }
        }
      ],

      onStart: function () {
        console.log('[CK] pipeline onStart');
        // 씬 준비까지 주기적으로 재시도
        var n = 0;
        var id = setInterval(function () {
          applyShader();
          if (applied || ++n >= 120) {
            clearInterval(id);
            if (!applied) console.warn('[CK] 60초 내 셰이더 적용 실패 — 콘솔 확인 필요');
          }
        }, 500);
      }
    }]);
    console.log('[CK] pipeline 등록 완료');
  }

  if (window.XR8) { registerPipeline(); }
  else { window.addEventListener('xrloaded', registerPipeline); }

})();
