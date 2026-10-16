// 환율과 결과 표시 단위
// 엔진은 모든 비용을 '원'으로 계산한다. 재화마다 "N 단위 = M 원" 환율을 두고,
// 결과는 기획자가 고른 표시 단위(원 또는 특정 재화)로 바꿔 보여준다.
import { fmtMoney, fmtMoneyShort } from '../lib/util.js';

let S = null;
/** 현재 상태를 연결 (상태 객체가 바뀔 때마다 호출) */
export function bindCurrency(state) { S = state; }

/** 재화의 환율. 저장된 rate가 없으면 1단위 가치(value)에서 읽기 쉬운 형태로 만든다 (0.001 → 1,000 = 1원) */
export function rateOf(res) {
  if (res.rate?.units > 0 && res.rate?.won >= 0) return res.rate;
  const v = res.value || 0;
  if (v >= 1 || v === 0) return { units: 1, won: v };
  const units = 10 ** Math.ceil(Math.log10(1 / v) - 1e-9); // 10의 거듭제곱 단위로
  return { units, won: +(v * units).toPrecision(6) };
}

/** 환율 입력 → value(1단위당 원) 갱신 */
export function setRate(res, units, won) {
  res.rate = { units, won };
  res.value = units > 0 ? won / units : 0;
}

/** 표시 단위: 'won' 또는 재화 번호 */
export function currency() {
  const d = S?.display ?? 'won';
  const r = d === 'won' ? null : S?.resources?.[d];
  if (!r || !(r.value > 0)) return { key: 'won', name: '원', perWon: 1, suffix: '원' };
  return { key: d, name: r.name, perWon: 1 / r.value, suffix: ` ${r.name}` };
}

export const money = (n) => (Number.isFinite(n) ? `${fmtMoney(n * currency().perWon)}${currency().suffix}` : '—');
export const moneyShort = (n) => (Number.isFinite(n) ? `${fmtMoneyShort(n * currency().perWon)}${currency().suffix}` : '—');
/** 원 → 표시 단위 숫자 / 표시 단위 숫자 → 원 (입력칸용) */
export const toDisplay = (won) => won * currency().perWon;
export const fromDisplay = (v) => v / currency().perWon;
