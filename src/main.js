// Тоглоомын эхлэх цэг (entry point).
import '@fontsource-variable/montserrat'; // Кирилл (ө, ү) бүрэн дэмждэг фонт — локал файл, офлайн ажиллана
import './ui/styles.css';
import { Game } from './core/Game.js';

const game = new Game();
game.init().catch((error) => {
  console.error('[UB] Тоглоомыг эхлүүлэх үед алдаа гарлаа:', error);
});

// Хөгжүүлэлтийн үед browser-ийн консолоос шалгахад хялбар (жишээ нь: __game.player.position)
if (import.meta.env.DEV) window.__game = game;
