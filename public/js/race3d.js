// ── 3D Horse Racing Engine — Oval Track ──────────────────────────────────

const Race3D = (() => {
  let scene, camera, renderer, animFrameId;
  let horses3d = [];
  let container = null;
  let initialized = false;

  // Track dimensions
  const STRAIGHT = 70;
  const RADIUS = 28;
  const TRACK_W = 20;

  // Pre-computed track points for the oval
  let trackPoints = [];
  let trackTangents = [];
  const TRACK_SEGMENTS = 400;

  function buildTrack() {
    trackPoints = [];
    trackTangents = [];

    for (let i = 0; i <= TRACK_SEGMENTS; i++) {
      const t = i / TRACK_SEGMENTS;
      const totalPerimeter = 2 * STRAIGHT + 2 * Math.PI * RADIUS;
      let d = t * totalPerimeter;

      let x, z, tx, tz;

      if (d < STRAIGHT) {
        // Bottom straight (left to right)
        x = -STRAIGHT / 2 + d;
        z = RADIUS;
        tx = 1; tz = 0;
      } else if (d < STRAIGHT + Math.PI * RADIUS) {
        // Right turn
        const angle = (d - STRAIGHT) / RADIUS - Math.PI / 2;
        x = STRAIGHT / 2 + Math.cos(angle) * RADIUS;
        z = Math.sin(angle) * RADIUS;
        tx = -Math.sin(angle); tz = Math.cos(angle);
      } else if (d < 2 * STRAIGHT + Math.PI * RADIUS) {
        // Top straight (right to left)
        const along = d - STRAIGHT - Math.PI * RADIUS;
        x = STRAIGHT / 2 - along;
        z = -RADIUS;
        tx = -1; tz = 0;
      } else {
        // Left turn
        const angle = (d - 2 * STRAIGHT - Math.PI * RADIUS) / RADIUS + Math.PI / 2;
        x = -STRAIGHT / 2 + Math.cos(angle) * RADIUS;
        z = Math.sin(angle) * RADIUS;
        tx = -Math.sin(angle); tz = Math.cos(angle);
      }

      trackPoints.push({ x, z });
      const len = Math.sqrt(tx * tx + tz * tz) || 1;
      trackTangents.push({ x: tx / len, z: tz / len });
    }
  }

  function getTrackPos(t, laneOffset) {
    const idx = Math.floor(((t % 1) + 1) % 1 * TRACK_SEGMENTS);
    const safeIdx = Math.max(0, Math.min(TRACK_SEGMENTS, idx));
    const pt = trackPoints[safeIdx];
    const tan = trackTangents[safeIdx];
    // Normal = perpendicular to tangent
    return {
      x: pt.x + (-tan.z) * laneOffset,
      z: pt.z + tan.x * laneOffset,
      tx: tan.x,
      tz: tan.z,
    };
  }

  function init(containerEl) {
    if (initialized) dispose();
    container = containerEl;
    const w = container.clientWidth;
    const h = container.clientHeight;

    buildTrack();

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x99bbdd, 0.0025);

    camera = new THREE.PerspectiveCamera(45, w / h, 0.5, 600);
    camera.position.set(0, 50, 80);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.setClearColor(0x99bbdd);
    container.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff8e0, 0.9);
    sun.position.set(60, 100, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    scene.add(sun);

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshLambertMaterial({ color: 0x3a8a2a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // Draw dirt track
    for (let i = 0; i < TRACK_SEGMENTS; i++) {
      const a = getTrackPos(i / TRACK_SEGMENTS, -TRACK_W / 2);
      const b = getTrackPos(i / TRACK_SEGMENTS, TRACK_W / 2);
      const c = getTrackPos((i + 1) / TRACK_SEGMENTS, -TRACK_W / 2);
      const d2 = getTrackPos((i + 1) / TRACK_SEGMENTS, TRACK_W / 2);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        a.x, 0.01, a.z, b.x, 0.01, b.z, c.x, 0.01, c.z,
        b.x, 0.01, b.z, d2.x, 0.01, d2.z, c.x, 0.01, c.z,
      ]), 3));
      geo.computeVertexNormals();
      const shade = 0.55 + Math.sin(i * 0.15) * 0.03;
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(shade * 0.6, shade * 0.42, shade * 0.22)
      });
      scene.add(new THREE.Mesh(geo, mat));
    }

    // Inner rail + outer rail
    addRail(-TRACK_W / 2 - 0.3);
    addRail(TRACK_W / 2 + 0.3);

    // Finish post + line
    const fp = getTrackPos(0, TRACK_W / 2 + 1.5);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 7),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    post.position.set(fp.x, 3.5, fp.z);
    scene.add(post);

    // Checkered finish squares on ground
    for (let j = 0; j < 8; j++) {
      const lanePos = -TRACK_W / 2 + (j + 0.5) * (TRACK_W / 8);
      const p = getTrackPos(0, lanePos);
      const sq = new THREE.Mesh(
        new THREE.PlaneGeometry(1, TRACK_W / 8),
        new THREE.MeshBasicMaterial({ color: j % 2 === 0 ? 0xffffff : 0x111111 })
      );
      sq.rotation.x = -Math.PI / 2;
      sq.position.set(p.x, 0.02, p.z);
      scene.add(sq);
    }

    // Starting gate
    const gateGroup = new THREE.Group();
    gateGroup.name = 'startingGate';
    const gateMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    for (let lane = -TRACK_W / 2 + 1; lane <= TRACK_W / 2 - 1; lane += 1.5) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3, 0.08), gateMat);
      const p = getTrackPos(0.96, lane);
      bar.position.set(p.x, 1.5, p.z);
      gateGroup.add(bar);
    }
    const beamP1 = getTrackPos(0.96, -TRACK_W / 2);
    const beamP2 = getTrackPos(0.96, TRACK_W / 2);
    const beamLen = Math.sqrt((beamP2.x - beamP1.x) ** 2 + (beamP2.z - beamP1.z) ** 2);
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.15, beamLen),
      gateMat
    );
    beam.position.set((beamP1.x + beamP2.x) / 2, 3, (beamP1.z + beamP2.z) / 2);
    beam.lookAt(beamP2.x, 3, beamP2.z);
    gateGroup.add(beam);
    scene.add(gateGroup);

    initialized = true;
  }

  function addRail(laneOffset) {
    const pts = [];
    for (let i = 0; i <= TRACK_SEGMENTS; i++) {
      const p = getTrackPos(i / TRACK_SEGMENTS, laneOffset);
      pts.push(new THREE.Vector3(p.x, 0.8, p.z));
    }
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    ));
    for (let i = 0; i < pts.length; i += 8) {
      const p = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 1),
        new THREE.MeshLambertMaterial({ color: 0xdddddd })
      );
      p.position.set(pts[i].x, 0.5, pts[i].z);
      scene.add(p);
    }
  }

  function createHorse(color, laneIndex, totalLanes) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);
    const bodyMat = new THREE.MeshLambertMaterial({ color: col });
    const legMat = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.6) });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 0.7), bodyMat);
    body.position.y = 1.6; body.castShadow = true;
    group.add(body);

    // Neck + head
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.4), bodyMat);
    neck.position.set(1.4, 2.2, 0); neck.rotation.z = -0.5;
    group.add(neck);

    // Legs
    const legs = [];
    [[-0.6, 0.25], [-0.6, -0.25], [0.6, 0.25], [0.6, -0.25]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 1.3), legMat);
      leg.position.set(x, 0.75, z); leg.castShadow = true;
      group.add(leg); legs.push(leg);
    });

    // Jockey
    const jockey = new THREE.Mesh(
      new THREE.SphereGeometry(0.22),
      new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(1.5) })
    );
    jockey.position.set(0, 2.3, 0);
    group.add(jockey);

    // Lane position across track width
    const laneW = TRACK_W - 4;
    group._laneOffset = -laneW / 2 + (laneIndex / Math.max(totalLanes - 1, 1)) * laneW;
    group._legs = legs;
    group._gallopPhase = Math.random() * Math.PI * 2;
    group._trackT = 0.96;
    scene.add(group);
    return group;
  }

  function updateHorses(horsesData, phase) {
    while (horses3d.length < horsesData.length) {
      const i = horses3d.length;
      horses3d.push(createHorse(horsesData[i].color, i, horsesData.length));
    }
    while (horses3d.length > horsesData.length) {
      scene.remove(horses3d.pop());
    }

    const isRacing = phase === 'racing';
    let leadT = 0.96;
    let leadIdx = 0;

    horsesData.forEach((hd, i) => {
      const h3d = horses3d[i];
      if (hd.scratched) { h3d.visible = false; return; }

      // Map position 0-100 to track t: 0.96 → 0.96+1 (full lap)
      const pos = hd.position || 0;
      const targetT = 0.96 + (pos / 100);

      if (phase === 'loading' || phase === 'starting') {
        h3d._trackT = 0.96;
        h3d.visible = phase === 'starting' || !!hd.gateLoaded;
      } else {
        // Smooth interpolation
        h3d._trackT += (targetT - h3d._trackT) * 0.2;
        h3d.visible = true;
      }

      if (h3d._trackT > leadT) { leadT = h3d._trackT; leadIdx = i; }

      // Position on track
      const tNorm = ((h3d._trackT % 1) + 1) % 1;
      const p = getTrackPos(tNorm, h3d._laneOffset);
      const nextT = ((tNorm + 0.003) % 1 + 1) % 1;
      const pNext = getTrackPos(nextT, h3d._laneOffset);

      h3d.position.x = p.x;
      h3d.position.z = p.z;

      // Face direction of travel
      const dx = pNext.x - p.x;
      const dz = pNext.z - p.z;
      if (dx !== 0 || dz !== 0) {
        h3d.rotation.y = Math.atan2(dx, dz);
      }

      // Gallop animation
      if (isRacing) {
        h3d._gallopPhase += 0.3;
        const gp = h3d._gallopPhase;
        h3d.position.y = Math.abs(Math.sin(gp * 2)) * 0.1;
        h3d._legs.forEach((leg, li) => {
          const off = li < 2 ? 0 : Math.PI;
          leg.rotation.x = Math.sin(gp + off) * 0.45;
        });
      } else {
        h3d.position.y = 0;
      }
    });

    // Camera
    if (isRacing || phase === 'result') {
      const leadH = horses3d[leadIdx];
      if (leadH) {
        // Camera behind and to the side of the leader
        const tNorm = ((leadH._trackT % 1) + 1) % 1;
        const behindT = ((tNorm - 0.06) % 1 + 1) % 1;
        const camPos = getTrackPos(behindT, TRACK_W + 12);
        const lookPos = getTrackPos(((tNorm + 0.03) % 1 + 1) % 1, 0);

        camera.position.x += (camPos.x - camera.position.x) * 0.06;
        camera.position.z += (camPos.z - camera.position.z) * 0.06;
        camera.position.y += (15 - camera.position.y) * 0.05;
        camera.lookAt(lookPos.x, 1, lookPos.z);
      }
    } else {
      // Gate view
      const gp = getTrackPos(0.96, TRACK_W / 2 + 12);
      const gl = getTrackPos(0.96, 0);
      camera.position.set(gp.x, 8, gp.z);
      camera.lookAt(gl.x, 1.5, gl.z);
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
      try { container.removeChild(renderer.domElement); } catch (e) {}
      renderer.dispose();
    }
    horses3d = [];
    scene = null; camera = null; renderer = null;
    trackPoints = []; trackTangents = [];
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
