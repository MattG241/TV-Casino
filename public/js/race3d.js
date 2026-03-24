// ── 3D Horse Racing Engine — Oval Track ──────────────────────────────────

const Race3D = (() => {
  let scene, camera, renderer, animFrameId;
  let horses3d = [];
  let container = null;
  let initialized = false;
  let trackPath = null; // THREE.CurvePath for the oval

  // Track dimensions
  const STRAIGHT = 80;
  const TURN_RADIUS = 30;
  const TRACK_W = 24;
  const LANE_SPACING = 1.8;

  function buildTrackPath() {
    // Oval: bottom straight → right turn → top straight → left turn
    const path = new THREE.CurvePath();
    // Bottom straight (left to right)
    path.add(new THREE.LineCurve3(
      new THREE.Vector3(-STRAIGHT/2, 0, TURN_RADIUS),
      new THREE.Vector3(STRAIGHT/2, 0, TURN_RADIUS)
    ));
    // Right turn (180° arc)
    const rightPts = [];
    for (let a = -Math.PI/2; a <= Math.PI/2; a += Math.PI/20) {
      rightPts.push(new THREE.Vector3(
        STRAIGHT/2 + Math.cos(a) * TURN_RADIUS,
        0,
        Math.sin(a) * TURN_RADIUS
      ));
    }
    for (let i = 0; i < rightPts.length - 1; i++) {
      path.add(new THREE.LineCurve3(rightPts[i], rightPts[i+1]));
    }
    // Top straight (right to left)
    path.add(new THREE.LineCurve3(
      new THREE.Vector3(STRAIGHT/2, 0, -TURN_RADIUS),
      new THREE.Vector3(-STRAIGHT/2, 0, -TURN_RADIUS)
    ));
    // Left turn (180° arc)
    const leftPts = [];
    for (let a = Math.PI/2; a <= 3*Math.PI/2; a += Math.PI/20) {
      leftPts.push(new THREE.Vector3(
        -STRAIGHT/2 + Math.cos(a) * TURN_RADIUS,
        0,
        Math.sin(a) * TURN_RADIUS
      ));
    }
    for (let i = 0; i < leftPts.length - 1; i++) {
      path.add(new THREE.LineCurve3(leftPts[i], leftPts[i+1]));
    }
    return path;
  }

  function getTrackPoint(t, laneOffset) {
    // t = 0..1 around the track, laneOffset = lateral offset
    const pt = trackPath.getPointAt(t % 1);
    const tan = trackPath.getTangentAt(t % 1).normalize();
    // Normal is perpendicular to tangent on XZ plane
    const normal = new THREE.Vector3(-tan.z, 0, tan.x);
    return pt.clone().add(normal.multiplyScalar(laneOffset));
  }

  function init(containerEl) {
    if (initialized) dispose();
    container = containerEl;
    const w = container.clientWidth;
    const h = container.clientHeight;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x88aacc, 0.003);

    camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 800);
    camera.position.set(0, 60, 90);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x88aacc);
    container.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffeedd, 0.6));
    const sun = new THREE.DirectionalLight(0xfff8e8, 1.0);
    sun.position.set(40, 80, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.camera.far = 300;
    scene.add(sun);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x3a7a2a });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // Inner field (darker grass inside the oval)
    const innerGeo = new THREE.CircleGeometry(TURN_RADIUS - 2, 32);
    const innerMat = new THREE.MeshLambertMaterial({ color: 0x2d6a1e });
    // Left inner
    const innerL = new THREE.Mesh(innerGeo, innerMat);
    innerL.rotation.x = -Math.PI / 2;
    innerL.position.set(-STRAIGHT/2, 0.01, 0);
    scene.add(innerL);
    // Right inner
    const innerR = new THREE.Mesh(innerGeo, innerMat);
    innerR.rotation.x = -Math.PI / 2;
    innerR.position.set(STRAIGHT/2, 0.01, 0);
    scene.add(innerR);
    // Inner rectangle
    const innerRect = new THREE.PlaneGeometry(STRAIGHT, (TURN_RADIUS - 2) * 2);
    const innerRectMesh = new THREE.Mesh(innerRect, innerMat);
    innerRectMesh.rotation.x = -Math.PI / 2;
    innerRectMesh.position.set(0, 0.01, 0);
    scene.add(innerRectMesh);

    // Build oval track path
    trackPath = buildTrackPath();

    // Draw the dirt track surface
    const trackPts = [];
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const inner = getTrackPoint(t, -TRACK_W/2);
      const outer = getTrackPoint(t, TRACK_W/2);
      trackPts.push({ inner, outer });
    }
    // Build track as a series of quads
    for (let i = 0; i < trackPts.length - 1; i++) {
      const geo = new THREE.BufferGeometry();
      const a = trackPts[i], b = trackPts[i+1];
      const verts = new Float32Array([
        a.inner.x, 0.02, a.inner.z,
        a.outer.x, 0.02, a.outer.z,
        b.inner.x, 0.02, b.inner.z,
        b.outer.x, 0.02, b.outer.z,
        b.inner.x, 0.02, b.inner.z,
        a.outer.x, 0.02, a.outer.z,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      const shade = 0.65 + Math.sin(i * 0.3) * 0.05;
      const col = new THREE.Color().setRGB(shade * 0.55, shade * 0.38, shade * 0.2);
      const mat = new THREE.MeshLambertMaterial({ color: col });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }

    // Rails (inner and outer)
    buildRail(-TRACK_W/2 - 0.5);
    buildRail(TRACK_W/2 + 0.5);

    // Finish line — at t=0 (start of bottom straight, left side)
    const finishT = 0;
    for (let lane = -TRACK_W/2; lane < TRACK_W/2; lane += TRACK_W/10) {
      const pt = getTrackPoint(finishT, lane + TRACK_W/20);
      const sqGeo = new THREE.PlaneGeometry(1.5, TRACK_W/10);
      const idx = Math.round((lane + TRACK_W/2) / (TRACK_W/10));
      const sqMat = new THREE.MeshBasicMaterial({ color: idx % 2 === 0 ? 0xffffff : 0x111111 });
      const sq = new THREE.Mesh(sqGeo, sqMat);
      sq.rotation.x = -Math.PI / 2;
      sq.position.set(pt.x, 0.03, pt.z);
      scene.add(sq);
    }

    // Finish post
    const postPt = getTrackPoint(finishT, TRACK_W/2 + 2);
    const postGeo = new THREE.CylinderGeometry(0.15, 0.15, 8);
    const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(postPt.x, 4, postPt.z);
    post.castShadow = true;
    scene.add(post);

    // Starting gate at t ≈ 0.97 (just before finish line)
    const gateT = 0.97;
    const gatePt = getTrackPoint(gateT, 0);
    const gateTan = trackPath.getTangentAt(gateT).normalize();
    const gateNorm = new THREE.Vector3(-gateTan.z, 0, gateTan.x);
    const gateGroup = new THREE.Group();
    gateGroup.name = 'startingGate';
    // Gate frame
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    for (let lane = -TRACK_W/2 + 1; lane < TRACK_W/2 - 1; lane += 2) {
      const barGeo = new THREE.BoxGeometry(0.1, 3.5, 0.1);
      const bar = new THREE.Mesh(barGeo, frameMat);
      bar.position.copy(gateNorm.clone().multiplyScalar(lane));
      bar.position.y = 1.75;
      gateGroup.add(bar);
    }
    // Top beam
    const beamGeo = new THREE.BoxGeometry(0.2, 0.2, TRACK_W - 2);
    const beam = new THREE.Mesh(beamGeo, frameMat);
    beam.position.y = 3.5;
    gateGroup.add(beam);
    gateGroup.position.copy(gatePt);
    gateGroup.lookAt(gatePt.clone().add(gateTan));
    scene.add(gateGroup);

    initialized = true;
  }

  function buildRail(laneOffset) {
    const pts = [];
    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const pt = getTrackPoint(i / steps, laneOffset);
      pts.push(new THREE.Vector3(pt.x, 1, pt.z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff })));
    // Posts every few segments
    for (let i = 0; i < pts.length; i += 5) {
      const pGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.2);
      const p = new THREE.Mesh(pGeo, new THREE.MeshLambertMaterial({ color: 0xdddddd }));
      p.position.set(pts[i].x, 0.6, pts[i].z);
      scene.add(p);
    }
  }

  function createHorse(color, laneIndex, totalLanes) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);

    const bodyMat = new THREE.MeshLambertMaterial({ color: col });
    const legMat = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.65) });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.2, 0.9), bodyMat);
    body.position.y = 1.8;
    body.castShadow = true;
    group.add(body);

    // Neck + head
    const neck = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.5), bodyMat);
    neck.position.set(1.6, 2.5, 0);
    neck.rotation.z = -0.5;
    group.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.4), bodyMat);
    head.position.set(2.3, 2.8, 0);
    group.add(head);

    // Legs
    const legs = [];
    [[-0.7,0.3],[-0.7,-0.3],[0.7,0.3],[0.7,-0.3]].forEach(([x,z]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 1.5), legMat);
      leg.position.set(x, 0.9, z);
      leg.castShadow = true;
      group.add(leg);
      legs.push(leg);
    });

    // Jockey
    const jockey = new THREE.Mesh(new THREE.SphereGeometry(0.28), new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(1.4) }));
    jockey.position.set(0, 2.7, 0);
    group.add(jockey);

    // Number cloth
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,64,64);
    ctx.fillStyle = '#000'; ctx.font = 'bold 38px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(laneIndex + 1), 32, 32);
    const numMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) })
    );
    numMesh.position.set(0, 2.1, 0.5);
    group.add(numMesh);

    group._legs = legs;
    group._laneOffset = -TRACK_W/2 + 3 + ((laneIndex) / Math.max(totalLanes-1, 1)) * (TRACK_W - 6);
    group._gallopPhase = Math.random() * Math.PI * 2;
    group._trackT = 0.97; // start at gate position
    scene.add(group);
    return group;
  }

  function updateHorses(horsesData, phase) {
    // Create horses if needed
    while (horses3d.length < horsesData.length) {
      const i = horses3d.length;
      horses3d.push(createHorse(horsesData[i].color, i, horsesData.length));
    }
    while (horses3d.length > horsesData.length) {
      scene.remove(horses3d.pop());
    }

    const isRacing = phase === 'racing';
    let leadT = 0;
    let leadIdx = 0;

    horsesData.forEach((hd, i) => {
      const h3d = horses3d[i];

      // Scratched horses
      if (hd.scratched) { h3d.visible = false; return; }

      // Position: 0-100 maps to 0.97 → 0.97+1.0 (full lap from gate back to gate)
      const pos = hd.position || 0;
      const targetT = 0.97 + (pos / 100);

      if (phase === 'loading' || phase === 'starting') {
        h3d._trackT = 0.97;
        h3d.visible = phase === 'starting' || !!hd.gateLoaded;
      } else {
        h3d._trackT += (targetT - h3d._trackT) * 0.25;
        h3d.visible = true;
      }

      if (h3d._trackT > leadT) { leadT = h3d._trackT; leadIdx = i; }

      // Place horse on track
      const pt = getTrackPoint(h3d._trackT % 1, h3d._laneOffset - TRACK_W/2);
      const nextPt = getTrackPoint((h3d._trackT + 0.005) % 1, h3d._laneOffset - TRACK_W/2);
      h3d.position.set(pt.x, 0, pt.z);
      h3d.lookAt(nextPt.x, 0, nextPt.z);

      // Gallop
      if (isRacing) {
        h3d._gallopPhase += 0.35;
        const gp = h3d._gallopPhase;
        h3d.position.y = Math.sin(gp * 2) * 0.12;
        h3d._legs.forEach((leg, li) => {
          const off = li < 2 ? 0 : Math.PI;
          leg.rotation.x = Math.sin(gp + off) * 0.5;
          leg.position.y = 0.9 + Math.abs(Math.sin(gp + off)) * 0.25;
        });
      }
    });

    // Camera
    if (isRacing || phase === 'result') {
      // Follow lead horse from slightly behind and above
      const leadH = horses3d[leadIdx];
      if (leadH) {
        const behindT = (leadH._trackT - 0.04) % 1;
        const camPt = getTrackPoint(behindT, TRACK_W + 10);
        const targetCam = new THREE.Vector3(camPt.x, 20, camPt.z);
        camera.position.lerp(targetCam, 0.04);
        const lookPt = getTrackPoint((leadH._trackT + 0.02) % 1, 0);
        camera.lookAt(lookPt.x, 1, lookPt.z);
      }
    } else if (phase === 'loading' || phase === 'starting') {
      const gatePt = getTrackPoint(0.97, TRACK_W/2 + 15);
      camera.position.set(gatePt.x, 10, gatePt.z);
      const lookGate = getTrackPoint(0.97, 0);
      camera.lookAt(lookGate.x, 2, lookGate.z);
    }

    // Gate visibility
    const gate = scene.getObjectByName('startingGate');
    if (gate) gate.visible = phase !== 'racing' && phase !== 'result';
  }

  function render() {
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
    animFrameId = requestAnimationFrame(render);
  }

  function dispose() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = null;
    if (renderer && container) {
      try { container.removeChild(renderer.domElement); } catch(e) {}
      renderer.dispose();
    }
    horses3d = [];
    scene = null; camera = null; renderer = null;
    trackPath = null;
    initialized = false;
  }

  function resize() {
    if (!container || !camera || !renderer) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  return {
    init,
    updateHorses,
    startRendering() { if (!animFrameId) render(); },
    stopRendering() { if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; } },
    dispose,
    resize,
    isInitialized() { return initialized; },
  };
})();

window.addEventListener('resize', () => Race3D.resize());
