// Градиент тэнгэр + нарны туяа. Камерыг дагаж хөдөлдөг том бөмбөрцөг (sky dome).
// Тэнгэрийн хаяа (horizon) өнгө нь мананцарын (fog) өнгөтэй яг ижил тул алс хол
// газар, уулс тэнгэртэй жигд уусна. Үе шат 7-д өдөр/шөнөөр өнгө нь өөрчлөгдөнө.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  varying vec3 vDirection;

  void main() {
    vec3 direction = normalize(vDirection);
    float height = max(direction.y, 0.0);
    vec3 color = mix(horizonColor, topColor, pow(height, 0.55));
    float sun = max(dot(direction, sunDirection), 0.0);
    color += sunColor * (pow(sun, 900.0) * 2.5 + pow(sun, 14.0) * 0.18);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} sunDirection Нар руу чиглэсэн нэгж вектор
   * @param {{top:number, horizon:number}} colors
   */
  constructor(scene, sunDirection, colors) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(colors.top) },
        horizonColor: { value: new THREE.Color(colors.horizon) },
        sunColor: { value: new THREE.Color(0xfff2d0) },
        sunDirection: { value: sunDirection.clone().normalize() },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 16), this.material);
    this.mesh.name = 'Sky';
    this.mesh.renderOrder = -1000; // Хамгийн түрүүнд зурна, бусад бүх зүйл дээр нь гарна
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(camera) {
    this.mesh.position.copy(camera.position);
  }
}
