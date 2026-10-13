// 몬테카를로는 수만 회를 돌기 때문에 화면이 멈추지 않도록 Web Worker에서 실행한다.
import { simulate } from './simulate.js';

self.onmessage = (e) => {
  const { id, cfg, trials, seed } = e.data;
  try {
    self.postMessage({ id, ok: true, result: simulate(cfg, trials, seed) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
