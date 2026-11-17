// Хоёр хэлээр бичигдэх самбар байрлуулах туслах функц.
import * as THREE from 'three';
import { GROUP } from '../core/Physics.js';
import { onLanguageChange, t } from '../i18n/i18n.js';
import { createSign, SIGN } from './props.js';

/**
 * Самбар + collider үүсгэнэ. Хэл солигдоход текст нь автоматаар шинэчлэгдэнэ.
 * @param {import('./StaticBuilder.js').StaticBuilder} builder Байрлал нь builder-ийн локал координатаар
 * @param {{x:number, y:number, z:number, rotY:number, titleKey:string, subtitleKey:string}} options
 *   rotY = 0 үед самбарын нүүр +Z (өмнө) зүг рүү харна
 */
export function placeSign(builder, renderer, { x, y, z, rotY, titleKey, subtitleKey }) {
  const sign = createSign(renderer);
  sign.group.position.set(x, y, z);
  sign.group.rotation.y = rotY;
  builder.add(sign.group);

  const draw = () => sign.draw(t(titleKey), t(subtitleKey));
  draw();
  onLanguageChange(draw);
  // Кирилл фонт (ө, ү) ачаалагдсаны дараа дахин зурна
  document.fonts?.load('800 64px "Montserrat Variable"', 'ХОТЫН ДОМОГ Өө Үү').then(draw, () => {});

  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  builder.boxCollider(
    { x, y: y + SIGN.height / 2, z },
    { x: SIGN.width / 2, y: SIGN.height / 2, z: 0.15 },
    { rotation, group: GROUP.PROP },
  );
  return sign;
}
