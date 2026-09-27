// The password gate. Words and photos sit in vault/ encrypted with AES-GCM; the key is
// derived from her password, so without it the host and any visitor only see noise.

const REMEMBER = 'drawn-from-memory-key';

const b64 = {
  to: (bytes) => btoa(String.fromCharCode(...bytes)),
  from: (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)),
};

// Same rule as tools/build.mjs. Forgiving about everything a phone keyboard changes on
// its own: capitals, extra spaces, curly quotes, and "--" turned into a long dash.
const LOOKALIKES = new Map([
  [0x2018, "'"],
  [0x2019, "'"],
  [0x201c, '"'],
  [0x201d, '"'],
  [0x2013, '-'],
  [0x2014, '--'],
]);
const tidy = (password) =>
  [...password.normalize('NFKC')]
    .map((c) => LOOKALIKES.get(c.codePointAt(0)) ?? c)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

async function deriveKey(password, meta) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(tidy(password)), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64.from(meta.salt), iterations: meta.iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt'],
  );
}

// Every vault file is a 12-byte IV followed by the ciphertext.
async function open(key, path) {
  // no-store: after a republish, a cached file from the old build would not match the new key
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`could not fetch ${path}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
}

async function openStory(key) {
  return JSON.parse(new TextDecoder().decode(await open(key, 'vault/story.enc')));
}

async function remembered() {
  try {
    const raw = sessionStorage.getItem(REMEMBER);
    if (!raw) return null;
    const key = await crypto.subtle.importKey('raw', b64.from(raw), 'AES-GCM', true, ['decrypt']);
    return { key, story: await openStory(key) };
  } catch {
    sessionStorage.removeItem(REMEMBER);
    return null;
  }
}

async function remember(key) {
  try {
    sessionStorage.setItem(REMEMBER, b64.to(new Uint8Array(await crypto.subtle.exportKey('raw', key))));
  } catch {
    // private browsing may refuse storage; she just types it again after a refresh
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ask(meta) {
  const gate = el('form', 'gate');
  const input = el('input');
  input.type = 'password';
  input.name = 'password';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'password');
  const button = el('button', '', 'open');
  button.type = 'submit';
  const says = el('p', 'gate-says');
  says.setAttribute('role', 'status');
  const row = el('div', 'gate-row');
  row.append(input, button);
  // Lets her see what she typed; a hidden typo is the usual reason a right password fails.
  const peek = el('button', 'gate-peek', 'show');
  peek.type = 'button';
  peek.addEventListener('click', () => {
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    peek.textContent = hidden ? 'hide' : 'show';
    input.focus();
  });
  gate.append(el('h1', 'big', 'this one is only for you.'));
  gate.append(row, peek, says);
  document.body.prepend(gate);
  input.focus();

  return new Promise((resolve) => {
    gate.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      button.disabled = true;
      says.textContent = 'opening…';
      try {
        const key = await deriveKey(input.value, meta);
        const story = await openStory(key); // wrong password fails here
        await remember(key);
        gate.classList.add('gone');
        setTimeout(() => gate.remove(), 900);
        resolve({ key, story });
      } catch (err) {
        // A wrong key fails decryption with OperationError; anything else is not her fault.
        if (err.name === 'OperationError') {
          says.textContent = 'not quite. try again?';
        } else {
          console.error(err);
          says.textContent = `could not open the page (${err.name}). check connection, then try again.`;
        }
        button.disabled = false;
        input.select();
      }
    });
  });
}

/** Shows the gate if needed and resolves with the story once unlocked. */
export async function unlock() {
  if (!crypto.subtle) {
    document.body.prepend(el('p', 'noscript', 'This page only opens over a secure (https) link.'));
    return new Promise(() => {});
  }
  const meta = await (await fetch('vault/meta.json', { cache: 'no-store' })).json();
  const { key, story } = (await remembered()) || (await ask(meta));

  const urls = new Map();
  const photoUrl = async (src) => {
    if (!urls.has(src)) {
      const bytes = await open(key, `vault/${story.photos[src]}`);
      urls.set(src, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
    }
    return urls.get(src);
  };
  return { opening: story.opening, scenes: story.scenes, photoUrl };
}
