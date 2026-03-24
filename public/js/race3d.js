// ── 3D Horse Racing Engine (Three.js) ────────────────────────────────────
// Renders a 3D dirt track with horse models, camera tracking, and rails

const Race3D = (() => {
  let scene, camera, renderer, animFrameId;
  let horses3d = [];
  let trackLength = 200;
  let trackWidth = 40;
  let container = null;
  let initialized = false;

  function init(containerEl) {
    if (initialized) { dispose(); }
    container = containerEl;
    const w = container.clientWidth;
    const h = container.clientHeight;

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a1408, 100, 350);

    camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 500);
    camera.position.set(-30, 25, 50);
    camera.lookAt(40, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffeedd, 0.5);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
    sun.position.set(50, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 250;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    scene.add(sun);

    // Sky gradient
    const skyGeo = new THREE.SphereGeometry(300, 16, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0x87ceeb,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Ground (grass)
    const grassGeo = new THREE.PlaneGeometry(400, 300);
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x2d5a1e });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.1;
    grass.receiveShadow = true;
    scene.add(grass);

    // Dirt track
    const dirtGeo = new THREE.PlaneGeometry(trackLength + 20, trackWidth + 4);
    const dirtMat = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
    const dirt = new THREE.Mesh(dirtGeo, dirtMat);
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.set(trackLength / 2 - 10, 0.01, 0);
    dirt.receiveShadow = true;
    scene.add(dirt);

    // Inner dirt (darker)
    const innerDirt = new THREE.PlaneGeometry(trackLength + 20, trackWidth - 2);
    const innerMat = new THREE.MeshLambertMaterial({ color: 0x7a5c2e });
    const inner = new THREE.Mesh(innerDirt, innerMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(trackLength / 2 - 10, 0.02, 0);
    inner.receiveShadow = true;
    scene.add(inner);

    // Rails
    createRail(trackWidth / 2 + 1);
    createRail(-trackWidth / 2 - 1);

    // Finish post
    const postGeo = new THREE.BoxGeometry(0.3, 8, 0.3);
    const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(trackLength - 10, 4, trackWidth / 2 + 2);
    post.castShadow = true;
    scene.add(post);

    // Finish line on ground
    for (let i = 0; i < 8; i++) {
      const sq = new THREE.PlaneGeometry(0.8, trackWidth / 8);
      const sqMat = new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xffffff : 0x000000 });
      const sqMesh = new THREE.Mesh(sq, sqMat);
      sqMesh.rotation.x = -Math.PI / 2;
      sqMesh.position.set(trackLength - 10, 0.03, -trackWidth / 2 + (i * trackWidth / 8) + trackWidth / 16);
      scene.add(sqMesh);
    }

    // Starting gate
    const gateGeo = new THREE.BoxGeometry(1.5, 5, trackWidth + 4);
    const gateMat = new THREE.MeshLambertMaterial({ color: 0x444444, transparent: true, opacity: 0.7 });
    const gate = new THREE.Mesh(gateGeo, gateMat);
    gate.position.set(-5, 2.5, 0);
    gate.castShadow = true;
    gate.name = 'startingGate';
    scene.add(gate);

    // Gate stalls (vertical bars)
    for (let i = 0; i < 20; i++) {
      const bar = new THREE.BoxGeometry(0.1, 4, 0.1);
      const barMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      const barMesh = new THREE.Mesh(bar, barMat);
      barMesh.position.set(-5, 2, -trackWidth / 2 + i * (trackWidth / 19));
      scene.add(barMesh);
    }

    initialized = true;
  }

  function createRail(zPos) {
    const points = [];
    for (let x = -15; x <= trackLength + 5; x += 5) {
      points.push(new THREE.Vector3(x, 1.2, zPos));
    }
    const railGeo = new THREE.BufferGeometry().setFromPoints(points);
    const railMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1 });
    scene.add(new THREE.Line(railGeo, railMat));

    // Rail posts
    for (let x = -10; x <= trackLength + 5; x += 10) {
      const pGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.5);
      const pMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
      const p = new THREE.Mesh(pGeo, pMat);
      p.position.set(x, 0.75, zPos);
      p.castShadow = true;
      scene.add(p);
    }
  }

  function createHorse(color, laneIndex, totalLanes) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);

    // Body
    const bodyGeo = new THREE.BoxGeometry(3, 1.5, 1);
    const bodyMat = new THREE.MeshLambertMaterial({ color: col });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 2.2;
    body.castShadow = true;
    group.add(body);

    // Head/neck
    const headGeo = new THREE.BoxGeometry(1.2, 0.8, 0.7);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(2, 3, 0);
    head.rotation.z = -0.4;
    head.castShadow = true;
    group.add(head);

    // Legs (4)
    const legGeo = new THREE.CylinderGeometry(0.12, 0.1, 1.8);
    const legMat = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.7) });
    const legPositions = [[-0.8, 1.1, 0.3], [-0.8, 1.1, -0.3], [0.8, 1.1, 0.3], [0.8, 1.1, -0.3]];
    const legs = [];
    legPositions.forEach(([x, y, z]) => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, y, z);
      leg.castShadow = true;
      group.add(leg);
      legs.push(leg);
    });

    // Jockey (small figure on top)
    const jockeyGeo = new THREE.SphereGeometry(0.35);
    const jockeyMat = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(1.3) });
    const jockey = new THREE.Mesh(jockeyGeo, jockeyMat);
    jockey.position.set(0, 3.3, 0);
    jockey.castShadow = true;
    group.add(jockey);

    // Number saddle cloth
    const numGeo = new THREE.PlaneGeometry(0.6, 0.6);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(laneIndex + 1), 32, 32);
    const numTex = new THREE.CanvasTexture(canvas);
    const numMat = new THREE.MeshBasicMaterial({ map: numTex });
    const numMesh = new THREE.Mesh(numGeo, numMat);
    numMesh.position.set(0, 2.5, 0.55);
    group.add(numMesh);

    // Position on track
    const laneZ = -trackWidth / 2 + ((laneIndex + 0.5) / totalLanes) * trackWidth;
    group.position.set(-8, 0, laneZ);

    group._legs = legs;
    group._laneZ = laneZ;
    group._gallopPhase = Math.random() * Math.PI * 2;
    scene.add(group);
    return group;
  }

  function updateHorses(horsesData, phase) {
    // Create/update 3D horses
    while (horses3d.length < horsesData.length) {
      const i = horses3d.length;
      const h3d = createHorse(horsesData[i].color, i, horsesData.length);
      horses3d.push(h3d);
    }

    // Remove extra
    while (horses3d.length > horsesData.length) {
      const h = horses3d.pop();
      scene.remove(h);
    }

    const isRacing = phase === 'racing';
    let leadX = -8;

    horsesData.forEach((hd, i) => {
      const h3d = horses3d[i];
      const pos = hd.position || 0;
      const targetX = -8 + (pos / 100) * (trackLength - 5);

      // Smooth position update
      h3d.position.x += (targetX - h3d.position.x) * 0.3;

      if (h3d.position.x > leadX) leadX = h3d.position.x;

      // Gate loading visibility
      if (phase === 'loading') {
        h3d.visible = !!hd.gateLoaded;
      } else {
        h3d.visible = true;
      }

      // Gallop animation
      if (isRacing) {
        h3d._gallopPhase += 0.4;
        const gp = h3d._gallopPhase;
        // Body bob
        h3d.position.y = Math.sin(gp * 2) * 0.15;
        // Leg animation
        h3d._legs.forEach((leg, li) => {
          const offset = li < 2 ? 0 : Math.PI;
          leg.rotation.x = Math.sin(gp + offset) * 0.6;
          leg.position.y = 1.1 + Math.abs(Math.sin(gp + offset)) * 0.3;
        });
      }
    });

    // Camera follows the leaders
    if (isRacing || phase === 'result') {
      const camTargetX = leadX - 20;
      camera.position.x += (camTargetX - camera.position.x) * 0.05;
      camera.position.y = 18 + Math.sin(Date.now() * 0.0005) * 1;
      camera.position.z = 45 + Math.sin(Date.now() * 0.0003) * 5;
      camera.lookAt(leadX + 10, 2, 0);
    } else if (phase === 'loading' || phase === 'starting') {
      // Side view of the gates
      camera.position.set(-20, 12, 30);
      camera.lookAt(-5, 2, 0);
    }

    // Hide starting gate after race starts
    const gate = scene.getObjectByName('startingGate');
    if (gate) {
      gate.visible = phase === 'loading' || phase === 'starting' || phase === 'betting';
    }
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
      container.removeChild(renderer.domElement);
      renderer.dispose();
    }
    horses3d = [];
    scene = null;
    camera = null;
    renderer = null;
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
