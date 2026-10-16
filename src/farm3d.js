import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { tierCountFor } from '../cultivation/stages.js';

export function displayTiersForRack(bed) {
  return tierCountFor(bed);
}

function label(text, size = 2.2) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffffed';
  context.beginPath();
  context.roundRect(6, 6, 244, 68, 16);
  context.fill();
  context.fillStyle = '#365943';
  context.font = '700 34px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 40);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(size * 2.6, size * .8, 1);
  return sprite;
}

export function createRackModel({ tiers, rackType, color, selected = false }) {
  const group = new THREE.Group();
  const parts = new Map();
  const metal = new THREE.MeshStandardMaterial({ color: '#becbd0', metalness: .72, roughness: .3 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: '#343d42', metalness: .3, roughness: .48 });
  const trayMaterial = new THREE.MeshStandardMaterial({ color: '#eef2ee', metalness: .12, roughness: .43, emissive: selected ? '#2f6549' : '#000000', emissiveIntensity: .42 });
  const channel = new THREE.MeshStandardMaterial({ color: '#496e59', roughness: .8 });
  const led = new THREE.MeshStandardMaterial({ color: '#fff8ed', emissive: '#fff0e6', emissiveIntensity: 1.6, roughness: .2 });
  const blue = new THREE.MeshStandardMaterial({ color: '#2879bd', metalness: .3, roughness: .35 });
  const highestTray = 1.08 + (tiers - 1) * .85;
  const top = highestTray + .68;

  function box(name, material, size, position, shadow = false, rotationY = 0) {
    if (!parts.has(name)) parts.set(name, { material, instances: [], shadow });
    parts.get(name).instances.push({ size, position, rotationY });
  }

  for (const x of [-2.15, 2.15]) {
    for (const z of [-1.04, 1.04]) {
      box('rack-upright', metal, [.11, top - .66, .11], [x, (top + .66) / 2, z], true);
      box('rack-foot', darkMetal, [.24, .1, .24], [x, .62, z]);
    }
  }
  for (const y of [.72, top]) {
    for (const z of [-1.04, 1.04]) box('rack-crossbar', metal, [4.4, .09, .09], [0, y, z]);
    for (const x of [-2.15, 2.15]) box('rack-crossbar', metal, [.09, .09, 2.16], [x, y, 0]);
  }

  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, top - .76, 8), darkMetal);
  pipe.name = 'irrigation-pipe';
  pipe.position.set(2.34, (top + .76) / 2, .82);
  group.add(pipe);

  for (let tier = 0; tier < tiers; tier++) {
    const y = 1.08 + tier * .85;
    box('grow-tray', trayMaterial, [4.15, .13, 1.78], [0, y, 0], true);
    box('grow-channel', channel, [3.91, .025, 1.55], [0, y + .08, 0]);
    for (const z of [-.9, .9]) box('tray-lip', trayMaterial, [4.17, .21, .08], [0, y + .11, z]);
    for (const x of [-2.05, 2.05]) box('tray-end', trayMaterial, [.08, .2, 1.8], [x, y + .1, 0]);
    for (const z of [-.52, .52]) {
      box('light-housing', metal, [4.04, .07, .13], [0, y + .65, z]);
      box('grow-light', led, [3.91, .025, .075], [0, y + .607, z]);
    }
    box('irrigation-valve', blue, [.19, .13, .16], [2.34, y + .08, .82], false, .24);
    box('irrigation-line', darkMetal, [.25, .045, .045], [2.17, y + .08, .82]);
  }

  const partMeshes = new Map();
  const partTransform = new THREE.Object3D();
  for (const [name, { material, instances, shadow }] of parts) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, instances.length);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    instances.forEach(({ size, position, rotationY }, index) => {
      partTransform.position.set(...position);
      partTransform.scale.set(...size);
      partTransform.rotation.set(0, rotationY, 0);
      partTransform.updateMatrix();
      mesh.setMatrixAt(index, partTransform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    partMeshes.set(name, mesh);
  }

  if (rackType) {
    const headsPerTier = 10;
    const leavesPerHead = 3;
    const leaves = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(.2, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .88, side: THREE.DoubleSide }),
      tiers * headsPerTier * leavesPerHead,
    );
    leaves.name = 'leaf-crowns';
    leaves.castShadow = true;
    const dummy = new THREE.Object3D();
    const baseColor = new THREE.Color(color);
    let index = 0;
    for (let tier = 0; tier < tiers; tier++) {
      const y = 1.08 + tier * .85;
      for (const z of [-.42, .42]) {
        for (let plant = 0; plant < 5; plant++) {
          const x = -1.58 + plant * .79;
          for (let leaf = 0; leaf < leavesPerHead; leaf++) {
            dummy.position.set(x + (leaf - 1) * .105, y + .28 + (leaf === 1 ? .065 : 0), z + (leaf - 1) * .07);
            dummy.rotation.set(0, (plant + leaf) * .9, (leaf - 1) * .35);
            dummy.scale.set(1.1, .86, 1.27);
            dummy.updateMatrix();
            leaves.setMatrixAt(index, dummy.matrix);
            const shade = baseColor.clone().multiplyScalar(.82 + ((plant * 3 + tier + leaf) % 5) * .08);
            leaves.setColorAt(index, shade);
            index++;
          }
        }
      }
    }
    leaves.instanceMatrix.needsUpdate = true;
    leaves.instanceColor.needsUpdate = true;
    group.add(leaves);
  }

  return { group, selectionMeshes: ['grow-tray', 'tray-lip', 'tray-end'].map(name => partMeshes.get(name)) };
}

export function mountFarmView(container, beds, onSelect, selectedFloor = 'all', selectedBed = '') {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8f0e5');
  scene.fog = new THREE.Fog('#e8f0e5', 105, 160);
  const camera = new THREE.PerspectiveCamera(44, 1, .1, 300);
  camera.position.set(36, selectedFloor === 'all' ? 38 : 29, 47);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, selectedFloor === 'all' ? 7 : 3, 0);
  controls.enableDamping = true;
  controls.minDistance = 18;
  controls.maxDistance = 160;
  controls.maxPolarAngle = Math.PI * .72;
  controls.update();

  scene.add(new THREE.AmbientLight('#ffffff', 1.25));
  const light = new THREE.DirectionalLight('#ffffff', 1.9);
  light.position.set(-22, 48, 28);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.left = -50;
  light.shadow.camera.right = 50;
  light.shadow.camera.top = 50;
  light.shadow.camera.bottom = -50;
  scene.add(light);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 75), new THREE.MeshStandardMaterial({ color: '#dce8d5', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const bedMeshes = [];
  const shelves = [];
  const colors = ['#73ac61', '#8dc579', '#b0cc75', '#669d68', '#a2be7c', '#6ca181'];
  const indexed = new Map(beds.map(bed => [`${bed.floor}-${bed.side}${bed.number}`, bed]));

  const visibleFloors = selectedFloor === 'all' ? ['1층', '2층'] : [selectedFloor];
  for (const floorName of visibleFloors) {
    const level = selectedFloor === 'all' && floorName === '2층' ? 11 : 0;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(27, .45, 38), new THREE.MeshStandardMaterial({ color: floorName === '1층' ? '#d8e2d2' : '#dbe8d8', roughness: .94, transparent: floorName === '2층' && selectedFloor === 'all', opacity: floorName === '2층' && selectedFloor === 'all' ? .72 : 1, depthWrite: floorName !== '2층' || selectedFloor !== 'all' }));
    floor.position.set(0, level + .2, 0);
    floor.receiveShadow = true;
    scene.add(floor);

    const walkway = new THREE.Mesh(new THREE.BoxGeometry(2.3, .08, 34), new THREE.MeshStandardMaterial({ color: '#f0f1e8', roughness: 1 }));
    walkway.position.set(0, level + .5, 0);
    scene.add(walkway);

    const entrancePad = new THREE.Mesh(new THREE.BoxGeometry(2.3, .04, 1.35), new THREE.MeshStandardMaterial({ color: '#b9d3ac', roughness: .8 }));
    entrancePad.position.set(0, level + .57, 17.5);
    scene.add(entrancePad);
    const entranceLabel = label('입구', 1.55);
    entranceLabel.position.set(0, level + 1.35, 18.3);
    scene.add(entranceLabel);

    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(27, 9.7, 38)), new THREE.LineBasicMaterial({ color: '#8cae9a', transparent: true, opacity: .85 }));
    edge.position.set(0, level + 5.25, 0);
    scene.add(edge);

    const wall = new THREE.Mesh(new THREE.BoxGeometry(27, 9.7, 38), new THREE.MeshPhysicalMaterial({ color: '#d9eee0', transmission: .68, transparent: true, opacity: .07, roughness: .05, depthWrite: false }));
    wall.position.set(0, level + 5.25, 0);
    scene.add(wall);

    const floorLabel = label(floorName, 2.8);
    floorLabel.position.set(-10, level + 3.1, -20);
    scene.add(floorLabel);

    for (const x of [-13, 13]) {
      for (const z of [-18.5, 18.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(.25, 10, .25), new THREE.MeshStandardMaterial({ color: '#afc3ad', roughness: .7 }));
        post.position.set(x, level + 5.2, z);
        scene.add(post);
      }
    }

    for (const side of ['L', 'R']) {
      const x = side === 'L' ? -6.3 : 6.3;
      for (let number = 1; number <= 11; number++) {
        const z = -16 + (number - 1) * 3.2;
        const bed = indexed.get(`${floorName}-${side}${number}`);
        if (!bed) continue;
        const varietyIndex = beds.findIndex(item => item.varietyId && item.varietyId === bed.varietyId);
        const tiers = displayTiersForRack(bed);
        const color = bed.rackType === 'nursery1' ? '#8fbe9e' : bed.rackType === 'nursery2' ? '#b1c478' : bed.rackType === 'final' ? (bed.varietyId ? colors[Math.abs(varietyIndex) % colors.length] : '#67a477') : '#b9c9b7';
        const rackHeight = .9 + (tiers - 1) * .85;
        const { group, selectionMeshes } = createRackModel({ tiers, rackType: bed.rackType, color, selected: bed.id === selectedBed });
        group.position.set(x, level, z);
        scene.add(group);
        for (const mesh of selectionMeshes) shelves.push({ mesh, bedId: bed.id });
        const hitBox = new THREE.Mesh(new THREE.BoxGeometry(4.8, rackHeight + .8, 2.45), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        hitBox.position.set(x, level + 1.02 + rackHeight / 2, z);
        hitBox.userData.bedId = bed.id;
        scene.add(hitBox);
        bedMeshes.push(hitBox);
        const bedLabel = label(`${side}${number} · ${tiers}단`, 1.13);
        bedLabel.position.set(x, level + 2.1 + (tiers - 1) * .85, z);
        scene.add(bedLabel);
      }
    }
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown;
  function down(event) { pointerDown = { x: event.clientX, y: event.clientY }; }
  function click(event) {
    if (!pointerDown || Math.hypot(pointerDown.x - event.clientX, pointerDown.y - event.clientY) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width * 2 - 1;
    pointer.y = -(event.clientY - rect.top) / rect.height * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(bedMeshes)[0];
    if (!hit) return;
    for (const { mesh, bedId } of shelves) mesh.material.emissive.set(bedId === hit.object.userData.bedId ? '#31583a' : '#000000');
    onSelect(hit.object.userData.bedId);
  }
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointerup', click);

  const resize = new ResizeObserver(() => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });
  resize.observe(container);
  let active = true;
  function animate() {
    if (!active) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  return () => {
    active = false;
    resize.disconnect();
    controls.dispose();
    renderer.domElement.removeEventListener('pointerdown', down);
    renderer.domElement.removeEventListener('pointerup', click);
    scene.traverse(object => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach(item => item.dispose());
      else object.material?.dispose();
    });
    renderer.dispose();
    renderer.domElement.remove();
  };
}
