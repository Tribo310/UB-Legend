// Тээврийн хэрэгслийн төрлүүд — өгөгдлөөр (data) тодорхойлно.
// Шинэ машин (жийп, такси, автобус...) нэмэхдээ энд шинэ бичлэг нэмээд,
// нэр/тайлбарыг src/i18n/*.json-ийн "vehicles" хэсэгт оруулна.
//
// stats (1–5) — тоглогчид харуулах үзүүлэлт: хурд, удирдлага, бат бэх.
// Бусад нь бодит физикийн тохиргоо (Rapier-ийн raycast vehicle).
//
// Координат: машины урд = +Z, дээш = +Y, баруун тал = −X. Эх цэг (0,0,0) нь машин
// тайван зогсож байхад дугуйн доод талын түвшинд (газар дээр) байна.

export const VEHICLE_TYPES = {
  // Жижиг хибрид суудлын машин — хотын хамгийн түгээмэл. Японоос орж ирсэн тул жолоо нь баруун талдаа.
  hybrid: {
    nameKey: 'vehicles.hybrid.name',
    descriptionKey: 'vehicles.hybrid.description',
    stats: { speed: 3, handling: 4, durability: 2 },
    body: 'liftback', // VehicleModel.js-ийн BODY_TYPES
    rightHandDrive: true,
    plate: '0028 БАТ',
    colors: { body: 0xe6e9ec, trim: 0x2b3036, glass: 0x1b2836, interior: 0x3a3f46 },
    size: { length: 4.48, width: 1.7, height: 1.47 },

    // Масс ба тэнцвэр
    mass: 1350, // кг
    centerOfMassY: 0.4, // Хүндийн төвийг нам байрлуулбал эргэлтэнд хөмрөхгүй (м)
    linearDamping: 0.04,
    angularDamping: 0.6,
    downforce: 0.9, // Хурд²-д пропорциональ доош түлхэх хүч — өндөр хурдад тогтвортой

    // Хөдөлгүүр ба тоормос
    drive: 'front', // 'front' | 'rear' | 'all'
    maxSpeedKmh: 165,
    maxReverseKmh: 30,
    engineForce: 3800, // Н — хөтлөгч дугуй бүрт (0→100 км/ц ≈ 6 сек)
    reverseForceRatio: 0.6,
    // Тоормос: Rapier-д дугуй бүрт, физикийн алхам бүрт өгөх импульсийн дээд хэмжээ (Н·с).
    // 55 → ойролцоогоор 1g: 100→0 км/ц ≈ 37 м (хөтөч дээр хэмжсэн)
    brakeImpulse: 55,
    handbrakeImpulse: 80,
    coastBrakeImpulse: 2.5, // Хурдасгуур, тоормос дарахгүй үед аажмаар удаашрах (≈0.4 м/с²)
    parkingBrakeImpulse: 35, // Жолоочгүй машин өнхрөхгүй

    // Жолоо
    steer: {
      maxAngle: 0.6, // Бага хурдад (радиан ≈ 34°)
      highSpeedAngle: 0.14, // Өндөр хурдад жолоо зөөлөрнө — хөмрөхөөс сэргийлнэ
      speedForMinAngle: 32, // м/с
      rate: 2.6, // Жолоо эргэх хурд (радиан/сек)
      returnRate: 4.5, // Төв рүү буцах хурд
    },

    // Дугуй ба түдгэлзүүлэлт (suspension)
    wheels: {
      radius: 0.33,
      width: 0.22,
      frontZ: 1.36,
      rearZ: -1.34,
      halfTrack: 0.77, // Голоос дугуйн төв хүртэлх хөндлөн зай
      suspensionRest: 0.3,
      stiffness: 34,
      compression: 4.2, // Шахагдах үеийн сааруулалт (damping)
      relaxation: 2.6, // Сунах үеийн сааруулалт
      maxTravel: 0.24,
      maxForce: 50000,
      frictionSlip: 1.15, // Зам барилт (үрэлтийн коэффициент) — мөстэй замд багасна (Үе шат 7)
      sideFriction: 1.0,
      handbrakeSideFriction: 0.3, // Гар тоормостой үед арын дугуй гулсана (drift)
    },
  },
};

// Такси: хибридтэй ижил физик, шар өнгө, дээвэр дээр тэмдэгтэй
VEHICLE_TYPES.taxi = {
  ...VEHICLE_TYPES.hybrid,
  nameKey: 'vehicles.taxi.name',
  descriptionKey: 'vehicles.taxi.description',
  taxiSign: true,
  plate: '4512 УБТ',
  colors: { ...VEHICLE_TYPES.hybrid.colors, body: 0xf2c230 },
};

// Том жийп — баячуудын машин: хүчтэй, бат бөх, 4 дугуй хөтлөгчтэй, гэхдээ хүнд, өндөр хүндийн төвтэй
VEHICLE_TYPES.suv = {
  nameKey: 'vehicles.suv.name',
  descriptionKey: 'vehicles.suv.description',
  stats: { speed: 4, handling: 3, durability: 4 },
  body: 'suv',
  rightHandDrive: false,
  plate: '7777 УБА',
  colors: { body: 0x1f2328, trim: 0x23272c, glass: 0x141d27, interior: 0x2e2a26 },
  size: { length: 4.9, width: 1.95, height: 1.85 },
  mass: 2300,
  centerOfMassY: 0.55,
  linearDamping: 0.05,
  angularDamping: 0.7,
  downforce: 1.0,
  drive: 'all',
  maxSpeedKmh: 175,
  maxReverseKmh: 30,
  engineForce: 3300,
  reverseForceRatio: 0.55,
  brakeImpulse: 92, // Хибридын 55 × (масс 2300 / 1350)
  handbrakeImpulse: 125,
  coastBrakeImpulse: 4,
  parkingBrakeImpulse: 60,
  steer: { maxAngle: 0.55, highSpeedAngle: 0.13, speedForMinAngle: 32, rate: 2.4, returnRate: 4.2 },
  wheels: {
    radius: 0.4,
    width: 0.26,
    frontZ: 1.45,
    rearZ: -1.45,
    halfTrack: 0.86,
    suspensionRest: 0.34,
    stiffness: 30,
    compression: 4.0,
    relaxation: 2.6,
    maxTravel: 0.28,
    maxForce: 90000,
    frictionSlip: 1.2,
    sideFriction: 1.0,
    handbrakeSideFriction: 0.35,
  },
};

// Микро автобус — удаан, том, өндөр тул эргэлтэнд хазайна
VEHICLE_TYPES.minibus = {
  nameKey: 'vehicles.minibus.name',
  descriptionKey: 'vehicles.minibus.description',
  stats: { speed: 2, handling: 2, durability: 4 },
  body: 'van',
  rightHandDrive: false,
  plate: '3045 УНА',
  colors: { body: 0xf1f1ee, trim: 0x2b3036, glass: 0x1b2836, interior: 0x3a3f46 },
  size: { length: 5.2, width: 1.9, height: 2.3 },
  mass: 2600,
  centerOfMassY: 0.62,
  linearDamping: 0.06,
  angularDamping: 0.8,
  downforce: 0.8,
  drive: 'rear',
  maxSpeedKmh: 125,
  maxReverseKmh: 25,
  engineForce: 5200,
  reverseForceRatio: 0.55,
  brakeImpulse: 105,
  handbrakeImpulse: 140,
  coastBrakeImpulse: 5,
  parkingBrakeImpulse: 70,
  steer: { maxAngle: 0.52, highSpeedAngle: 0.12, speedForMinAngle: 28, rate: 2.2, returnRate: 4.0 },
  wheels: {
    radius: 0.36,
    width: 0.24,
    frontZ: 1.75,
    rearZ: -1.55,
    halfTrack: 0.82,
    suspensionRest: 0.32,
    stiffness: 32,
    compression: 4.2,
    relaxation: 2.8,
    maxTravel: 0.26,
    maxForce: 100000,
    frictionSlip: 1.1,
    sideFriction: 1.0,
    handbrakeSideFriction: 0.35,
  },
};
