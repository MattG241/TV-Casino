// ── 3D Horse Racing Engine — GLB Horse Models ───────────────────────────

const Race3D = (() => {
  let scene, camera, renderer, animFrameId;
  let horses3d = [];
  let container = null;
  let initialized = false;
  let frameCount = 0;
  let clock = null;

  // Loaded horse template
  let horseTemplate = null;
  let horseAnimClip = null;
  let modelReady = false;

  // Track dimensions
  const STRAIGHT = 70;
  const RADIUS = 28;
  const TRACK_W = 20;

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
        x = -STRAIGHT / 2 + d; z = RADIUS; tx = 1; tz = 0;
      } else if (d < STRAIGHT + Math.PI * RADIUS) {
        const angle = (d - STRAIGHT) / RADIUS - Math.PI / 2;
        x = STRAIGHT / 2 + Math.cos(angle) * RADIUS;
        z = Math.sin(angle) * RADIUS;
        tx = -Math.sin(angle); tz = Math.cos(angle);
      } else if (d < 2 * STRAIGHT + Math.PI * RADIUS) {
        const along = d - STRAIGHT - Math.PI * RADIUS;
        x = STRAIGHT / 2 - along; z = -RADIUS; tx = -1; tz = 0;
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

  // ── Load the GLB horse model ───────────────────────────────────────────
  function loadHorseModel() {
    return new Promise((resolve) => {
      if (typeof THREE.GLTFLoader === 'undefined') {
        console.warn('GLTFLoader not available, using fallback geometry');
        resolve(false);
        return;
      }
      const loader = new THREE.GLTFLoader();
      loader.load('/models/Horse.glb', (gltf) => {
        horseTemplate = gltf.scene.children[0] || gltf.scene;
        // The Three.js horse uses morph targets for animation
        if (gltf.animations && gltf.animations.length > 0) {
          horseAnimClip = gltf.animations[0];
        }
        modelReady = true;
        resolve(true);
      }, undefined, (err) => {
        console.warn('Horse model load failed, using fallback:', err);
        resolve(false);
      });
    });
  }

  async function init(containerEl) {
    if (initialized) dispose();
    container = containerEl;
    const w = container.clientWidth;
    const h = container.clientHeight;

    buildTrack();
    clock = new THREE.Clock();

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

    // Dirt track
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
      scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        color: new THREE.Color(shade * 0.6, shade * 0.42, shade * 0.22)
      })));
    }

    // Rails
    addRail(-TRACK_W / 2 - 0.3);
    addRail(TRACK_W / 2 + 0.3);

    // Finish post
    const fp = getTrackPos(0, TRACK_W / 2 + 1.5);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 7),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    post.position.set(fp.x, 3.5, fp.z);
    scene.add(post);

    // Checkered finish
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

    // Load GLB model async — will upgrade horses once ready
    loadHorseModel();
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

  // ── Create horse from GLB or fallback geometry ─────────────────────────
  function createHorse(color, laneIndex, totalLanes) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);
    let mixer = null;
    let action = null;

    if (modelReady && horseTemplate) {
      // Clone the loaded GLB horse
      const model = horseTemplate.clone();

      // Scale — the Three.js horse is ~140 units tall, we need ~2 units
      model.scale.set(0.02, 0.02, 0.02);
      // Rotate to face +X direction (forward on our track)
      model.rotation.y = Math.PI / 2;

      // Tint the mesh to the silk color
      model.traverse((child) => {
        if (child.isMesh) {
          child.material = child.material.clone();
          child.material.color = col.clone();
          child.castShadow = true;
          // Morph targets need to be copied properly
          if (child.morphTargetInfluences) {
            child.morphTargetInfluences = [...child.morphTargetInfluences];
          }
        }
      });

      group.add(model);
      group._model = model;

      // Set up animation mixer for morph targets
      if (horseAnimClip) {
        mixer = new THREE.AnimationMixer(model);
        action = mixer.clipAction(horseAnimClip);
        action.play();
        action.paused = true; // Start paused, control speed per phase
      }
    } else {
      // Fallback: simple geometry horse
      const bodyMat = new THREE.MeshLambertMaterial({ color: col });
      const darkMat = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.5) });
      const skinMat = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.7) });

      // Torso
      const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), bodyMat);
      torso.scale.set(1.6, 0.7, 0.55);
      torso.position.set(0, 1.65, 0);
      torso.castShadow = true;
      group.add(torso);

      // Hindquarters
      const hind = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), bodyMat);
      hind.scale.set(1.0, 0.9, 0.8);
      hind.position.set(-1.1, 1.6, 0);
      group.add(hind);

      // Chest
      const chest = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), bodyMat);
      chest.scale.set(0.8, 1.0, 0.8);
      chest.position.set(1.1, 1.7, 0);
      group.add(chest);

      // Neck
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 1.2, 8), bodyMat);
      neck.position.set(1.5, 2.3, 0);
      neck.rotation.z = -0.6;
      group.add(neck);

      // Head
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), bodyMat);
      head.scale.set(1.8, 0.9, 0.8);
      head.position.set(2.1, 2.8, 0);
      group.add(head);

      // Snout
      const snout = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), skinMat);
      snout.scale.set(1.4, 0.7, 0.8);
      snout.position.set(2.5, 2.7, 0);
      group.add(snout);

      // Ears
      [-0.1, 0.1].forEach(zOff => {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 4), darkMat);
        ear.position.set(2.0, 3.1, zOff);
        ear.rotation.z = -0.3;
        group.add(ear);
      });

      // Legs
      const legs = [];
      [{ x: 0.7, z: 0.25, f: true }, { x: 0.7, z: -0.25, f: true },
       { x: -0.8, z: 0.25, f: false }, { x: -0.8, z: -0.25, f: false }].forEach(lp => {
        const legG = new THREE.Group();
        legG.position.set(lp.x, 1.1, lp.z);
        legG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.7, 6), bodyMat));
        const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.7, 6), skinMat);
        lower.position.y = -0.7;
        legG.add(lower);
        const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6),
          new THREE.MeshLambertMaterial({ color: 0x222222 }));
        hoof.position.y = -1.05;
        legG.add(hoof);
        legG._isFront = lp.f;
        group.add(legG);
        legs.push(legG);
      });

      // Jockey
      const jCol = col.clone().offsetHSL(0.15, 0.2, 0.1);
      const jBody = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6),
        new THREE.MeshLambertMaterial({ color: jCol }));
      jBody.scale.set(0.8, 1.2, 0.7);
      jBody.position.set(-0.1, 2.35, 0);
      group.add(jBody);
      const jHead = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6),
        new THREE.MeshLambertMaterial({ color: 0xf5c9a0 }));
      jHead.position.set(0.0, 2.65, 0);
      group.add(jHead);

      group._fallbackLegs = legs;
    }

    // Lane position
    const laneW = TRACK_W - 4;
    group._laneOffset = -laneW / 2 + (laneIndex / Math.max(totalLanes - 1, 1)) * laneW;
    group._gallopPhase = Math.random() * Math.PI * 2;
    group._trackT = 0.96;
    group._paradeT = 0.90 + (laneIndex * 0.008);
    group._mixer = mixer;
    group._action = action;
    group._animSpeed = 0;
    scene.add(group);
    return group;
  }

  // ── Set animation speed on a horse ─────────────────────────────────────
  function setAnimSpeed(h3d, speed) {
    if (h3d._action) {
      h3d._action.paused = speed === 0;
      h3d._action.timeScale = speed;
      h3d._animSpeed = speed;
    } else if (h3d._fallbackLegs) {
      // Fallback leg animation
      if (speed > 0) {
        h3d._gallopPhase += speed * 0.05;
        const gp = h3d._gallopPhase;
        h3d.position.y = Math.abs(Math.sin(gp * 2)) * (speed > 3 ? 0.15 : 0.04);
        h3d._fallbackLegs.forEach(leg => {
          const off = leg._isFront ? 0 : Math.PI;
          leg.rotation.x = Math.sin(gp + off) * (speed > 3 ? 0.55 : 0.2);
        });
      } else {
        h3d.position.y = 0;
        h3d._fallbackLegs.forEach(leg => { leg.rotation.x = 0; });
      }
    }
  }

  // ── Place horse on track ───────────────────────────────────────────────
  function placeOnTrack(h3d, tRaw) {
    const tNorm = ((tRaw % 1) + 1) % 1;
    const p = getTrackPos(tNorm, h3d._laneOffset);
    const nextT = ((tNorm + 0.003) % 1 + 1) % 1;
    const pNext = getTrackPos(nextT, h3d._laneOffset);

    h3d.position.x = p.x;
    h3d.position.z = p.z;

    const dx = pNext.x - p.x;
    const dz = pNext.z - p.z;
    if (dx !== 0 || dz !== 0) {
      h3d.rotation.y = Math.atan2(dx, dz);
    }
  }

  // ── Main update ────────────────────────────────────────────────────────
  function updateHorses(horsesData, phase) {
    if (!scene) return;
    frameCount++;
    const delta = clock ? clock.getDelta() : 0.016;

    // Sync horse count
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

      // Update animation mixer
      if (h3d._mixer) h3d._mixer.update(delta);

      // ── BETTING: horse parade ──
      if (phase === 'betting') {
        h3d._paradeT += 0.00012;
        placeOnTrack(h3d, h3d._paradeT);
        setAnimSpeed(h3d, 1.5); // slow walk
        return;
      }

      // ── LOADING: stand in gate ──
      if (phase === 'loading') {
        if (hd.gateLoaded) {
          h3d._trackT = 0.96;
          placeOnTrack(h3d, 0.96);
          setAnimSpeed(h3d, 0); // standing still
        } else {
          h3d.visible = false;
        }
        return;
      }

      // ── STARTING: all in gate ──
      if (phase === 'starting') {
        h3d._trackT = 0.96;
        placeOnTrack(h3d, 0.96);
        setAnimSpeed(h3d, 0);
        return;
      }

      // ── RACING / RESULT ──
      const pos = hd.position || 0;
      const targetT = 0.96 + (pos / 100);
      h3d._trackT += (targetT - h3d._trackT) * 0.15;

      if (h3d._trackT > leadT) { leadT = h3d._trackT; leadIdx = i; }

      placeOnTrack(h3d, h3d._trackT);
      setAnimSpeed(h3d, isRacing ? 6 : 2); // full gallop vs slow trot
    });

    // ── CAMERA ──
    if (phase === 'betting') {
      const midIdx = Math.floor(horsesData.length / 2);
      const midH = horses3d[midIdx];
      if (midH) {
        const tNorm = ((midH._paradeT % 1) + 1) % 1;
        const behindT = ((tNorm - 0.03) % 1 + 1) % 1;
        const camPos = getTrackPos(behindT, TRACK_W / 2 + 8);
        const lookPos = getTrackPos(((tNorm + 0.01) % 1 + 1) % 1, 0);
        camera.position.x += (camPos.x - camera.position.x) * 0.03;
        camera.position.z += (camPos.z - camera.position.z) * 0.03;
        camera.position.y += (6 - camera.position.y) * 0.03;
        camera.lookAt(lookPos.x, 1.5, lookPos.z);
      }
    } else if (phase === 'loading' || phase === 'starting') {
      // Front-facing gate view
      const aheadT = ((0.96 + 0.04) % 1 + 1) % 1;
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
