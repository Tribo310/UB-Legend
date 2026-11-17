// Ертөнц: тэнгэр, гэрэлтүүлэг, мананцар, газар, хот, сургалтын талбай, алсын уулс, хил.
import * as THREE from 'three';
import { CityBuilder } from '../city/CityBuilder.js';
import { CITY_VEHICLE_SPAWNS, TRAINING_ORIGIN } from '../city/cityLayout.js';
import { CONFIG } from '../core/config.js';
import { GROUP } from '../core/Physics.js';
import { mulberry32 } from '../core/utils.js';
import { createGround } from './Ground.js';
import { Lighting } from './Lighting.js';
import { createMountains } from './props.js';
import { Sky } from './Sky.js';
import { makeStatic } from './StaticBuilder.js';
import { TestZone, TRAINING_BOUNDS } from './TestZone.js';

// Зуны цэлмэг "мөнх хөх тэнгэр". Хаяаны өнгө = мананцарын өнгө (жигд уусна)
export const SKY_COLORS = Object.freeze({ top: 0x3f7fcf, horizon: 0xcfe1ee });

export class World {
  constructor(scene, physics, renderer, camera) {
    this.camera = camera;
    this.lighting = new Lighting(scene);
    this.sky = new Sky(scene, this.lighting.sunDirection, SKY_COLORS);
    scene.background = new THREE.Color(SKY_COLORS.horizon);
    scene.fog = new THREE.Fog(SKY_COLORS.horizon, CONFIG.world.fogNear, CONFIG.world.fogFar);

    createGround(scene, physics, renderer);
    this.city = new CityBuilder(scene, physics, renderer);
    this.testZone = new TestZone(scene, physics, renderer, TRAINING_ORIGIN);
    const mountains = createMountains(mulberry32(20261117), { minDistance: 1250, spread: 350, size: 1.9 });
    scene.add(makeStatic(mountains, false, false));
    this.buildBoundary(physics);

    /** Машины зогсоолууд (Game эдгээр дээр машин үүсгэнэ) */
    this.vehicleSpawns = [...CITY_VEHICLE_SPAWNS, ...this.testZone.getVehicleSpawns()];
    /** Газрын зурагт зориулсан өгөгдөл */
    this.mapData = {
      ...this.city.map,
      training: {
        minX: TRAINING_ORIGIN.x + TRAINING_BOUNDS.minX,
        maxX: TRAINING_ORIGIN.x + TRAINING_BOUNDS.maxX,
        minZ: TRAINING_ORIGIN.z + TRAINING_BOUNDS.minZ,
        maxZ: TRAINING_ORIGIN.z + TRAINING_BOUNDS.maxZ,
      },
    };
  }

  /** Үл харагдах хил — тоглогч, машин хязгааргүй хол явахгүй. */
  buildBoundary(physics) {
    const limit = CONFIG.world.boundary;
    const walls = [
      [0, -limit, limit, 1],
      [0, limit, limit, 1],
      [-limit, 0, 1, limit],
      [limit, 0, 1, limit],
    ];
    for (const [x, z, hx, hz] of walls) {
      physics.addStaticBox({ x, y: 10, z }, { x: hx, y: 20, z: hz }, { group: GROUP.PROP });
    }
  }

  /** @param {THREE.Vector3} focus Тоглогч эсвэл машины байрлал (сүүдэр түүнийг дагана) */
  update(focus) {
    this.sky.update(this.camera);
    this.lighting.update(focus);
    this.testZone.drivingArea.update();
  }

  /** Унагаасан конус, хайрцгийг буцааж байрлуулна. */
  resetProps() {
    this.testZone.drivingArea.resetProps();
  }
}
