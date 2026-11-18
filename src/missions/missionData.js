// Даалгаврууд ба дүрүүд — зөвхөн ӨГӨГДӨЛ. Бүх текст (нэр, зорилт, яриа) mn.json / en.json-ийн
// "missions", "characters" хэсэгт. Шинэ даалгавар нэмэхдээ энд алхмуудыг тодорхойлж, текстийг нэмнэ.
//
// Алхмын төрлүүд (MissionManager гүйцэтгэнэ):
//   talk    — харилцан яриа (lines: текстийн түлхүүр); тоглогч хөдөлж болно
//   enter   — даалгаврын машинд суух (vehicle: түлхүүр); companion — өгсөн хүн хамт суух
//   drive   — газар хүрэх (to, radius); stop — заавал зогсох; vehicle — тэр машинаар; time — цагтай;
//             lines — замдаа ярих яриа; spawn — тэнд хүлээж буй дүр
//   tail    — машиныг анзааргүй дагах (хэт ойр — сэжиглэнэ, хэт хол — алдана). traffic: true машин
//             замын хөдөлгөөний дүрмээр (эгнээ, гэрлэн дохио) явна — улаанд зогсоно
//   observe — дагасан машинаас тодорхой зайд зогсож ажиглах
//   outro   — төгсгөлийн яриа (companionExit — хамт явсан хүн машинаас буух), дараа нь шагнал
//
// Байршлууд cityLayout.js-ийн гудамжаар тооцогдсон: машин зогсоол нь эгнээнээс 2.6 м (замын
// хөдөлгөөнийг хаахгүй), дүрүүд явган зам дээр.

export const CHARACTERS = Object.freeze({
  bat: { nameKey: 'characters.bat', color: '#d9a441' },
  ganaa: {
    nameKey: 'characters.ganaa',
    color: '#f2c230',
    letter: 'Г',
    look: { top: 0xd99a1e, legs: 0x2a2f3a, hair: 0x17120f },
  },
  bagsh: {
    nameKey: 'characters.bagsh',
    color: '#e0503c',
    letter: 'Б',
    look: { top: 0x4a1c24, legs: 0x2a1d14, hair: 0x14110f },
    options: { deel: true, scale: 1.06 },
  },
  saraa: {
    nameKey: 'characters.saraa',
    color: '#5aa9ff',
    letter: 'С',
    look: { top: 0xb5452f, legs: 0x22252b, hair: 0x241b16 },
    options: { scale: 0.95 },
  },
  receiver: {
    nameKey: 'characters.receiver',
    color: '#9fb4c8',
    look: { top: 0x2b3a55, legs: 0x1a1a1e, hair: 0x101010 },
  },
});

/** @type {object[]} Бүлэг 1-ийн эхний гурван даалгавар (дарааллаар нээгдэнэ). */
export const MISSIONS = Object.freeze([
  {
    id: 'm1',
    number: 1,
    giver: 'ganaa',
    requires: null,
    reward: 5000,
    // Төв талбайн баруун захын явган зам — тоглогч эхлэх цэгээс 50 м
    start: { x: -50.5, y: 0.15, z: 22, facing: -Math.PI / 2 },
    vehicles: {
      taxi: { type: 'taxi', position: { x: -54.4, y: 0.05, z: 14 }, yaw: Math.PI },
    },
    steps: [
      { type: 'talk', lines: 'intro' },
      { type: 'enter', vehicle: 'taxi', objective: 'enter', companion: true },
      // Их захын баруун гудамж, Багшийн павильоны дэргэд
      { type: 'drive', objective: 'drive', vehicle: 'taxi', to: { x: -416.5, z: 38 }, radius: 8, stop: true, lines: 'ride' },
      { type: 'outro', lines: 'outro', companionExit: true },
    ],
  },
  {
    id: 'm2',
    number: 2,
    giver: 'bagsh',
    requires: 'm1',
    reward: 15000,
    start: { x: -410.5, y: 0.15, z: 30, facing: -Math.PI / 2 },
    vehicles: {
      van: { type: 'minibus', position: { x: -414.4, y: 0.05, z: 18 }, yaw: Math.PI, color: 0x7a1f1f },
    },
    steps: [
      { type: 'talk', lines: 'intro' },
      { type: 'enter', vehicle: 'van', objective: 'enter' },
      {
        type: 'drive',
        objective: 'drive',
        vehicle: 'van',
        // Зүүн хороолол: 540-ийн гудамж, хойд зүг рүү явах эгнээ
        to: { x: 543, z: -20 },
        radius: 9,
        stop: true,
        time: 140,
        lines: 'call',
        spawn: { receiver: { x: 549, y: 0.15, z: -20, facing: -Math.PI / 2 } },
      },
      { type: 'outro', lines: 'outro' },
    ],
  },
  {
    id: 'm3',
    number: 3,
    giver: 'saraa',
    requires: 'm2',
    reward: 20000,
    start: { x: 120, y: 0.15, z: 47, facing: 0 },
    vehicles: {
      // Сараагийн машин — жийпийн ард, нэг зүг рүү харсан (шууд дагаж болно)
      car: { type: 'hybrid', position: { x: 185.6, y: 0.05, z: 30 }, yaw: Math.PI, color: 0x9c2a2a },
      // Хойд толгойн бүлэглэлийн хар жийп — 45 м-ийн цаана хашлагын дэргэд хүлээж зогсоно.
      // Замын хөдөлгөөний машин (traffic): гэрлэн дохиог дагаж, эгнээгээрээ явна.
      target: { traffic: true, type: 'suv', position: { x: 183, z: -15 }, yaw: Math.PI, color: 0x111317 },
    },
    steps: [
      { type: 'talk', lines: 'intro' },
      { type: 'enter', vehicle: 'car', objective: 'enter' },
      {
        type: 'tail',
        objective: 'tail',
        target: 'target',
        // Хойд толгой (гэр хороолол): өргөн чөлөөний хойд хэсэг, хашааны хаалганы өмнө
        to: { x: 63, z: -750 },
        speed: 11, // ≈40 км/ц — тоглогч гүйцэж чадна
        maxDistance: 100,
        lostTime: 12,
        minDistance: 15,
        suspicionLimit: 5,
        lines: 'call',
      },
      { type: 'observe', objective: 'observe', target: 'target', range: 45, minRange: 10, time: 3 },
      { type: 'outro', lines: 'outro' },
    ],
  },
]);
