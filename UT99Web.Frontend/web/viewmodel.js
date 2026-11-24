import * as THREE from "./vendor/three.module.js";

// Viewmodel: first-person оружие в отдельной сцене.
//
// Канонический формат (см. tasks/tasks/user/U001-viewmodel-analysis.md):
// - геометрия бандла — world-space после MESH ORIGIN/SCALE, в метрах;
// - мировые единицы Unreal = метры × 100 (меш переводим в них);
// - позиция = PlayerViewOffset × 100 (как setHand в UnrealScript);
// - масштаб = VIEWMODEL_SCALE × PlayerViewScale. VIEWMODEL_SCALE —
//   единый калибровочный коэффициент вида от первого лица (соотношение
//   «размер меша / дистанция»), общий для всего оружия. Относительные
//   размеры задаются только PlayerViewScale из default properties;
// - никаких ручных size/distance/shift и подгонки по экранному bbox.

const METERS_TO_UNREAL = 100;
const VIEWMODEL_SCALE = 300;

// Unreal view space (+X вперёд, +Y вбок, +Z вверх) → Three
// (камера смотрит в -Z): (-y, z, -x). Определитель +1, зеркалирования нет.
function toViewSpace(x, y, z) {
  return [-y, z, -x];
}

function writeFrame(target, frame) {
  for (let index = 0; index < frame.length; index += 3) {
    const [x, y, z] = toViewSpace(frame[index], frame[index + 1], frame[index + 2]);
    target[index] = x * METERS_TO_UNREAL;
    target[index + 1] = y * METERS_TO_UNREAL;
    target[index + 2] = z * METERS_TO_UNREAL;
  }
}

export function createViewmodel({ scene, meshes, weapons, atlas }) {
  const state = {
    mesh: null,
    geometry: null,
    weapon: null,
    view: null,
    // Проигрывание разовой анимации (select/fire), потом возврат в idle.
    animation: null,
    time: 0,
    bobTime: 0,
    swayX: 0,
    swayY: 0
  };

  function basePosition() {
    const offset = state.view?.offset ?? [0, 0, 0];
    const [x, y, z] = toViewSpace(offset[0], offset[1], offset[2]);
    return new THREE.Vector3(
      x * METERS_TO_UNREAL,
      y * METERS_TO_UNREAL,
      z * METERS_TO_UNREAL
    );
  }

  function setFrame(frames, index) {
    const target = state.geometry.attributes.position.array;
    writeFrame(target, frames[Math.min(index, frames.length - 1)]);
    state.geometry.attributes.position.needsUpdate = true;
    state.geometry.computeVertexNormals();
  }

  function setWeapon(name) {
    const view = weapons?.[name];
    const data = view ? meshes?.[view.mesh] : null;
    state.weapon = null;
    state.view = null;
    state.animation = null;
    if (state.mesh) {
      scene.remove(state.mesh);
      state.geometry?.dispose();
      state.mesh.material?.dispose();
      state.mesh = null;
      state.geometry = null;
    }
    if (!data?.positions?.length) return false;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(data.positions.length);
    const idle = data.animations?.idle ?? data.animations?.select;
    writeFrame(positions, idle?.frames?.[0] ?? data.positions);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(data.uvs), 2));
    geometry.computeVertexNormals();
    const material = new THREE.MeshPhongMaterial({
      map: atlas ?? null,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.35,
      emissive: 0x111111,
      shininess: 24,
      specular: 0x444444
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(VIEWMODEL_SCALE / METERS_TO_UNREAL * (view.scale ?? 1));
    if (view.yaw) mesh.rotation.y = view.yaw * Math.PI / 180;
    mesh.position.copy(basePosition());
    mesh.frustumCulled = false;
    scene.add(mesh);
    state.mesh = mesh;
    state.geometry = geometry;
    state.weapon = name;
    state.view = view;
    return true;
  }

  // Разовая анимация: fire — выстрел, select — подбор/переключение.
  function play(kind) {
    const data = state.view ? meshes?.[state.view.mesh] : null;
    const animation = data?.animations?.[kind];
    if (!animation?.frames?.length) return;
    state.animation = { frames: animation.frames, rate: animation.rate || 30, cursor: 0 };
    setFrame(animation.frames, 0);
  }

  function update(delta, motion = {}) {
    if (!state.mesh) return;
    const data = meshes?.[state.view.mesh];
    const idle = data?.animations?.idle ?? data?.animations?.select;
    if (state.animation) {
      const { frames, rate } = state.animation;
      state.animation.cursor += delta * rate;
      const index = Math.floor(state.animation.cursor);
      if (index >= frames.length) {
        state.animation = null;
        if (idle) setFrame(idle.frames, 0);
      } else {
        setFrame(frames, index);
      }
    } else if (idle && idle.frames.length > 1) {
      state.time += delta * (idle.rate || 30);
      setFrame(idle.frames, Math.floor(state.time) % idle.frames.length);
    }
    // Bob от скорости бега, sway от поворота мыши с затуханием.
    const speed = motion.speed ?? 0;
    state.bobTime += delta * (1 + speed / 120);
    state.swayX += ((-(motion.lookX ?? 0) * 0.02) - state.swayX) * Math.min(1, delta * 10);
    state.swayY += (((motion.lookY ?? 0) * 0.02) - state.swayY) * Math.min(1, delta * 10);
    const amount = Math.min(speed / 400, 1) * 6;
    const base = basePosition();
    state.mesh.position.set(
      base.x + Math.cos(state.bobTime * 4) * amount * 0.6 + state.swayX,
      base.y - Math.abs(Math.sin(state.bobTime * 8)) * amount + state.swayY,
      base.z
    );
  }

  // Bbox текущего оружия в NDC камеры. Материалы из excludeMaterials
  // (по умолчанию 0 — рука/предплечье) не участвуют в калибровке,
  // хотя продолжают рендериться.
  function screenBox(camera, { excludeMaterials = [0] } = {}) {
    if (!state.mesh || !camera) return null;
    const data = meshes?.[state.view.mesh];
    const materials = data?.materials;
    state.mesh.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const position = state.geometry.attributes.position;
    const point = new THREE.Vector3();
    const box = {
      minX: Infinity, maxX: -Infinity,
      minY: Infinity, maxY: -Infinity,
      count: 0
    };
    for (let index = 0; index < position.count; index += 1) {
      if (materials && excludeMaterials.includes(materials[index])) continue;
      point.fromBufferAttribute(position, index).applyMatrix4(state.mesh.matrixWorld);
      if (point.z >= -camera.near) continue;
      point.project(camera);
      box.minX = Math.min(box.minX, point.x);
      box.maxX = Math.max(box.maxX, point.x);
      box.minY = Math.min(box.minY, point.y);
      box.maxY = Math.max(box.maxY, point.y);
      box.count += 1;
    }
    return box.count ? box : null;
  }

  return {
    setWeapon,
    play,
    update,
    screenBox,
    get current() { return state.weapon; },
    get mesh() { return state.mesh; }
  };
}
