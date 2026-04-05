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

  // Cache latest state so the render loop can drive parade animation
  let lastHorsesData = [];
  let lastPhase = null;

  // Track dimensions
  const STRAIGHT = 70;
  const RADIUS = 28;
  const TRACK_W = 20;
  const GATE_T = 0.96;    // Starting gate position on track (96% around)
  const LAP_DIST = 1.04;  // Distance from gate around to finish (gate→finish = 0.04, full loop)

  let trackPoints = [];
  let trackTangents = [];
  const TRACK_SEGMENTS = 400;

  function buildTrack() {
    trackPoints = [];
    trackTangents = [];
    const totalPerimeter = 2 * STRAIGHT + 2 * Math.PI * RADIUS;
    for (let i = 0; i <= TRACK_SEGMENTS; i++) {
      const t = i / TRACK_SEGMENTS;
      let d = t * totalPerimeter;
      let x, z, tx, tz;
      if (d < STRAIGHT) {
        // Home straight (near side): right-to-left at z=RADIUS (clockwise)
        x = STRAIGHT / 2 - d; z = RADIUS; tx = -1; tz = 0;
      } else if (d < STRAIGHT + Math.PI * RADIUS) {
        // Left corner: clockwise semicircle centered at (-STRAIGHT/2, 0)
        const angle = Math.PI / 2 + (d - STRAIGHT) / RADIUS;
        x = -STRAIGHT / 2 + Math.cos(angle) * RADIUS;
        z = Math.sin(angle) * RADIUS;
        tx = -Math.sin(angle); tz = Math.cos(angle);
      } else if (d < 2 * STRAIGHT + Math.PI * RADIUS) {
        // Back straight: left-to-right at z=-RADIUS
        const along = d - STRAIGHT - Math.PI * RADIUS;
        x = -STRAIGHT / 2 + along; z = -RADIUS; tx = 1; tz = 0;
      } else {
        // Right corner: clockwise semicircle centered at (STRAIGHT/2, 0)
        const angle = -Math.PI / 2 + (d - 2 * STRAIGHT - Math.PI * RADIUS) / RADIUS;
        x = STRAIGHT / 2 + Math.cos(angle) * RADIUS;
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

  // ── Grandstand along home straight ────────────────────────────────────
  function addGrandstand() {
    const standGroup = new THREE.Group();
    const standMat = new THREE.MeshLambertMaterial({ color: 0x888899 });
    const seatMat = new THREE.MeshLambertMaterial({ color: 0x445577 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x334455 });

    // Main structure — along the home straight outside rail
    const standLen = STRAIGHT * 0.8;
    const standDepth = 12;
    const standHeight = 10;
    const standOffset = TRACK_W / 2 + 6;

    // Base platform
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(standLen, 1, standDepth),
      standMat
    );
    base.position.set(0, 0.5, RADIUS + standOffset);
    base.receiveShadow = true;
    standGroup.add(base);

    // Tiered seating (3 rows)
    for (let row = 0; row < 3; row++) {
      const rowMesh = new THREE.Mesh(
        new THREE.BoxGeometry(standLen - 2, 2, standDepth / 3 - 0.5),
        seatMat
      );
      rowMesh.position.set(0, 1.5 + row * 2.2, RADIUS + standOffset + (row - 1) * (standDepth / 3));
      rowMesh.castShadow = true;
      standGroup.add(rowMesh);
    }

    // Roof
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(standLen + 4, 0.3, standDepth + 4),
      roofMat
    );
    roof.position.set(0, standHeight, RADIUS + standOffset);
    roof.castShadow = true;
    standGroup.add(roof);

    // Roof support pillars
    for (let px = -standLen / 2 + 3; px <= standLen / 2 - 3; px += 12) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, standHeight),
        standMat
      );
      pillar.position.set(px, standHeight / 2, RADIUS + standOffset - standDepth / 2 + 1);
      pillar.castShadow = true;
      standGroup.add(pillar);
    }

    // Crowd — small colored spheres on seats
    const crowdColors = [0xcc3333, 0x3333cc, 0xffcc33, 0x33cc33, 0xff6699, 0x9933ff, 0xff8833, 0x33cccc];
    for (let row = 0; row < 3; row++) {
      for (let seat = -standLen / 2 + 2; seat < standLen / 2 - 2; seat += 1.2) {
        if (Math.random() > 0.7) continue; // some empty seats
        const person = new THREE.Mesh(
          new THREE.SphereGeometry(0.3, 4, 4),
          new THREE.MeshLambertMaterial({ color: crowdColors[Math.floor(Math.random() * crowdColors.length)] })
        );
        person.position.set(
          seat + (Math.random() - 0.5) * 0.4,
          2.8 + row * 2.2,
          RADIUS + standOffset + (row - 1) * (standDepth / 3) + (Math.random() - 0.5) * 1.5
        );
        standGroup.add(person);
      }
    }

    scene.add(standGroup);
  }

  // ── Distance markers along the track ────────────────────────────────────
  function addDistanceMarkers() {
    const totalPerimeter = 2 * STRAIGHT + 2 * Math.PI * RADIUS;
    // Place markers at intervals along the outside rail
    for (let i = 1; i <= 6; i++) {
      const t = (i / 7);
      const markerPos = getTrackPos(t, TRACK_W / 2 + 2);
      const markerPost = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 2.5),
        new THREE.MeshLambertMaterial({ color: 0xeeeeee })
      );
      markerPost.position.set(markerPos.x, 1.25, markerPos.z);
      scene.add(markerPost);

      // Small marker board
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 0.6),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0x2266aa : 0xaa2222, side: THREE.DoubleSide })
      );
      board.position.set(markerPos.x, 2.6, markerPos.z);
      board.lookAt(0, 2.6, 0);
      scene.add(board);
    }
  }

  // ── Dust particles ──────────────────────────────────────────────────────
  let dustParticles = null;
  let dustPositions = null;
  let dustVelocities = null;
  const DUST_COUNT = 60;

  function initDust() {
    if (dustParticles) scene.remove(dustParticles);
    const geo = new THREE.BufferGeometry();
    dustPositions = new Float32Array(DUST_COUNT * 3);
    dustVelocities = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      dustPositions[i * 3] = 0;
      dustPositions[i * 3 + 1] = -10; // hidden below ground
      dustPositions[i * 3 + 2] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xccaa77, size: 0.6, transparent: true, opacity: 0.5 });
    dustParticles = new THREE.Points(geo, mat);
    scene.add(dustParticles);
  }

  function updateDust(horsesData, phase) {
    if (!dustParticles || !dustPositions) return;
    const isGalloping = phase === 'racing';

    for (let i = 0; i < DUST_COUNT; i++) {
      if (isGalloping && Math.random() < 0.15 && horsesData.length > 0) {
        // Spawn dust near a random horse
        const hi = Math.floor(Math.random() * horses3d.length);
        const h = horses3d[hi];
        if (h && h.visible) {
          dustPositions[i * 3] = h.position.x + (Math.random() - 0.5) * 2;
          dustPositions[i * 3 + 1] = 0.3 + Math.random() * 0.5;
          dustPositions[i * 3 + 2] = h.position.z + (Math.random() - 0.5) * 2;
          dustVelocities[i * 3] = (Math.random() - 0.5) * 0.1;
          dustVelocities[i * 3 + 1] = Math.random() * 0.05;
          dustVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
        }
      }
      // Animate existing dust
      dustPositions[i * 3] += dustVelocities[i * 3] || 0;
      dustPositions[i * 3 + 1] += dustVelocities[i * 3 + 1] || 0;
      dustPositions[i * 3 + 2] += dustVelocities[i * 3 + 2] || 0;
      // Fade out by moving down
      if (dustPositions[i * 3 + 1] > 0) {
        dustVelocities[i * 3 + 1] -= 0.002;
      }
      if (dustPositions[i * 3 + 1] < 0) {
        dustPositions[i * 3 + 1] = -10;
      }
    }
    dustParticles.geometry.attributes.position.needsUpdate = true;
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

    // Finish post inner side too
    const fp2 = getTrackPos(0, -TRACK_W / 2 - 1.5);
    const post2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 7),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    post2.position.set(fp2.x, 3.5, fp2.z);
    scene.add(post2);

    // Checkered finish — two rows of alternating tiles
    for (let row = 0; row < 2; row++) {
      for (let j = 0; j < 10; j++) {
        const lanePos = -TRACK_W / 2 + (j + 0.5) * (TRACK_W / 10);
        const tOff = row * 0.002;
        const p = getTrackPos(tOff, lanePos);
        const isWhite = (j + row) % 2 === 0;
        const sq = new THREE.Mesh(
          new THREE.PlaneGeometry(1.2, TRACK_W / 10),
          new THREE.MeshBasicMaterial({ color: isWhite ? 0xffffff : 0x111111 })
        );
        sq.rotation.x = -Math.PI / 2;
        sq.position.set(p.x, 0.02, p.z);
        scene.add(sq);
      }
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

    // ── Grandstand along home straight (outside rail) ──
    addGrandstand();

    // ── Distance markers every ~200m ──
    addDistanceMarkers();

    initialized = true;
    frameCount = 0;

    // Init dust particles
    initDust();

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

  // ── Build face canvas texture (selfie or skin-colour placeholder) ────────
  function makeFaceCanvas(selfieDataUrl) {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');

    if (selfieDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, 0, 0, size, size);
        ctx.restore();
        c._tex.needsUpdate = true;
      };
      img.src = selfieDataUrl;
    } else {
      // Placeholder: skin-coloured circle with simple face
      ctx.fillStyle = '#f5c9a0';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#444';
      // Eyes
      ctx.beginPath(); ctx.arc(44, 52, 6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(84, 52, 6, 0, Math.PI * 2); ctx.fill();
      // Smile
      ctx.strokeStyle = '#444'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(64, 68, 18, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
    }
    return c;
  }

  // ── Build a 3D jockey group, seated on horse back ────────────────────────
  // horseY: Y height of the horse's back in group-local space (~2.0)
  function createJockey(horseColor) {
    const jGroup = new THREE.Group();
    const col = new THREE.Color(horseColor);

    // Silk color: complementary hue to the horse color
    const silkCol = col.clone().offsetHSL(0.5, 0.1, 0.15);
    const silkMat = new THREE.MeshLambertMaterial({ color: silkCol });
    // Accent stripe (white)
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    // Dark riding breeches
    const breechesMat = new THREE.MeshLambertMaterial({ color: 0x222233 });
    // Boot leather
    const bootMat = new THREE.MeshLambertMaterial({ color: 0x1a1008 });
    // Helmet (same silk color with contrasting peak)
    const helmetMat = new THREE.MeshLambertMaterial({ color: silkCol });

    const Y = 2.05; // base Y of horse back in group space

    // ── Torso (leaning forward ~25°) ──
    const torsoG = new THREE.Group();
    torsoG.position.set(0.0, Y + 0.28, 0);
    torsoG.rotation.z = 0.42; // lean forward

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.20, 0.48, 8),
      silkMat
    );
    torso.castShadow = true;
    torsoG.add(torso);

    // White stripe across torso
    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.175, 0.205, 0.06, 8),
      stripeMat
    );
    stripe.position.y = 0.08;
    torsoG.add(stripe);

    jGroup.add(torsoG);

    // ── Helmet ──
    const helmetG = new THREE.Group();
    helmetG.position.set(0.24, Y + 0.78, 0);
    helmetG.rotation.z = 0.42;

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.185, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.65),
      helmetMat
    );
    helmet.castShadow = true;
    helmetG.add(helmet);

    // Helmet peak (visor)
    const peak = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.18, 0.04, 8),
      new THREE.MeshLambertMaterial({ color: 0x111111 })
    );
    peak.position.set(0.16, -0.14, 0);
    peak.rotation.z = 0.5;
    helmetG.add(peak);

    jGroup.add(helmetG);

    // ── Face (canvas texture, updated with selfie) ──
    const faceCanvas = makeFaceCanvas(null);
    const faceTex = new THREE.CanvasTexture(faceCanvas);
    faceCanvas._tex = faceTex;

    const face = new THREE.Mesh(
      new THREE.SphereGeometry(0.145, 10, 8),
      new THREE.MeshLambertMaterial({ map: faceTex })
    );
    face.scale.set(1.1, 1.0, 0.75);
    face.position.set(0.35, Y + 0.72, 0);
    face.rotation.z = 0.3;
    face.castShadow = true;
    jGroup.add(face);
    jGroup._jockeyFace = face;
    jGroup._faceCanvas = faceCanvas;
    jGroup._faceTex = faceTex;

    // ── Arms reaching forward to hold reins ──
    [-0.14, 0.14].forEach(zOff => {
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.045, 0.50, 6),
        silkMat
      );
      arm.position.set(0.38, Y + 0.48, zOff);
      arm.rotation.z = Math.PI * 0.38;
      arm.castShadow = true;
      jGroup.add(arm);

      // Hand/glove (small sphere)
      const hand = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 6, 6),
        new THREE.MeshLambertMaterial({ color: 0x222222 })
      );
      hand.position.set(0.60, Y + 0.30, zOff);
      jGroup.add(hand);
    });

    // ── Legs / breeches (gripping horse sides) ──
    [-0.22, 0.22].forEach(zOff => {
      const thigh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.065, 0.40, 6),
        breechesMat
      );
      thigh.position.set(-0.05, Y + 0.08, zOff);
      thigh.rotation.z = Math.PI * 0.08;
      thigh.rotation.x = zOff < 0 ? 0.2 : -0.2;
      thigh.castShadow = true;
      jGroup.add(thigh);

      // Boot
      const boot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.06, 0.35, 6),
        bootMat
      );
      boot.position.set(-0.05, Y - 0.22, zOff);
      boot.rotation.x = zOff < 0 ? 0.3 : -0.3;
      jGroup.add(boot);
    });

    return jGroup;
  }

  // ── selfie map: horseIndex → selfie dataUrl ───────────────────────────────
  let pendingSelfies = {};

  function applySelfiesToHorses() {
    horses3d.forEach((h3d, i) => {
      const selfie = pendingSelfies[i];
      if (selfie && h3d._jockeyGroup) {
        applySelfieToJockey(h3d._jockeyGroup, selfie);
      }
    });
  }

  function applySelfieToJockey(jGroup, selfieDataUrl) {
    if (!jGroup || !selfieDataUrl) return;
    const faceCanvas = jGroup._faceCanvas;
    const faceTex = jGroup._faceTex;
    if (!faceCanvas || !faceTex) return;

    const size = faceCanvas.width;
    const ctx = faceCanvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 0, 0, size, size);
      ctx.restore();
      faceTex.needsUpdate = true;
    };
    img.src = selfieDataUrl;
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

      group._fallbackLegs = legs;
    }

    // ── 3D Jockey (added to both GLB and fallback horses) ──
    const jockeyGroup = createJockey(color);
    group.add(jockeyGroup);
    group._jockeyGroup = jockeyGroup;

    // Apply any pending selfie for this horse index
    if (pendingSelfies[laneIndex]) {
      applySelfieToJockey(jockeyGroup, pendingSelfies[laneIndex]);
    }

    // ── Saddle cloth number (floating above horse) ──
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx2d = canvas.getContext('2d');
    // Saddle cloth background (horse color)
    ctx2d.fillStyle = color;
    ctx2d.beginPath();
    ctx2d.arc(32, 32, 28, 0, Math.PI * 2);
    ctx2d.fill();
    // White border
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.lineWidth = 3;
    ctx2d.stroke();
    // Number text
    ctx2d.fillStyle = '#ffffff';
    ctx2d.font = 'bold 32px Arial';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(String(laneIndex + 1), 32, 33);

    const numberTex = new THREE.CanvasTexture(canvas);
    const numberSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: numberTex, transparent: true })
    );
    numberSprite.scale.set(1.8, 1.8, 1);
    numberSprite.position.set(0, 4.2, 0);
    group.add(numberSprite);
    group._numberSprite = numberSprite;

    // ── Highlight ring (for backed horses) — hidden by default ──
    const ringGeo = new THREE.RingGeometry(1.8, 2.2, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd700, transparent: true, opacity: 0,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
    group._highlightRing = ring;

    // Lane position
    const laneW = TRACK_W - 4;
    group._laneOffset = -laneW / 2 + (laneIndex / Math.max(totalLanes - 1, 1)) * laneW;
    group._gallopPhase = Math.random() * Math.PI * 2;
    group._trackT = GATE_T;
    group._paradeT = 0.90 + (laneIndex * 0.008);
    group._mixer = mixer;
    group._action = action;
    group._animSpeed = 0;
    group._horseIndex = laneIndex;
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
      // Horse models face +X, so subtract PI/2 from the track heading
      let targetY = Math.atan2(dx, dz) - Math.PI / 2;

      // Smooth rotation to prevent flipping at turns
      if (h3d._prevRotY === undefined) {
        h3d._prevRotY = targetY;
      }
      // Shortest-path angle interpolation
      let diff = targetY - h3d._prevRotY;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      h3d._prevRotY += diff * 0.15;
      h3d.rotation.y = h3d._prevRotY;
    }
  }

  // Backed horse IDs (horses players have bet on) — set by TV renderer
  let backedHorseIds = [];
  let photoFinishMode = false;

  // ── Main update ────────────────────────────────────────────────────────
  function updateHorses(horsesData, phase, opts) {
    if (!scene) return;
    if (opts?.backedHorseIds) backedHorseIds = opts.backedHorseIds;
    if (opts?.photoFinish !== undefined) photoFinishMode = opts.photoFinish;
    // Cache for frame-driven animation
    lastHorsesData = horsesData;
    lastPhase = phase;
    _syncAndAnimate(horsesData, phase);
  }

  // Called from both updateHorses (on state) and render loop (every frame)
  function _syncAndAnimate(horsesData, phase) {
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
    let leadT = GATE_T;
    let leadIdx = 0;

    horsesData.forEach((hd, i) => {
      const h3d = horses3d[i];
      if (hd.scratched) { h3d.visible = false; return; }
      h3d.visible = true;

      // Update animation mixer
      if (h3d._mixer) h3d._mixer.update(delta);

      // ── BETTING: horse parade (frame-driven smooth walk) ──
      if (phase === 'betting') {
        h3d._paradeT += 0.0003; // smooth per-frame parade speed
        placeOnTrack(h3d, h3d._paradeT);
        setAnimSpeed(h3d, 1.5); // slow walk
        return;
      }

      // ── LOADING: stand in gate ──
      if (phase === 'loading') {
        if (hd.gateLoaded) {
          h3d._trackT = GATE_T;
          placeOnTrack(h3d, GATE_T);
          setAnimSpeed(h3d, 0);
        } else {
          h3d.visible = false;
        }
        return;
      }

      // ── STARTING: all in gate ──
      if (phase === 'starting') {
        h3d._trackT = GATE_T;
        placeOnTrack(h3d, GATE_T);
        setAnimSpeed(h3d, 0);
        return;
      }

      // ── RACING / RESULT ──
      // Map pos 0-100 to track t from gate (0.96) around to finish line (0.00)
      // LAP_DIST=1.04 means full journey from gate past finish, around track, back to finish
      const pos = hd.position || 0;
      const targetT = GATE_T + (pos / 100) * LAP_DIST;
      h3d._trackT += (targetT - h3d._trackT) * 0.15;

      if (h3d._trackT > leadT) { leadT = h3d._trackT; leadIdx = i; }

      placeOnTrack(h3d, h3d._trackT);
      setAnimSpeed(h3d, isRacing ? 6 : 2);

      // ── Highlight backed horses ──
      if (h3d._highlightRing) {
        const isBacked = backedHorseIds.includes(hd.id);
        const targetOpacity = isBacked ? (0.4 + Math.sin(frameCount * 0.08) * 0.2) : 0;
        h3d._highlightRing.material.opacity += (targetOpacity - h3d._highlightRing.material.opacity) * 0.15;
      }

      // ── Number sprite always faces camera ──
      if (h3d._numberSprite) {
        h3d._numberSprite.position.y = 4.2 + (isRacing ? Math.sin(frameCount * 0.1 + i) * 0.1 : 0);
      }
    });

    // ── Update dust particles ──
    updateDust(horsesData, phase);

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
        const leaderProgress = horsesData[leadIdx]?.position || 0;

        // Dynamic camera angles based on race progress
        let camHeight, camDist, lerpFactor, camLaneOffset;

        if (photoFinishMode && leaderProgress > 92) {
          // PHOTO FINISH: Camera locked at finish line, low side angle
          const finishCam = getTrackPos(0.005, TRACK_W / 2 + 6);
          const finishLook = getTrackPos(0.0, 0);
          camera.position.x += (finishCam.x - camera.position.x) * 0.1;
          camera.position.z += (finishCam.z - camera.position.z) * 0.1;
          camera.position.y += (3.5 - camera.position.y) * 0.1;
          camera.lookAt(finishLook.x, 1.5, finishLook.z);
          // Skip the normal camera logic below
          camHeight = null;
        } else if (leaderProgress < 20) {
          // Early: wide aerial shot showing the field
          camHeight = 22;
          camDist = 0.08;
          camLaneOffset = TRACK_W + 18;
          lerpFactor = 0.04;
        } else if (leaderProgress > 90) {
          // Final stretch: head-on finish line view
          const finishAhead = getTrackPos(0.995, TRACK_W / 2 + 10);
          const finishLook = getTrackPos(0.0, 0);
          camera.position.x += (finishAhead.x - camera.position.x) * 0.06;
          camera.position.z += (finishAhead.z - camera.position.z) * 0.06;
          camera.position.y += (5 - camera.position.y) * 0.06;
          camera.lookAt(finishLook.x, 1.5, finishLook.z);
          camHeight = null; // skip default camera
        } else if (leaderProgress > 60 && leaderProgress < 80) {
          // Final turn: elevated wide shot
          camHeight = 18;
          camDist = 0.07;
          camLaneOffset = TRACK_W + 15;
          lerpFactor = 0.05;
        } else {
          // Default: medium tracking shot
          camHeight = 13;
          camDist = 0.06;
          camLaneOffset = TRACK_W + 12;
          lerpFactor = 0.06;
        }

        // Default tracking camera (skipped when camHeight is null for finish angles)
        if (camHeight !== null) {
          const behindT = ((tNorm - camDist) % 1 + 1) % 1;
          const camPos = getTrackPos(behindT, camLaneOffset);
          const lookAheadT = ((tNorm + 0.03) % 1 + 1) % 1;
          const lookPos = getTrackPos(lookAheadT, 0);

          camera.position.x += (camPos.x - camera.position.x) * lerpFactor;
          camera.position.z += (camPos.z - camera.position.z) * lerpFactor;
          camera.position.y += (camHeight - camera.position.y) * lerpFactor;
          camera.lookAt(lookPos.x, 1, lookPos.z);
        }
      }
    }

    // Gate visibility
    const gate = scene.getObjectByName('startingGate');
    if (gate) gate.visible = phase !== 'racing' && phase !== 'result';
  }

  function render() {
    if (!renderer || !scene || !camera) return;
    // Drive parade/race animation every frame for smooth motion
    if (lastHorsesData.length > 0 && lastPhase) {
      _syncAndAnimate(lastHorsesData, lastPhase);
    }
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
    lastHorsesData = [];
    lastPhase = null;
    pendingSelfies = {};
  }

  function resize() {
    if (!container || !camera || !renderer) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  // ── Set selfie images on jockey faces ─────────────────────────────────
  // selfieMap: { [horseIndex]: selfieDataUrl }
  function setHorseSelfies(selfieMap) {
    pendingSelfies = selfieMap || {};
    applySelfiesToHorses();
  }

  return {
    init,
    updateHorses,
    setHorseSelfies,
    startRendering() { if (!animFrameId) render(); },
    stopRendering() { if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; } },
    dispose,
    resize,
    isInitialized() { return initialized; },
  };
})();

window.addEventListener('resize', () => Race3D.resize());
