// Олон хэлний (i18n) систем. Бүх текст mn.json / en.json файлд байна.
// Шинэ хэл нэмэхдээ: xx.json үүсгээд доорх DICTIONARIES-д бүртгэнэ.
//
// HTML дээр:   <span data-i18n="pause.title"></span>
// JS дээр:     t('pause.title'), t('hud.money', { amount: 500 })  →  "{amount}" орлуулна
import mn from './mn.json';
import en from './en.json';

const DICTIONARIES = { mn, en };
const FALLBACK = 'mn';

export const LANGUAGES = Object.keys(DICTIONARIES);

let current = FALLBACK;
const listeners = new Set();

/** Түлхүүрээр орчуулга авна. Олдохгүй бол монгол хувилбар, тэгээд түлхүүрийг өөрийг нь буцаана. */
export function t(key, params) {
  let text = resolve(DICTIONARIES[current], key);
  if (typeof text !== 'string') text = resolve(DICTIONARIES[FALLBACK], key);
  if (typeof text !== 'string') {
    if (import.meta.env.DEV) console.warn(`[i18n] Орчуулга олдсонгүй: ${key}`);
    return key;
  }
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  }
  return text;
}

/** Мөрийн жагсаалт (жишээ нь NPC-ийн хэлэх үгс). Олдохгүй бол монгол хувилбар, тэгээд хоосон. */
export function tList(key) {
  let list = resolve(DICTIONARIES[current], key);
  if (!Array.isArray(list)) list = resolve(DICTIONARIES[FALLBACK], key);
  return Array.isArray(list) ? list : [];
}

export function getLanguage() {
  return current;
}

/** Хэлний нэрийг тухайн хэлээр нь буцаана ("Монгол", "English"). */
export function getLanguageName(code) {
  return DICTIONARIES[code]?.meta?.name ?? code;
}

export function setLanguage(code) {
  current = DICTIONARIES[code] ? code : FALLBACK;
  document.documentElement.lang = current;
  translateDom(document);
  listeners.forEach((listener) => listener(current));
}

/** Хэл солигдох үед дуудагдах функц бүртгэнэ. Бүртгэлийг цуцлах функц буцаана. */
export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** data-i18n шинжтэй бүх элементийн текстийг шинэчилнэ. */
export function translateDom(root) {
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
}

function resolve(dictionary, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dictionary);
}
