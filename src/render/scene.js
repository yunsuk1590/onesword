// 아레나, 조명
// 원작 설정("저사양 인디게임")에 맞게 기본 도형만 사용한다.

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const SKY_COLOR = 0x1b2030;

export function createArenaScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 25, 70);

  const { radius, wallHeight } = CONFIG.arena;

  // ── 바닥 ──
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 64),
    new THREE.MeshStandardMaterial({ color: 0x6c707a, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 바닥 격자 — 움직일 때 속도감·방향감을 준다
  const grid = new THREE.PolarGridHelper(radius, 16, 6, 64, 0x8a8f9a, 0x7c818c);
  grid.position.y = 0.01;
  scene.add(grid);

  // 중앙 표시
  const centerMark = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.1, 48),
    new THREE.MeshBasicMaterial({ color: 0xc9a227 }),
  );
  centerMark.rotation.x = -Math.PI / 2;
  centerMark.position.y = 0.02;
  scene.add(centerMark);

  // ── 낮은 벽 ──
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3d4250, roughness: 0.8, side: THREE.DoubleSide });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, wallHeight, 96, 1, true), wallMat);
  wall.position.y = wallHeight / 2;
  wall.receiveShadow = true;
  scene.add(wall);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + 0.5, 96),
    new THREE.MeshStandardMaterial({ color: 0x2e323d, roughness: 0.8 }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = wallHeight;
  scene.add(rim);

  // ── 아레나 바깥 ──
  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x252a35, roughness: 1 }),
  );
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.02;
  scene.add(outside);

  // 바깥 기둥 — 시점을 돌릴 때 방향 기준점
  const pillarGeo = new THREE.BoxGeometry(1, 6, 1);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x4a5060, roughness: 0.9 });
  const pillarCount = 8;
  for (let i = 0; i < pillarCount; i++) {
    const a = (i / pillarCount) * Math.PI * 2;
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(Math.cos(a) * (radius + 4), 3, Math.sin(a) * (radius + 4));
    pillar.castShadow = true;
    scene.add(pillar);
  }

  // ── 조명 ──
  scene.add(new THREE.HemisphereLight(0xc4d4ff, 0x3a3530, 1.1));

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(10, 18, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = radius + 3;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 60 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  return scene;
}
