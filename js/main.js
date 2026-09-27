// Builds the page from a story and draws each scene when she scrolls to it.
// The story arrives from preview.js (plain files) or boot.js (unlocked vault).

import { loadImage, makeSketch } from './sketch.js';
import { autoDraw, fingerDraw, showFinished } from './draw.js';

const proof = new URLSearchParams(location.search).has('proof');
const still = proof || matchMedia('(prefers-reduced-motion: reduce)').matches;
if (proof) document.documentElement.classList.add('proof');

const PENCIL = `
<svg class="pencil" viewBox="0 0 120 120" aria-hidden="true">
  <g transform="rotate(45 4 116)">
    <path d="M4 116 L-3 96 L11 96 Z" fill="#e6cfa8" stroke="#26262a" stroke-width="1.2"/>
    <path d="M4 116 L1.4 108.5 L6.6 108.5 Z" fill="#26262a"/>
    <rect x="-3" y="10" width="14" height="86" fill="#55555a" stroke="#26262a" stroke-width="1.2"/>
    <rect x="1.5" y="10" width="4" height="86" fill="#77777c"/>
    <rect x="-3" y="2" width="14" height="10" fill="#c8102e" stroke="#26262a" stroke-width="1.2"/>
  </g>
</svg>`;

const HEART = `
<svg class="heart" viewBox="0 0 90 80" aria-hidden="true">
  <path pathLength="1" d="M45 72 C20 52 6 38 8 24 C10 8 32 4 45 24 C58 4 80 8 82 24 C84 38 70 52 45 72 C40 76 52 78 60 74"/>
</svg>`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function line(text) {
  const red = text.startsWith('!');
  return el('p', `line reveal${red ? ' red' : ''}`, red ? text.slice(1) : text);
}

function wordsBlock(scene, className) {
  const box = el('div', className);
  if (scene.big) box.append(el('h2', 'big reveal', scene.big));
  for (const text of scene.lines || []) box.append(line(text));
  return box;
}

function revealIn(root, gap = 850) {
  [...root.querySelectorAll('.reveal')].forEach((node, i) => {
    setTimeout(() => node.classList.add('on'), still ? 0 : 250 + i * gap);
  });
}

function whenSeen(target, threshold, run, rootMargin = '0px') {
  if (proof) {
    run();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        run();
      }
    },
    { threshold, rootMargin },
  );
  io.observe(target);
}

// Set by start(): turns a photo name from the story into something an <img> can load.
let photoUrl = null;

// Sketching is heavy; do one photo at a time so scrolling stays smooth.
let queue = Promise.resolve();
function sketchOf(scene, stage) {
  const job = queue.then(async () => {
    const img = await loadImage(await photoUrl(scene.src));
    const sk = makeSketch(img, {
      width: 640,
      red: Boolean(scene.red),
      gold: Boolean(scene.gold),
      spots: scene.spots,
      wide: Boolean(scene.wide),
      crop: scene.crop,
    });
    stage.style.setProperty('--ar', sk.width / sk.height);
    return sk;
  });
  queue = job.catch(() => {});
  return job;
}

function stageFor(section) {
  const wrap = el('div', 'stage-wrap');
  const stage = el('div', 'stage');
  const canvas = el('canvas');
  stage.append(canvas);
  stage.insertAdjacentHTML('beforeend', PENCIL);
  wrap.append(stage);
  section.append(wrap);
  return { stage, canvas, pencil: stage.querySelector('.pencil') };
}

function buildOpening(main, opening) {
  const s = el('section', 'opening');
  const box = el('div');
  const h1 = el('h1');
  h1.append(el('span', 'write', opening.name));
  const date = el('div', 'date');
  date.append(el('span', 'write w2', opening.date));
  const hint = el('div', 'hint');
  hint.append(el('span', 'write w3', opening.hint));
  box.append(h1, date, hint);
  s.append(box);
  main.append(s);
}

function buildWords(main, scene) {
  const s = el('section');
  const box = wordsBlock(scene, 'said');
  s.append(box);
  main.append(s);
  whenSeen(box, 0.4, () => revealIn(box));
}

function buildPhoto(main, scene, flip) {
  const s = el('section');
  const grid = el('div', `scene${flip ? ' flip' : ''}`);
  const { stage, canvas, pencil } = stageFor(grid);
  const words = wordsBlock(scene, 'words');
  grid.append(words);
  s.append(grid);
  main.append(s);

  let sketch = null;
  const prepare = () => (sketch ??= sketchOf(scene, stage));
  whenSeen(s, 0, prepare, '150% 0px');
  whenSeen(stage, 0.35, async () => {
    try {
      const sk = await prepare();
      if (still) showFinished(canvas, sk);
      else await autoDraw(canvas, sk, { pencil });
      revealIn(words);
    } catch (err) {
      console.error(err);
      s.remove(); // a missing photo should not leave a hole in the story
    }
  });
}

function buildFinale(main, scene) {
  const s = el('section', 'finale');
  const grid = el('div', 'scene');
  const { stage, canvas } = stageFor(grid);
  const words = el('div', 'words');
  const intro = el('div');
  intro.append(el('h2', 'big reveal', scene.big), el('p', 'line hint reveal', scene.hint));
  const ending = el('div');
  for (const text of scene.note) ending.append(line(text));
  ending.append(el('p', 'last reveal', scene.last), el('p', 'line reveal', scene.sign));
  ending.insertAdjacentHTML('beforeend', HEART);
  words.append(intro, ending);
  grid.append(words);
  s.append(grid);
  main.append(s);

  const finish = () => {
    intro.querySelector('.hint').classList.add('spent');
    revealIn(ending, 1100);
    const wait = still ? 0 : 250 + ending.querySelectorAll('.reveal').length * 1100;
    setTimeout(() => ending.querySelector('.heart').classList.add('on'), wait);
  };

  let sketch = null;
  const prepare = () => (sketch ??= sketchOf(scene, stage));
  whenSeen(s, 0, prepare, '150% 0px');
  whenSeen(stage, 0.35, async () => {
    try {
      const sk = await prepare();
      revealIn(intro);
      if (proof) {
        showFinished(canvas, sk);
        finish();
        return;
      }
      await fingerDraw(canvas, sk);
      finish();
    } catch (err) {
      console.error(err);
      stage.remove();
      finish();
    }
  });
}

/**
 * @param {{opening: object, scenes: object[], photoUrl: (src: string) => string | Promise<string>}} story
 */
export function start({ opening, scenes, photoUrl: urlFor }) {
  photoUrl = urlFor;
  const main = document.getElementById('story');
  // ?proof&from=10&count=5 renders only a slice, so long pages can be checked in parts.
  const params = new URLSearchParams(location.search);
  const from = Number(params.get('from')) || 0;
  const shown = proof ? scenes.slice(from, from + (Number(params.get('count')) || scenes.length)) : scenes;
  if (!proof || !params.has('from')) buildOpening(main, opening);
  let photoCount = 0;
  for (const scene of shown) {
    if (scene.kind === 'words') buildWords(main, scene);
    else if (scene.kind === 'photo') buildPhoto(main, scene, photoCount++ % 2 === 1);
    else if (scene.kind === 'finale') buildFinale(main, scene);
  }
  queue.then(() => {
    document.body.dataset.ready = '1';
  });
}
