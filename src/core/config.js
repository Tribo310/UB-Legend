// Тоглоомын тохируулж болох бүх утга нэг дор.
// Хөдөлгөөний "мэдрэмж"-ийг (хурд, үсрэлт, камер) эндээс л өөрчилнө.
// Машин бүрийн жолоодлогын тохиргоо src/vehicles/vehicleTypes.js-д байна.
import { degToRad } from './utils.js';

export const CONFIG = {
  physics: {
    fixedStep: 1 / 60, // Физикийн тогтмол алхам (сек) — дэлгэцийн Гц-ээс үл хамаарна
    maxSubSteps: 5, // Нэг кадрт хамгийн ихдээ хэдэн физик алхам хийх (удаан компьютер дээр гацахаас сэргийлнэ)
    gravity: -14, // м/с² — динамик биетүүдэд (машин, конус, хайрцаг). Бодитоос бага зэрэг их → үсрэлт "хөвөхгүй"
  },

  player: {
    gravity: -22, // Дүрийн өөрийн хүндийн хүч — үсрэлт илүү "хурц" мэдрэгдэнэ
    radius: 0.32, // Капсулын радиус (м)
    halfHeight: 0.58, // Капсулын шулуун хэсгийн хагас → нийт өндөр 0.58·2 + 0.32·2 = 1.8 м
    walkSpeed: 3.2, // м/с
    runSpeed: 7.0, // м/с (Shift)
    groundAccel: 14, // Газар дээрх хурдатгалын хурц байдал
    airAccel: 2.5, // Агаарт байхдаа чиглэлээ бага зэрэг л өөрчилнө
    turnSpeed: 12, // Дүр хөдлөх зүг рүүгээ эргэх хурд
    jumpSpeed: 7.4, // ≈1.25 м өндөр үсрэлт (v² / 2g)
    maxFallSpeed: 40,
    coyoteTime: 0.12, // Ирмэгээс унасны дараа ч үсэрч болох хугацаа (сек)
    jumpBuffer: 0.15, // Газардахаас өмнөхөн дарсан Space-ийг "санах" хугацаа
    stepHeight: 0.4, // Шат, хашлага дээр автоматаар гарах дээд өндөр (м)
    stepMinWidth: 0.2,
    snapDistance: 0.35, // Налуу, шатаар буухад газарт "наалдах" дээд зай (үүнээс өндөр ирмэгээс унана)
    maxSlopeClimb: degToRad(50), // Үүнээс эгц налуу дээр гарахгүй
    minSlopeSlide: degToRad(55), // Үүнээс эгц налуугаас гулсаж унана
    mass: 75, // Машин, конусыг түлхэх хүчинд нөлөөлнө (кг)
    spawn: { x: 0, y: 0.35, z: 32 }, // Эхлэх цэг: төв талбай (хөлийн байрлал)
    spawnFacing: Math.PI, // Хойд зүг (-Z) — ордон, хөшөө рүү харна
    fallRespawnY: -20, // Үүнээс доош унавал эхлэлийн цэг рүү буцна
  },

  vehicle: {
    enterDistance: 3.6, // Машины төвөөс ийм зайд F дарж сууна (м)
    maxEnterSpeed: 3, // Үүнээс хурдан явж буй машинд сууж болохгүй (м/с)
    enterDuration: 0.35, // Суудал руу шилжих хөдөлгөөний хугацаа (сек)
    flipRecoverDelay: 2.5, // Хөмөрсөн машин ийм хугацааны дараа өөрөө эргэж тавигдана (сек)
  },

  camera: {
    fov: 62,
    near: 0.1,
    far: 2600,
    mouseSensitivity: 0.0024, // радиан / пиксел
    padYawSpeed: 2.8, // Жойстикийн баруун стик (радиан/сек)
    padPitchSpeed: 1.9,
    zoomSharpness: 10,
    collisionMargin: 0.25, // Хананаас хэр зайтай байх
    minCollisionDistance: 0.4,
    collisionRecover: 4, // Саад арилсны дараа буцаж холдох хурд
    hidePlayerDistance: 0.8, // Камер үүнээс ойртвол дүрийг нууна (толгой дотор орохгүй)

    // Явган үеийн камер
    onFoot: {
      distance: 5.2, // Анхны зай (м)
      minDistance: 2.0, // Хулганы дугуйгаар ойртох хязгаар
      maxDistance: 11,
      pivotHeight: 1.55, // Камер дүрийн аль өндрийг ширтэх вэ (мөрний түвшин)
      startPitch: 0.3, // Эерэг = дээрээс доош харна (радиан)
      minPitch: -0.45,
      maxPitch: 1.2,
      followSharpness: 18, // Хэвтээ чиглэлд дагах хурд
      verticalSharpness: 9, // Босоо чиглэлд зөөлөн дагана (үсрэлт зөөлөн харагдана)
      fovBoost: 5, // Гүйхэд FOV бага зэрэг өргөсөж хурдны мэдрэмж төрүүлнэ
      fovSpeedRange: [3.2, 7.0], // Ямар хурдны хооронд FOV өсөх вэ (м/с)
      extraDistanceAtSpeed: 0,
      autoRecenter: false,
    },

    // Машин жолоодох үеийн камер
    vehicle: {
      distance: 7.2,
      minDistance: 4.5,
      maxDistance: 15,
      pivotHeight: 1.45,
      startPitch: 0.2,
      minPitch: -0.15,
      maxPitch: 1.0,
      followSharpness: 20,
      verticalSharpness: 6,
      fovBoost: 12,
      fovSpeedRange: [8, 45],
      extraDistanceAtSpeed: 1.8, // Хурдтай үед камер бага зэрэг холдоно
      autoRecenter: true, // Хулгана хөдөлгөхгүй бол камер машины ард аажмаар буцна
      recenterDelay: 1.2, // сек
      recenterSharpness: 2.6,
      recenterMinSpeed: 1.5, // м/с
    },
  },

  graphics: {
    maxPixelRatio: 2, // Retina дэлгэц дээр GPU-г хэт ачаалахгүй
    shadowMapSize: 2048,
    shadowExtent: 40, // Сүүдрийн камер дүрийн эргэн тойронд ±40 м-ийг хамарна
  },

  world: {
    size: 5000, // Газрын хавтгайн хэмжээ (м)
    boundary: 900, // Үл харагдах хил (±м) — хот ±780 м
    fogNear: 120,
    fogFar: 1700,
  },

  map: {
    minimapSize: 196, // Мини газрын зургийн диаметр (px)
    footZoom: 1.7, // px / м — явган үед
    driveZoom: 0.85, // px / м — хурдтай машинд (илүү хол харагдана)
    arriveDistance: 18, // Зорих цэгт ийм зайд ирвэл хүрсэнд тооцно (м)
  },
};
