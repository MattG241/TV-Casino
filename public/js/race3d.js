// ── 3D Horse Racing Engine — Oval Track ──────────────────────────────────

const Race3D = (() => {
  let scene, camera, renderer, animFrameId;
  let horses3d = [];
  let container = null;
  let initialized = false;
  let frameCount = 0;

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
        x = -STRAIGHT / 2 + d;
        z = RADIUS;
        tx = 1; tz = 0;
      } else if (d < STRAIGHT + Math.PI * RADIUS) {
        const angle = (d - STRAIGHT) / RADIUS - Math.PI / 2;
        x = STRAIGHT / 2 + Math.cos(angle) * RADIUS;
        z = Math.sin(angle) * RADIUS;
        tx = -Math.sin(angle); tz = Math.cos(angle);
      } else if (d < 2 * STRAIGHT + Math.PI * RADIUS) {
        const along = d - STRAIGHT - Math.PI * RADIUS;
        x = STRAIGHT / 2 - along;
        z = -RADIUS;
        tx = -1; tz = 0;
      } else {
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
    scene.fog = new THREE.FogExp2(0x99bbdd, 0.002);

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
    frameCount = 0;
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

  // ── Build a more realistic horse model ─────────────────────────────────
  function createHorse(color, laneIndex, totalLanes) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);
    const bodyMat = new THREE.MeshLambertMaterial({ color: col });
    const darkMat = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.5) });
    const skinMat = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.7) });

    // === TORSO — elongated barrel shape ===
    const torso = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      bodyMat
    );
    torso.scale.set(1.6, 0.7, 0.55);
    torso.position.set(0, 1.65, 0);
    torso.castShadow = true;
    group.add(torso);

    // === HINDQUARTERS — larger sphere at back ===
    const hind = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 10, 8),
      bodyMat
    );
    hind.scale.set(1.0, 0.9, 0.8);
    hind.position.set(-1.1, 1.6, 0);
    hind.castShadow = true;
    group.add(hind);

    // === CHEST — sphere at front ===
    const chest = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 10, 8),
      bodyMat
    );
    chest.scale.set(0.8, 1.0, 0.8);
    chest.position.set(1.1, 1.7, 0);
    chest.castShadow = true;
    group.add(chest);

    // === NECK — angled cylinder ===
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.35, 1.2, 8),
      bodyMat
    );
    neck.position.set(1.5, 2.3, 0);
    neck.rotation.z = -0.6;
    neck.castShadow = true;
    group.add(neck);

    // === HEAD — elongated shape ===
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 8),
      bodyMat
    );
    head.scale.set(1.8, 0.9, 0.8);
    head.position.set(2.1, 2.8, 0);
    head.castShadow = true;
    group.add(head);

    // === SNOUT / MUZZLE ===
    const snout = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 6, 6),
      skinMat
    );
    snout.scale.set(1.4, 0.7, 0.8);
    snout.position.set(2.5, 2.7, 0);
    group.add(snout);

    // === EARS — two small cones ===
    [-0.1, 0.1].forEach(zOff => {
      const ear = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.22, 4),
        darkMat
      );
      ear.position.set(2.0, 3.1, zOff);
      ear.rotation.z = -0.3;
      group.add(ear);
    });

    // === MANE — ridge along neck ===
    for (let i = 0; i < 5; i++) {
      const tuft = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.2, 0.04),
        darkMat
      );
      const t = i / 4;
      tuft.position.set(1.2 + t * 0.7, 2.55 + t * 0.35, 0);
      tuft.rotation.z = -0.5;
      group.add(tuft);
    }

    // === TAIL — curved segments ===
    const tailGroup = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04 - i * 0.008, 0.04 - (i + 1) * 0.005, 0.4, 4),
        darkMat
      );
      seg.position.set(-1.6 - i * 0.2, 1.9 - i * 0.25, 0);
      seg.rotation.z = 0.4 + i * 0.2;
      tailGroup.add(seg);
    }
    group.add(tailGroup);
    group._tail = tailGroup;

    // === LEGS — upper + lower segments with joints ===
    const legs = [];
    const legPositions = [
      { x: 0.7, z: 0.25, front: true },   // front left
      { x: 0.7, z: -0.25, front: true },  // front right
      { x: -0.8, z: 0.25, front: false },  // back left
      { x: -0.8, z: -0.25, front: false }, // back right
    ];

    legPositions.forEach(lp => {
      const legGroup = new THREE.Group();
      legGroup.position.set(lp.x, 1.1, lp.z);

      // Upper leg
      const upper = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.07, 0.7, 6),
        bodyMat
      );
      upper.position.y = -0.15;
      upper.castShadow = true;
      legGroup.add(upper);

      // Lower leg (thinner)
      const lower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.04, 0.7, 6),
        skinMat
      );
      lower.position.y = -0.7;
      lower.castShadow = true;
      legGroup.add(lower);

      // Hoof
      const hoof = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6),
        new THREE.MeshLambertMaterial({ color: 0x222222 })
      );
      hoof.position.y = -1.05;
      legGroup.add(hoof);

      legGroup._isFront = lp.front;
      group.add(legGroup);
      legs.push(legGroup);
    });

    // === JOCKEY — body + head ===
    const jockeyCol = new THREE.Color(color).offsetHSL(0.15, 0.2, 0.1);
    const jockeyBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 6),
      new THREE.MeshLambertMaterial({ color: jockeyCol })
    );
    jockeyBody.scale.set(0.8, 1.2, 0.7);
    jockeyBody.position.set(-0.1, 2.35, 0);
    group.add(jockeyBody);

    const jockeyHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 6),
      new THREE.MeshLambertMaterial({ color: 0xf5c9a0 })
    );
    jockeyHead.position.set(0.0, 2.65, 0);
    group.add(jockeyHead);

    // Jockey helmet
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 6, 6),
      new THREE.MeshLambertMaterial({ color: jockeyCol })
    );
    helmet.scale.set(1, 0.7, 1);
    helmet.position.set(0.0, 2.73, 0);
    group.add(helmet);

    // Lane position across track width
    const laneW = TRACK_W - 4;
    group._laneOffset = -laneW / 2 + (laneIndex / Math.max(totalLanes - 1, 1)) * laneW;
    group._legs = legs;
    group._gallopPhase = Math.random() * Math.PI * 2;
    group._trackT = 0.96;
    group._paradeT = 0.90 + (laneIndex * 0.008); // Spread horses along parade path
    scene.add(group);
    return group;
  }

  // ── Walk animation (slow gentle gait for parading) ─────────────────────
  function animateWalk(h3d, speed) {
    h3d._gallopPhase += speed;
    const gp = h3d._gallopPhase;
    // Gentle bob
    h3d.position.y = Math.abs(Math.sin(gp * 2)) * 0.03;
    h3d._legs.forEach(leg => {
      const off = leg._isFront ? 0 : Math.PI;
      leg.rotation.x = Math.sin(gp + off) * 0.2;
    });
    // Gentle tail sway
    if (h3d._tail) {
      h3d._tail.rotation.z = Math.sin(gp * 0.5) * 0.1;
    }
  }

  // ── Gallop animation (full racing speed) ───────────────────────────────
  function animateGallop(h3d) {
    h3d._gallopPhase += 0.3;
    const gp = h3d._gallopPhase;
    // Stronger vertical bob
    h3d.position.y = Math.abs(Math.sin(gp * 2)) * 0.15;
    // Legs: front pair and back pair alternate
    h3d._legs.forEach(leg => {
      const off = leg._isFront ? 0 : Math.PI;
      leg.rotation.x = Math.sin(gp + off) * 0.55;
    });
    // Tail streams back
    if (h3d._tail) {
      h3d._tail.rotation.x = -0.2 + Math.sin(gp * 0.7) * 0.05;
      h3d._tail.rotation.z = Math.sin(gp * 0.3) * 0.05;
    }
  }

  // ── Reset pose (standing still) ────────────────────────────────────────
  function resetPose(h3d) {
    h3d.position.y = 0;
    h3d._legs.forEach(leg => { leg.rotation.x = 0; });
    if (h3d._tail) {
      h3d._tail.rotation.x = 0;
      h3d._tail.rotation.z = 0;
    }
  }

  // ── Place horse on track at normalized t ───────────────────────────────
  function placeOnTrack(h3d, tRaw) {
    const tNorm = ((tRaw % 1) + 1) % 1;
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
  }

  function updateHorses(horsesData, phase) {
    if (!scene) return;
    frameCount++;

    while (horses3d.length < horsesData.length) {
      const i = horses3d.length;
      horses3d.push(createHorse(horsesData[i].color, i, horsesData.length));
    }
    while (horses3d.length > horsesData.length) {
      const rem = horses3d.pop();
      scene.remove(rem);
    }

    const isRacing = phase === 'racing';
    let leadT = 0.96;
    let leadIdx = 0;

    horsesData.forEach((hd, i) => {
      const h3d = horses3d[i];
      if (hd.scratched) { h3d.visible = false; return; }
      h3d.visible = true;

      // ── BETTING: horse parade — walk single-file along the track ──
      if (phase === 'betting') {
        // Each horse slowly walks forward
        h3d._paradeT += 0.00012;
        placeOnTrack(h3d, h3d._paradeT);
        animateWalk(h3d, 0.06);
        return;
      }

      // ── LOADING: horses walk up to gate, then stand ──
      if (phase === 'loading') {
        if (hd.gateLoaded) {
          // Standing in gate
          h3d._trackT = 0.96;
          placeOnTrack(h3d, 0.96);
          resetPose(h3d);
        } else {
          // Not yet loaded — still approaching
          h3d.visible = false;
        }
        return;
      }

      // ── STARTING: all in gate, standing ──
      if (phase === 'starting') {
        h3d._trackT = 0.96;
        placeOnTrack(h3d, 0.96);
        resetPose(h3d);
        return;
      }

      // ── RACING / RESULT: gallop forward ──
      const pos = hd.position || 0;
      const targetT = 0.96 + (pos / 100);
      // Smooth interpolation toward target
      h3d._trackT += (targetT - h3d._trackT) * 0.15;

      if (h3d._trackT > leadT) { leadT = h3d._trackT; leadIdx = i; }

      placeOnTrack(h3d, h3d._trackT);

      if (isRacing) {
        animateGallop(h3d);
      } else {
        // Result phase — slow down
        animateWalk(h3d, 0.08);
      }
    });

    // ──────── CAMERA ────────
    if (phase === 'betting') {
      // Follow the parade from outside the rail, tracking the middle horse
      const midIdx = Math.floor(horsesData.length / 2);
      const midH = horses3d[midIdx];
      if (midH) {
        const tNorm = ((midH._paradeT % 1) + 1) % 1;
        // Camera slightly behind, outside the rail
        const behindT = ((tNorm - 0.03) % 1 + 1) % 1;
        const camPos = getTrackPos(behindT, TRACK_W / 2 + 8);
        const lookPos = getTrackPos(((tNorm + 0.01) % 1 + 1) % 1, 0);

        camera.position.x += (camPos.x - camera.position.x) * 0.03;
        camera.position.z += (camPos.z - camera.position.z) * 0.03;
        camera.position.y += (6 - camera.position.y) * 0.03;
        camera.lookAt(lookPos.x, 1.5, lookPos.z);
      }
    } else if (phase === 'loading' || phase === 'starting') {
      // Camera looking at the gate FROM THE FRONT (where horses will run toward)
      // Position ahead of the gate on the track, looking back at it
      const aheadT = ((0.96 + 0.04) % 1 + 1) % 1; // slightly ahead on track
      const camPos = getTrackPos(aheadT, 3);
      camera.position.x += (camPos.x - camera.position.x) * 0.05;
      camera.position.z += (camPos.z - camera.position.z) * 0.05;
      camera.position.y += (5 - camera.position.y) * 0.05;
      const gateCenter = getTrackPos(0.96, 0);
      camera.lookAt(gateCenter.x, 1.8, gateCenter.z);
    } else if (isRacing || phase === 'result') {
      const leadH = horses3d[leadIdx];
      if (leadH) {
        const tNorm = ((leadH._trackT % 1) + 1) % 1;
        const behindT = ((tNorm - 0.06) % 1 + 1) % 1;
        const camPos = getTrackPos(behindT, TRACK_W + 12);
        const lookPos = getTrackPos(((tNorm + 0.03) % 1 + 1) % 1, 0);

        camera.position.x += (camPos.x - camera.position.x) * 0.06;
        camera.position.z += (camPos.z - camera.position.z) * 0.06;
        camera.position.y += (15 - camera.position.y) * 0.05;
        camera.lookAt(lookPos.x, 1, lookPos.z);
      }
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
    frameCount = 0;
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
