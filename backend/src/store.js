// Tiny JSON-file store. Good enough for a hackathon MVP; swap for SQLite/Postgres later.
import fs from 'node:fs';
import path from 'node:path';

export function createStore(file) {
  let state = { sellers: {}, orders: {} };
  if (file && fs.existsSync(file)) {
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* start fresh */ }
  }
  let timer = null;
  const save = () => {
    if (!file) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, file);
    }, 200);
  };
  return { state, save };
}
