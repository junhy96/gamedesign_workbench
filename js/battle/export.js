// 엔진 내보내기 — 스탯·전투 설정을 Unity·Unreal 프로젝트에 넣을 파일로 (순수 함수, DOM 없음)
// Kalivra 내보내기에서 고친 점: ID를 문자열로(Kalivra는 Date.now() 숫자를 C# int로 받아 21억을 넘김), 특성의 트리거·효과를 전부(Kalivra는 첫 번째만),
// Unreal은 DataTable이 바로 받는 행 배열 JSON + CSV + 행 구조체 헤더, 규칙 수식은 C#·C++ 코드로 옮김.
import { toCode } from './formula.js';
import { FORMULA_KEYS } from './model.js';

const GEN = '기획 워크벤치 — 스탯·전투 밸런스에서 생성';
const DUEL = Object.entries(FORMULA_KEYS).filter(([, [, k]]) => k === 'duel').map(([key]) => key);
const SELF = Object.entries(FORMULA_KEYS).filter(([, [, k]]) => k === 'self').map(([key]) => key);
const pascal = (k) => k[0].toUpperCase() + k.slice(1);
const ident = (s, i) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `Stat${i + 1}`); // C++ 필드 이름 (한글 스탯은 Stat1 …)

/** 공통 데이터 (ID는 문자열, 표는 { lv, value } 목록 — JsonUtility가 2차원 배열을 못 읽음) */
export function exportData(cfg) {
  const trait = (t) => ({
    name: t.name, trigger: t.on, chance: t.chance ?? 100, condWho: t.cond?.who ?? '', condBelow: t.cond?.below ?? -1, maxProcs: t.max || 0,
    effects: (t.effects || []).map(e => ({ type: e.type, who: e.who ?? 'self', value: Number(e.value) || 0, valueBase: e.base ?? 'fixed', stat: e.stat ?? '', duration: e.dur ?? 0 })),
  });
  return {
    generator: GEN, version: 1,
    rules: { mode: cfg.rules.mode, hitMin: cfg.rules.hitMin, hitMax: cfg.rules.hitMax, round: cfg.rules.round, tie: cfg.rules.tie, maxTime: cfg.rules.maxTime, maxTurns: cfg.rules.maxTurns, ...Object.fromEntries(Object.keys(FORMULA_KEYS).map(k => [`${k}Formula`, cfg.rules[k]])) },
    stats: cfg.stats.map(s => ({ id: s.id, name: s.name ?? '', growth: s.growth ?? 'linear', hasMin: Number.isFinite(s.min), min: Number.isFinite(s.min) ? s.min : 0, hasMax: Number.isFinite(s.max), max: Number.isFinite(s.max) ? s.max : 0 })),
    entities: cfg.entities.map(e => ({
      id: String(e.id), name: e.name, variance: e.variance || 0,
      stats: cfg.stats.map(s => { const sv = e.stats?.[s.id] ?? {}; return { stat: s.id, b: sv.b ?? 0, g: sv.g ?? 0, table: (sv.table || []).map(([lv, value]) => ({ lv, value })) }; }),
      traits: (e.traits || []).map(trait),
    })),
    items: (cfg.items || []).map(it => ({
      id: String(it.id), name: it.name, active: it.active !== false, allTargets: it.targets === 'all', targets: it.targets === 'all' ? [] : (it.targets || []).map(String),
      mods: (it.mods || []).map(m => ({ stat: m.stat, flat: m.flat || 0, pct: m.pct || 0, mult: m.mult ?? 1 })),
      traits: (it.traits || []).map(trait),
    })),
  };
}

function formulas(cfg, lang) {
  const out = {};
  for (const key of [...DUEL, ...SELF]) {
    const self = SELF.includes(key);
    const v = (n) => {
      if (n === 'lv') return 'lv';
      const [side, stat] = self ? ['s', n] : [n[0], n.slice(2)];
      return lang === 'cs' ? `${side}["${stat}"]` : `S(${side}, TEXT("${stat}"))`;
    };
    const r = toCode(cfg.rules[key], lang, v);
    out[key] = r.ok ? r.code : `0f /* 수식 오류: ${r.error.replace(/\*\//g, '* /')} */`;
  }
  return out;
}

// ── Unity ────────────────────────────────────────────────
export function unityFiles(cfg) {
  const data = exportData(cfg), F = formulas(cfg, 'cs');
  const dict = 'Dictionary<string, float>';
  const rules = `// ${GEN}
// 규칙 수식을 C#으로 옮긴 것. a = 공격하는 쪽, b = 맞는 쪽, s = 자기 스탯 (스탯 이름 → 값). 참·거짓은 1·0.
using System.Collections.Generic;
using UnityEngine;

public static class BattleRules
{
    public const float HitMin = ${data.rules.hitMin}f, HitMax = ${data.rules.hitMax}f;
    public const string Mode = "${data.rules.mode}"; // time = 공격 속도는 초당 공격, turn = 턴 교대

${DUEL.map(k => `    /// <summary>${FORMULA_KEYS[k][0]}: ${cfg.rules[k].replace(/\n/g, ' ')}</summary>\n    public static float ${pascal(k)}(${dict} a, ${dict} b, int lv) => ${F[k]};`).join('\n')}
${SELF.map(k => `    /// <summary>${FORMULA_KEYS[k][0]}: ${cfg.rules[k].replace(/\n/g, ' ')}</summary>\n    public static float ${pascal(k)}(${dict} s, int lv) => ${F[k]};`).join('\n')}

    /// <summary>명중 확률(0~1): 수식 값을 하한~상한으로 자른 뒤 100으로 나눔</summary>
    public static float HitChance(${dict} a, ${dict} b, int lv) => Mathf.Clamp(Hit(a, b, lv), HitMin, HitMax) / 100f;

    static float B(bool x) => x ? 1f : 0f;
    static bool T(float x) => x != 0f;
    static float And(float l, float r) => T(l) ? r : 0f;
    static float Or(float l, float r) => T(l) ? l : r;
    static float Round(float x) => Mathf.Floor(x + 0.5f);
}
`;
  const so = `// ${GEN}
using System;
using System.Collections.Generic;
using UnityEngine;

[Serializable] public class BattleLevelValue { public int lv; public float value; }
[Serializable] public class BattleStatValue { public string stat; public float b; public float g; public List<BattleLevelValue> table = new List<BattleLevelValue>(); }
[Serializable] public class BattleStatDef { public string id; public string name; public string growth; public bool hasMin; public float min; public bool hasMax; public float max; }
[Serializable] public class BattleEffect { public string type; public string who; public float value; public string valueBase; public string stat; public float duration; }
[Serializable] public class BattleTrait { public string name; public string trigger; public float chance; public string condWho; public float condBelow; public int maxProcs; public List<BattleEffect> effects = new List<BattleEffect>(); }
[Serializable] public class BattleModifier { public string stat; public float flat; public float pct; public float mult = 1f; }

public class BattleEntitySO : ScriptableObject
{
    public string id;
    public string displayName;
    [Tooltip("데미지 ±비율 (0.1 = ±10%)")] public float variance;
    public List<BattleStatValue> stats = new List<BattleStatValue>();
    public List<BattleTrait> traits = new List<BattleTrait>();

    /// <summary>레벨 lv의 기본 스탯 (아이템 수정자 전). 선형 b + g(lv−1) / 등비 b(1 + g%)^(lv−1) / 표(사이 직선 보간)</summary>
    public float BaseStat(BattleStatDef def, int lv)
    {
        var sv = stats.Find(x => x.stat == def.id);
        if (sv == null) return 0f;
        if (sv.table != null && sv.table.Count > 0)
        {
            var t = sv.table; t.Sort((x, y) => x.lv.CompareTo(y.lv));
            if (lv <= t[0].lv) return t[0].value;
            for (int i = 1; i < t.Count; i++)
                if (lv <= t[i].lv) return t[i - 1].value + (t[i].value - t[i - 1].value) * (lv - t[i - 1].lv) / (float)(t[i].lv - t[i - 1].lv);
            return t[t.Count - 1].value;
        }
        return def.growth == "geo" ? sv.b * Mathf.Pow(1f + sv.g / 100f, lv - 1) : sv.b + sv.g * (lv - 1);
    }

    /// <summary>아이템 포함 스탯: (값 + Σ고정) × (1 + Σ% ÷ 100) × Π배율, 그 뒤 최소·최대</summary>
    public Dictionary<string, float> StatsAt(List<BattleStatDef> defs, int lv, IEnumerable<BattleItemSO> items)
    {
        var o = new Dictionary<string, float>();
        foreach (var d in defs)
        {
            float flat = 0f, pct = 0f, mult = 1f;
            foreach (var it in items)
            {
                if (!it.active || !(it.allTargets || it.targets.Contains(id))) continue;
                foreach (var m in it.mods) if (m.stat == d.id) { flat += m.flat; pct += m.pct; mult *= m.mult; }
            }
            float v = (BaseStat(d, lv) + flat) * (1f + pct / 100f) * mult;
            if (d.hasMin && v < d.min) v = d.min;
            if (d.hasMax && v > d.max) v = d.max;
            o[d.id] = v;
        }
        return o;
    }
}

public class BattleItemSO : ScriptableObject
{
    public string id;
    public string displayName;
    public bool active = true;
    public bool allTargets;
    public List<string> targets = new List<string>();
    public List<BattleModifier> mods = new List<BattleModifier>();
    public List<BattleTrait> traits = new List<BattleTrait>();
}
`;
  const importer = `// ${GEN}
// 메뉴 Tools > Planning Workbench > Import Battle Data — BattleData.json을 골라 Assets/BattleData 아래에 ScriptableObject를 만들거나 갱신합니다.
#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

public static class BattleDataImporter
{
    [Serializable] class EntityRaw { public string id; public string name; public float variance; public List<BattleStatValue> stats; public List<BattleTrait> traits; }
    [Serializable] class ItemRaw { public string id; public string name; public bool active; public bool allTargets; public List<string> targets; public List<BattleModifier> mods; public List<BattleTrait> traits; }
    [Serializable] class Root { public List<BattleStatDef> stats; public List<EntityRaw> entities; public List<ItemRaw> items; }

    [MenuItem("Tools/Planning Workbench/Import Battle Data")]
    public static void Import()
    {
        var path = EditorUtility.OpenFilePanel("BattleData.json", Application.dataPath, "json");
        if (string.IsNullOrEmpty(path)) return;
        var root = JsonUtility.FromJson<Root>(File.ReadAllText(path));
        const string dir = "Assets/BattleData";
        foreach (var d in new[] { dir, dir + "/Entities", dir + "/Items" }) if (!AssetDatabase.IsValidFolder(d)) AssetDatabase.CreateFolder(Path.GetDirectoryName(d).Replace('\\\\', '/'), Path.GetFileName(d));
        foreach (var e in root.entities)
        {
            var p = dir + "/Entities/" + e.id + ".asset";
            var so = AssetDatabase.LoadAssetAtPath<BattleEntitySO>(p) ?? Create<BattleEntitySO>(p);
            so.id = e.id; so.displayName = e.name; so.variance = e.variance; so.stats = e.stats; so.traits = e.traits;
            EditorUtility.SetDirty(so);
        }
        foreach (var it in root.items)
        {
            var p = dir + "/Items/" + it.id + ".asset";
            var so = AssetDatabase.LoadAssetAtPath<BattleItemSO>(p) ?? Create<BattleItemSO>(p);
            so.id = it.id; so.displayName = it.name; so.active = it.active; so.allTargets = it.allTargets; so.targets = it.targets; so.mods = it.mods; so.traits = it.traits;
            EditorUtility.SetDirty(so);
        }
        AssetDatabase.SaveAssets();
        Debug.Log($"Battle data: 엔티티 {root.entities.Count}개, 아이템 {root.items.Count}개");
    }

    static T Create<T>(string path) where T : ScriptableObject { var so = ScriptableObject.CreateInstance<T>(); AssetDatabase.CreateAsset(so, path); return so; }
}
#endif
`;
  const readme = `${GEN}

1. Scripts/ 아래 C# 파일을 Unity 프로젝트에 넣습니다 (BattleDataImporter.cs는 Editor 폴더 안에).
2. 메뉴 Tools > Planning Workbench > Import Battle Data 에서 BattleData.json을 고릅니다.
   → Assets/BattleData/Entities, Items 에 ScriptableObject가 생깁니다 (ID = 파일 이름, 다시 가져오면 갱신).
3. 스탯 값: BattleEntitySO.StatsAt(stats 정의, 레벨, 아이템들) — 워크벤치와 같은 공식.
   규칙 수식: BattleRules.Damage(a, b, lv) 등 — 워크벤치 수식을 C#으로 옮긴 것.
4. 특성(트리거·효과)은 데이터로만 들어갑니다. 전투 진행 규칙(발동 순서·효과 1회 적용 등)은 게임 쪽 전투 코드가 맡습니다.

전투 방식: ${cfg.rules.mode === 'time' ? '시간 기반 (n번째 공격 시각 = (n − 1) ÷ 공격 속도)' : '턴 교대 (공격 속도 비율로 선공, 번갈아 공격)'}
`;
  return [
    { name: 'BattleData.json', data: JSON.stringify(data, null, 2) },
    { name: 'Scripts/BattleRules.cs', data: rules },
    { name: 'Scripts/BattleData.cs', data: so },
    { name: 'Scripts/Editor/BattleDataImporter.cs', data: importer },
    { name: 'README.txt', data: readme },
  ];
}

// ── Unreal ───────────────────────────────────────────────
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const traitText = (t) => [t.name, t.trigger, t.chance, t.condWho, t.condBelow, t.maxProcs, t.effects.map(e => [e.type, e.who, e.value, e.valueBase, e.stat, e.duration].join(':')).join('/')].join('|');

export function unrealFiles(cfg) {
  const data = exportData(cfg), F = formulas(cfg, 'cpp');
  const fields = cfg.stats.map((s, i) => ({ id: s.id, f: ident(s.id, i) }));
  // DataTable 행: Name = 행 이름(ID). 스탯은 열 하나씩(Base·Growth), 표는 "레벨:값;…" 문자열, 특성은 "이름|시점|확률|조건 대상|조건 %|최대|효과/효과" 문자열
  const entRows = data.entities.map(e => {
    const row = { Name: e.id, DisplayName: e.name, Variance: e.variance };
    for (const { id, f } of fields) {
      const sv = e.stats.find(x => x.stat === id);
      row[`${f}_Base`] = sv.b; row[`${f}_Growth`] = sv.g; row[`${f}_Table`] = sv.table.map(p => `${p.lv}:${p.value}`).join(';');
    }
    row.Traits = e.traits.map(traitText).join(' ~ ');
    return row;
  });
  const itemRows = data.items.map(it => ({
    Name: it.id, DisplayName: it.name, Active: it.active, AllTargets: it.allTargets, Targets: it.targets.join(';'),
    Mods: it.mods.map(m => `${m.stat}:${m.flat}:${m.pct}:${m.mult}`).join(';'), Traits: it.traits.map(traitText).join(' ~ '),
  }));
  const csv = (rows) => { const head = Object.keys(rows[0] ?? { Name: '' }); return [head.join(','), ...rows.map(r => head.map(k => csvCell(typeof r[k] === 'boolean' ? (r[k] ? 'True' : 'False') : r[k])).join(','))].join('\r\n') + '\r\n'; };
  const header = `// ${GEN}
// DataTable 행 구조체 — DT_BattleEntities / DT_BattleItems (.csv 또는 .json)를 가져올 때 Row Structure로 고릅니다.
#pragma once
#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "BattleRows.generated.h"

USTRUCT(BlueprintType)
struct FBattleEntityRow : public FTableRowBase
{
    GENERATED_BODY()
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString DisplayName;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float Variance = 0.f;
${fields.map(({ id, f }) => `    // ${id}${f !== id ? ` (C++ 이름 ${f})` : ''} — 성장 ${cfg.stats.find(s => s.id === id).growth === 'geo' ? '등비: Base × (1 + Growth%)^(Lv−1)' : '선형: Base + Growth × (Lv−1)'}, Table이 있으면 표(레벨:값;…, 사이 직선)
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float ${f}_Base = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float ${f}_Growth = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString ${f}_Table;`).join('\n')}
    // 특성: "이름|시점|확률|조건 대상|조건 %|최대 발동|효과/효과…" ( ~ 로 구분), 효과 = 종류:대상:값:기준:스탯:지속
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Traits;
};

USTRUCT(BlueprintType)
struct FBattleItemRow : public FTableRowBase
{
    GENERATED_BODY()
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString DisplayName;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) bool Active = true;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) bool AllTargets = false;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Targets;   // 엔티티 ID;…
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Mods;      // 스탯:고정:%:배율;…  → (값 + Σ고정) × (1 + Σ% ÷ 100) × Π배율
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Traits;
};
`;
  const T = 'const TMap<FName, float>&';
  const rules = `// ${GEN}
// 규칙 수식을 C++로 옮긴 것. a = 공격하는 쪽, b = 맞는 쪽, s = 자기 스탯 (스탯 이름 → 값). 참·거짓은 1·0.
#pragma once
#include "CoreMinimal.h"

namespace BattleRules
{
    constexpr float HitMin = ${data.rules.hitMin}f, HitMax = ${data.rules.hitMax}f;
    inline float S(${T} m, const TCHAR* k) { const float* v = m.Find(FName(k)); return v ? *v : 0.f; }
    inline float B(bool x) { return x ? 1.f : 0.f; }
    inline bool T(float x) { return x != 0.f; }
    inline float And(float l, float r) { return T(l) ? r : 0.f; }
    inline float Or(float l, float r) { return T(l) ? l : r; }
    inline float Round(float x) { return FMath::FloorToFloat(x + 0.5f); }

${DUEL.map(k => `    // ${FORMULA_KEYS[k][0]}: ${cfg.rules[k].replace(/\n/g, ' ')}\n    inline float ${pascal(k)}(${T} a, ${T} b, float lv) { return ${F[k]}; }`).join('\n')}
${SELF.map(k => `    // ${FORMULA_KEYS[k][0]}: ${cfg.rules[k].replace(/\n/g, ' ')}\n    inline float ${pascal(k)}(${T} s, float lv) { return ${F[k]}; }`).join('\n')}

    inline float HitChance(${T} a, ${T} b, float lv) { return FMath::Clamp(Hit(a, b, lv), HitMin, HitMax) / 100.f; }
}
`;
  const nonAscii = fields.filter(x => x.f !== x.id);
  const readme = `${GEN}

1. Source/ 아래 BattleRows.h, BattleRules.h를 프로젝트 모듈에 넣고 빌드합니다 (BattleRows.h의 .generated.h 이름은 파일 이름과 같아야 합니다).
2. 콘텐츠 브라우저에서 DT_BattleEntities.csv(또는 .json)를 가져오고 Row Structure = BattleEntityRow, DT_BattleItems는 BattleItemRow.
   JSON은 DataTable이 바로 읽는 행 배열 형식(각 행의 Name = 행 이름 = ID)입니다.
3. 규칙 수식: BattleRules::Damage(a, b, lv) 등. 스탯 맵은 TMap<FName, float>.
${nonAscii.length ? `4. C++ 이름으로 쓸 수 없는 스탯 이름은 바꿨습니다: ${nonAscii.map(x => `${x.id} → ${x.f}`).join(', ')}. 수식 안에서는 원래 이름(TEXT("${nonAscii[0].id}"))을 그대로 씁니다.\n` : ''}`;
  return [
    { name: 'DT_BattleEntities.csv', data: csv(entRows) },
    { name: 'DT_BattleEntities.json', data: JSON.stringify(entRows, null, 2) },
    { name: 'DT_BattleItems.csv', data: csv(itemRows) },
    { name: 'DT_BattleItems.json', data: JSON.stringify(itemRows, null, 2) },
    { name: 'Source/BattleRows.h', data: header },
    { name: 'Source/BattleRules.h', data: rules },
    { name: 'README.txt', data: readme },
  ];
}
