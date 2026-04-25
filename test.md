headless 대시보드 오케스트레이션 라이브러리.  
Grafana 기능 범위를 TanStack Table 방식의 public API로 제공한다.  
복잡도(DAG, 변수 치환, 캐싱, 가상화)는 엔진 내부에 완전히 숨긴다.

## 1. 패키지 구조

```
packages/
  core/              @dashboard-engine/core
                     - 엔진, DAG, 파서, 타입, defineXxx API, CoreEngineAPI
                     - React 의존성 없음 (순수 TS)
                     - timeRange를 optional first-class 개념으로 인식 (최적화용)

  react/             @dashboard-engine/react
                     - useDashboard, React 바인딩
                     - peerDependencies: react ^18 | ^19

  addon-time-range/  @dashboard-engine/addon-time-range   (선택)
                     - timeRange addon: 상대 시간 파싱, $__from/$__to/$__interval 등록
                     - time picker 상태 관리

  addon-refresh/     @dashboard-engine/addon-refresh       (선택)
                     - refresh addon: 폴링 타이머, engine.refreshAll() 연결

  rgl/               @dashboard-engine/rgl                 (선택)
                     - react-grid-layout 레이아웃 어댑터
```

**유즈케이스별 패키지 조합:**

```
Grafana형 (시계열 모니터링)
  core + react + addon-time-range + addon-refresh + rgl

Superset형 (BI / 데이터 탐색)
  core + react + rgl
  → timeRange addon 없음. variable만으로 모든 필터 처리.

AI / 보고서형
  core + react
  → addon 없음. custom fetch panel + env system만 사용.

임베디드 위젯
  core + react
  → 단일 패널. DashboardConfig 없이 panel plugin 직접 렌더.
```

사용자가 직접 구현하는 것: `defineDatasource`, `definePanel`, `defineVariableType` 에 구현체 등록.  
사용자가 신경 쓰지 않는 것: DAG 정렬, 변수 치환, 캐시 관리, 뷰포트 가상화.

---

## 2. 변수 참조 문법 및 파서

Grafana 호환 문법을 채택한다. Grafana 사용자에게 익숙하고, 포맷 지정자와 내장 함수를 동일한 문법으로 처리할 수 있다.

### 2.1 문법 정의

```
$varName                      단순 참조 (단일값)
${varName}                    중괄호 형식 (함수·포맷 없을 때 $varName 과 동일)
${varName:format}             포맷 지정자
$__builtinName                내장 변수 ($__ 접두사)
$__builtinFunc(arg1, arg2)    내장 함수 호출
```

**사용 예시:**

```sql
-- 단순 참조
SELECT * FROM $tableName WHERE country = '$country'

-- 포맷 지정자 (multi-value 처리)
SELECT * FROM sales
WHERE  city    IN (${city:sqlstring})     -- 'seoul','busan'
  AND  country IN (${country:csv})        -- seoul,busan
  AND  tags    @> ARRAY[${tags:json}]     -- ["tag1","tag2"]

-- 내장 변수
WHERE created_at > $__from AND created_at < $__to

-- 내장 함수 (datasource가 구현)
WHERE $__timeFilter(created_at)
GROUP BY $__timeGroup(created_at, $interval)
```

**변수가 다른 변수를 참조 → DAG 엣지 자동 생성:**

```yaml
variable: city
  query: "SELECT city FROM regions WHERE country = '$country'"
  # city → country 의존 엣지 생성
  # country 값 변경 시 city resolver 자동 재실행
```

### 2.2 포맷 지정자 (Format Specifiers)

multi-value 변수를 쿼리에 삽입할 때 형식을 지정한다.

| 포맷 | 입력 `['seoul', 'busan']` | 출력 | 용도 |
|------|--------------------------|------|------|
| `csv` | → | `seoul,busan` | 기본값. 단순 쉼표 구분 |
| `sqlstring` | → | `'seoul','busan'` | SQL `IN` 절 |
| `sqlin` | → | `('seoul','busan')` | SQL `IN (...)` 괄호 포함 |
| `json` | → | `["seoul","busan"]` | JSON 배열 |
| `regex` | → | `seoul\|busan` | 정규식 OR |
| `pipe` | → | `seoul\|busan` | 파이프 구분 |
| `glob` | → | `{seoul,busan}` | glob 패턴 |
| `raw` | → | `seoul,busan` | 이스케이프 없음 |
| `text` | → | `Seoul,Busan` | label 값 사용 |
| `queryparam` | → | `city=seoul&city=busan` | URL 쿼리 파라미터 |

단일값 변수에 포맷 지정자를 쓰면 값 하나에만 적용된다.  
포맷 미지정 시 단일값은 raw, multi-value는 `csv` 가 기본.

### 2.3 파서 구현 명세

```typescript
// packages/core/src/parser.ts

export interface TemplateToken {
  kind: 'variable' | 'builtin-var' | 'builtin-func';
  raw: string;          // 원본 토큰 전체 (치환 위치 특정용)
  name: string;         // 변수명 또는 함수명
  format?: string;      // 포맷 지정자 (변수일 때)
  args?: string[];      // 함수 인자 (builtin-func 일 때)
}

export interface ParseResult {
  tokens: TemplateToken[];    // 발견된 토큰 목록 (순서 유지)
  refs: string[];             // DAG 엣지 생성용 변수명 목록 (중복 제거)
  template: string;           // 원본 문자열
}

export function parseRefs(template: string): ParseResult {
  // 처리 순서 (우선순위 높은 것부터):
  // 1. $__name(arg1, arg2)  → builtin-func
  //    정규식: /\$__([a-zA-Z][a-zA-Z0-9]*)\(([^)]*)\)/g
  // 2. $__name              → builtin-var
  //    정규식: /\$__([a-zA-Z][a-zA-Z0-9]*)/g
  // 3. ${name:format}       → variable (format 있음)
  //    정규식: /\$\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z]+))?\}/g
  // 4. $name                → variable (format 없음)
  //    정규식: /\$([a-zA-Z_][a-zA-Z0-9_]*)/g
  //
  // - builtin-var, builtin-func 는 refs에 포함하지 않음 (DAG 대상 아님)
  // - refs: variable 종류만, Set으로 중복 제거
}
```

**동작 예시:**

| 입력 | tokens | refs |
|------|--------|------|
| `"$country"` | `[{kind:'variable', name:'country'}]` | `['country']` |
| `"${city:sqlstring}"` | `[{kind:'variable', name:'city', format:'sqlstring'}]` | `['city']` |
| `"$__from"` | `[{kind:'builtin-var', name:'from'}]` | `[]` |
| `"$__timeFilter(ts)"` | `[{kind:'builtin-func', name:'timeFilter', args:['ts']}]` | `[]` |
| `"$a and $a and $b"` | `[variable:a, variable:a, variable:b]` | `['a', 'b']` |

### 2.4 치환기 (Interpolator)

```typescript
// packages/core/src/parser.ts

export interface InterpolateContext {
  variables: Record<string, string | string[]>;   // 사용자 변수
  builtins: Record<string, string>;               // 내장 변수 ($__from 등)
  functions: Record<string, BuiltinFunction>;     // 내장 함수 ($__timeFilter 등)
}

export function interpolate(template: string, ctx: InterpolateContext): string {
  // 구현 규칙:
  // 1. parseRefs(template) 로 토큰 추출
  // 2. 각 토큰을 raw 문자열 기준으로 치환
  //
  // kind='variable':
  //   - ctx.variables[name] 조회
  //   - format 지정 시 → applyFormat(value, format) 호출
  //   - format 없고 string[] 이면 → csv (기본)
  //   - 값 없으면 '' (빈 문자열)
  //
  // kind='builtin-var':
  //   - ctx.builtins[name] 조회
  //   - 없으면 '' (경고 로그)
  //
  // kind='builtin-func':
  //   - ctx.functions[name] 조회 → fn(args, ctx) 호출
  //   - 없으면 원본 토큰 그대로 유지 (throw 하지 않음)
}

// 포맷 지정자 적용
// varName: queryparam 포맷에서 URL 키로 사용 (예: city=seoul&city=busan)
function applyFormat(value: string | string[], format: string, varName: string): string {
  const arr = Array.isArray(value) ? value : [value];
  switch (format) {
    case 'csv':         return arr.join(',');
    case 'sqlstring':   return arr.map(v => `'${v.replace(/'/g, "''")}'`).join(',');
    case 'sqlin':       return `(${arr.map(v => `'${v.replace(/'/g, "''")}'`).join(',')})` ;
    case 'json':        return JSON.stringify(arr);
    case 'regex':       return arr.map(escapeRegex).join('|');
    case 'pipe':        return arr.join('|');
    case 'glob':        return `{${arr.join(',')}}` ;
    case 'raw':         return arr.join(',');
    case 'text':        return arr.join(',');    // VariableOption.label 값 사용 (호출부에서 label 배열 전달)
    case 'queryparam':  return arr.map(v => `${varName}=${encodeURIComponent(v)}`).join('&');
    default:            return arr.join(',');    // 알 수 없는 포맷 → csv fallback
  }
}
```

---

## 3. 내장 변수·함수 시스템 (packages/core/src/builtins.ts)
<!-- 파서와 연결되는 시스템. 파서가 $__ 토큰을 감지 → 여기서 실행됨. -->

### 3.1 내장 변수 (Built-in Variables)

엔진이 런타임에 자동으로 주입하는 시스템 변수. `$__` 접두사.  
사용자가 같은 이름의 변수를 만들 수 없다 (등록 시 오류).

```typescript
export interface BuiltinVariable {
  name: string;                         // $__ 제외한 이름
  description: string;
  resolve: (ctx: BuiltinContext) => string;
}

export interface BuiltinContext {
  timeRange: { from: string; to: string };   // ISO 8601
  dashboard: { id: string; title: string };
}
```

**엔진 내장 변수 (라이브러리 기본 제공):**

| 변수 | 반환값 | 예시 |
|------|--------|------|
| `$__from` | 시간 범위 시작 (ms epoch) | `1704067200000` |
| `$__to` | 시간 범위 끝 (ms epoch) | `1704153600000` |
| `$__fromISO` | 시작 ISO 8601 | `2024-01-01T00:00:00Z` |
| `$__toISO` | 끝 ISO 8601 | `2024-01-02T00:00:00Z` |
| `$__interval` | 자동 계산 interval | `5m` |
| `$__intervalMs` | interval (ms) | `300000` |
| `$__dashboard` | 대시보드 제목 | `Sales Overview` |

### 3.2 내장 함수 (Built-in Functions)

함수 호출 형식: `$__funcName(arg1, arg2)`.  
datasource마다 SQL 방언이 다르므로, **함수는 datasource 플러그인에서 등록**한다.

```typescript
export interface BuiltinFunction {
  name: string;                         // $__ 제외한 이름
  description: string;
  // args: 쿼리에서 파싱된 인자 문자열 배열
  // ctx: 현재 builtins (timeRange 등) 참조 가능
  call: (args: string[], ctx: BuiltinContext) => string;
}
```

**PostgreSQL datasource 내장 함수 예시:**

```typescript
const postgresBuiltins: BuiltinFunction[] = [
  {
    name: 'timeFilter',
    description: 'WHERE 절용 시간 필터 생성',
    // $__timeFilter(created_at)
    // → "created_at BETWEEN '2024-01-01T00:00:00Z' AND '2024-01-02T00:00:00Z'"
    call: ([col], ctx) =>
      `${col} BETWEEN '${ctx.timeRange.from}' AND '${ctx.timeRange.to}'`,
  },
  {
    name: 'timeGroup',
    description: 'GROUP BY 시간 버킷 생성',
    // $__timeGroup(created_at, $interval)
    // → "date_trunc('hour', created_at)"
    call: ([col, interval]) => {
      const trunc = intervalToPostgresTrunc(interval); // '1h' → 'hour'
      return `date_trunc('${trunc}', ${col})`;
    },
  },
  {
    name: 'timeGroupAlias',
    description: 'timeGroup + AS time 별칭 포함',
    // → "date_trunc('hour', created_at) AS time"
    call: ([col, interval]) => {
      const trunc = intervalToPostgresTrunc(interval);
      return `date_trunc('${trunc}', ${col}) AS time`;
    },
  },
];
```

**ClickHouse datasource 내장 함수 예시 (방언 다름):**

```typescript
const clickhouseBuiltins: BuiltinFunction[] = [
  {
    name: 'timeFilter',
    // $__timeFilter(created_at)
    // → "created_at >= toDateTime(1704067200) AND created_at <= toDateTime(1704153600)"
    call: ([col], ctx) => {
      const from = Math.floor(new Date(ctx.timeRange.from).getTime() / 1000);
      const to   = Math.floor(new Date(ctx.timeRange.to).getTime()   / 1000);
      return `${col} >= toDateTime(${from}) AND ${col} <= toDateTime(${to})`;
    },
  },
  {
    name: 'timeGroup',
    // $__timeGroup(created_at, $interval)
    // → "toStartOfInterval(created_at, INTERVAL 5 MINUTE)"
    call: ([col, interval]) => {
      const { amount, unit } = parseInterval(interval); // '5m' → {amount:5, unit:'MINUTE'}
      return `toStartOfInterval(${col}, INTERVAL ${amount} ${unit})`;
    },
  },
];
```

### 3.3 defineDatasource 에 builtins 추가

```typescript
export interface DatasourcePluginDef {
  id: string;
  name: string;
  optionsSchema: OptionSchema;

  query: (options: QueryOptions) => Promise<QueryResult>;
  metricFindQuery?: (query: string, vars: Record<string, string>) => Promise<VariableOption[]>;
  configEditor?: React.ComponentType<{ ... }>;

  // datasource 전용 내장 함수 (SQL 방언별로 다름)
  builtins?: BuiltinFunction[];
}
```

### 3.4 전역 내장 변수 등록 (사용자 확장)

엔진 수준에서 전역 내장 변수를 추가할 수 있다.  
datasource 무관하게 모든 쿼리에서 사용 가능.

```typescript
const engine = createDashboardEngine({
  panels: [...],
  datasources: [...],
  variableTypes: [...],

  // 사용자 정의 전역 내장 변수
  builtinVariables: [
    {
      name: 'orgId',
      description: '현재 조직 ID',
      resolve: (ctx) => getCurrentUser().orgId,
    },
    {
      name: 'userId',
      description: '현재 사용자 ID',
      resolve: (ctx) => getCurrentUser().id,
    },
  ],
});
```

### 3.5 치환 실행 시 내장 변수·함수 주입 흐름

```
interpolate(query, ctx) 호출 전, 엔진이 ctx 구성:

ctx.builtins = {
  from:         String(timeRange.from ms),
  to:           String(timeRange.to ms),
  fromISO:      timeRange.from,
  toISO:        timeRange.to,
  interval:     calculateInterval(timeRange, maxDataPoints),
  intervalMs:   String(calculateIntervalMs(...)),
  dashboard:    config.title,
  ...userDefinedBuiltins,           // createDashboardEngine.builtinVariables
}

ctx.functions = {
  ...datasourcePlugin.builtins,     // 현재 패널의 datasource 전용 함수
}

// 동일 이름 충돌 시: datasource 함수 > 전역 함수 (명시적 우선순위)
```

---

## 4. 핵심 타입 (packages/core/src/types.ts)

Zod 사용 원칙:
- **직렬화되는 JSON 구조** (`DashboardConfig` 및 하위 타입) → Zod 스키마로 정의. `z.infer<>` 로 TypeScript 타입 자동 생성.
- **런타임 전용 상태** (`PanelState`, `VariableState`) → 일반 `interface`. JSON에 저장되지 않으며 검증 불필요.
- **함수 인자** (`QueryOptions`) → 일반 `interface`. 내부 코드에서만 생성되며 외부 입력 아님.

### 4.1 Zod 스키마 (JSON 직렬화 대상)

```typescript
// packages/core/src/types.ts
import { z } from 'zod';

// ─── 변수명 유효성 ────────────────────────────────────────────────────────────
// $varName 파서 허용 문자와 동일하게 맞춤
// $__ 접두사는 내장 변수 예약 → 사용자 변수로 등록 불가
const VariableNameSchema = z.string()
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    'Variable name must start with a letter or underscore, no dots allowed'
  )
  .refine(
    (name) => !name.startsWith('__'),
    '$__ prefix is reserved for built-in variables'
  );

// ─── 데이터소스 참조 ──────────────────────────────────────────────────────────
export const DataSourceRefSchema = z.object({
  id:      z.string().min(1),
  name:    z.string().min(1),
  type:    z.string().min(1),           // defineDatasource 의 id
  options: z.record(z.unknown()).default({}),  // 연결 설정 (암호화 후 저장 권장)
});

// ─── 변수 설정 ────────────────────────────────────────────────────────────────
export const VariableConfigSchema = z.object({
  name:         VariableNameSchema,
  type:         z.string().min(1),      // defineVariableType 의 id
  label:        z.string().optional(),  // UI 표시용 레이블 (없으면 name 사용)
  datasourceId: z.string().optional(),
  query:        z.string().optional(),  // $varName 참조 가능
  defaultValue: z.union([z.string(), z.array(z.string())]).nullable().default(null),
  multi:        z.boolean().default(false),
  options:      z.record(z.unknown()).default({}),  // variable type 플러그인 전용 설정
});

// ─── 패널 설정 ────────────────────────────────────────────────────────────────
// datasourceId / query 는 optional - 정적 패널(텍스트, 마크다운 등)은 불필요
export const PanelConfigSchema = z.object({
  id:           z.string().min(1),
  type:         z.string().min(1),               // definePanel 의 id
  title:        z.string().default(''),          // $varName 참조 가능
  description:  z.string().default(''),
  datasourceId: z.string().optional(),           // 정적 패널은 생략
  query:        z.string().optional(),           // 정적 패널은 생략. $varName 참조 가능
  options:      z.record(z.unknown()).default({}),
}).refine(
  // datasourceId 있으면 query 도 있어야 함 (둘 중 하나만 있는 상태 방지)
  (p) => !(p.datasourceId && !p.query),
  { message: 'query is required when datasourceId is provided', path: ['query'] }
);

// ─── 레이아웃 셀 ─────────────────────────────────────────────────────────────
export const LayoutCellSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(24),
  h: z.number().int().min(1),
});

// ─── 대시보드 전체 설정 (저장/로드 단위) ────────────────────────────────────
export const DashboardConfigSchema = z.object({
  version:     z.literal('1'),
  id:          z.string().min(1),
  title:       z.string().min(1),
  description: z.string().default(''),
  tags:        z.array(z.string()).default([]),
  datasources: z.array(DataSourceRefSchema).default([]),
  variables:   z.array(VariableConfigSchema).default([]),
  panels:      z.array(PanelConfigSchema),
  layout: z.object({
    cols:      z.number().int().min(1).default(12),
    rowHeight: z.number().int().min(1).default(80),
    cells:     z.record(LayoutCellSchema),
  }),
  // 시계열 대시보드만 사용. 보고서/AI 대시보드는 생략 가능.
  timeRange: z.object({
    from: z.string(),   // ISO 8601 또는 'now-6h' 같은 상대 표현
    to:   z.string(),
  }).optional(),
});

// ─── 추론된 TypeScript 타입 (interface 직접 작성 불필요) ─────────────────────
export type DataSourceRef   = z.infer<typeof DataSourceRefSchema>;
export type VariableConfig  = z.infer<typeof VariableConfigSchema>;
export type PanelConfig     = z.infer<typeof PanelConfigSchema>;
export type LayoutCell      = z.infer<typeof LayoutCellSchema>;
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;
```

**파싱 사용법:**

```typescript
// 로드 시 - safeParse 로 오류를 던지지 않고 결과 확인
const result = DashboardConfigSchema.safeParse(rawJson);
if (!result.success) {
  // result.error.issues 에 필드별 오류 경로와 메시지 포함
  // 예: [{ path: ['panels', 0, 'id'], message: 'Required' }]
  throw new DashboardConfigError(result.error.issues);
}
const config = result.data;  // default 값 주입 완료, 타입 안전

// 저장 시 - 직렬화 전 재검증
const json = DashboardConfigSchema.parse(config);
await save(JSON.stringify(json));
```

**layout.cells 교차 검증:**  
`DashboardConfigSchema.superRefine`으로 `cells`의 모든 key가 `panels`에 존재해야 함을 추가 검증한다. Zod `record`만으로는 이 제약을 표현할 수 없다.

```typescript
.superRefine((cfg, ctx) => {
  const panelIds = new Set(cfg.panels.map((p) => p.id));
  for (const cellId of Object.keys(cfg.layout.cells)) {
    if (!panelIds.has(cellId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['layout', 'cells', cellId],
        message: `layout.cells key "${cellId}" does not match any panel id`,
      });
    }
  }
})
```

### 4.2 런타임 전용 타입 (일반 interface)

JSON에 저장되지 않고 엔진 내부 스토어에만 존재한다. Zod 검증 불필요.

```typescript
// ─── 쿼리 실행 인자 ──────────────────────────────────────────────────────────
// 내부 코드에서만 생성. 외부 입력 아님.
export interface QueryOptions {
  query:         string;                      // interpolate() 완료된 쿼리
  variables:     Record<string, string>;      // 디버깅/로깅용 원본 변수값
  datasourceId:  string;
  timeRange?:    { from: string; to: string };
  maxDataPoints?: number;
}

// ─── 쿼리 응답 ───────────────────────────────────────────────────────────────
export interface QueryResult {
  columns: Array<{ name: string; type: string }>;
  rows:    unknown[][];
  meta?:   Record<string, unknown>;           // datasource 고유 메타데이터
}

// ─── 변수 드롭다운 선택지 ─────────────────────────────────────────────────────
export interface VariableOption {
  label: string;
  value: string;
}

// ─── 런타임 변수 상태 (Zustand 스토어) ───────────────────────────────────────
export interface VariableState {
  name:    string;
  type:    string;
  value:   string | string[];
  options: VariableOption[];
  loading: boolean;
  error:   string | null;
}

// ─── 런타임 패널 상태 (Zustand 스토어) ───────────────────────────────────────
export interface PanelState {
  id:      string;
  data:    unknown;                           // transport.transform() 결과
  rawData: QueryResult | null;
  loading: boolean;
  error:   string | null;
  width:   number;
  height:  number;
  active:  boolean;                           // 뷰포트 진입 여부
}
```

---

## 5. Dashboard JSON 포맷 (완전한 예시)

실제로 저장되고 로드되는 JSON 구조. 이 포맷이 `DashboardConfig` 의 직렬화 결과다.

```json
{
  "version": "1",
  "id": "sales-overview-2024",
  "title": "Sales Overview",
  "description": "지역별 매출 현황 대시보드",
  "tags": ["sales", "production"],

  "datasources": [
    {
      "id": "postgres-main",
      "name": "Main PostgreSQL",
      "type": "postgres",
      "options": {
        "host": "db.example.com",
        "port": 5432,
        "database": "analytics"
      }
    }
  ],

  "variables": [
    {
      "name": "country",
      "type": "query",
      "label": "Country",
      "datasourceId": "postgres-main",
      "query": "SELECT DISTINCT country FROM regions ORDER BY country",
      "defaultValue": "KR",
      "multi": false,
      "options": {}
    },
    {
      "name": "city",
      "type": "query",
      "label": "City",
      "datasourceId": "postgres-main",
      "query": "SELECT city FROM regions WHERE country = '$country'",
      "defaultValue": null,
      "multi": true,
      "options": {}
    },
    {
      "name": "interval",
      "type": "interval",
      "label": "Interval",
      "defaultValue": "1h",
      "multi": false,
      "options": {}
    },
    {
      "name": "status",
      "type": "custom",
      "label": "Status",
      "defaultValue": "active",
      "multi": false,
      "options": {
        "items": [
          { "label": "Active",   "value": "active"   },
          { "label": "Inactive", "value": "inactive" }
        ]
      }
    }
  ],

  "panels": [
    {
      "id": "panel-timeseries-001",
      "type": "timeseries",
      "title": "$country Sales - $interval interval",
      "description": "시간대별 매출 추이",
      "datasourceId": "postgres-main",
      "query": "SELECT $__timeGroup(time, $interval) AS time, amount FROM sales WHERE $__timeFilter(time) AND country = '$country' AND city IN (${city:sqlin}) GROUP BY 1",
      "options": {
        "strokeWidth": 2,
        "fillOpacity": 0.1,
        "yAxisLabel": "Sales (USD)",
        "showLegend": true,
        "colorScheme": "blue"
      }
    },
    {
      "id": "panel-table-002",
      "type": "table",
      "title": "Raw Data",
      "description": "",
      "datasourceId": "postgres-main",
      "query": "SELECT * FROM sales WHERE $__timeFilter(time) AND country = '$country' LIMIT 100",
      "options": {
        "pageSize": 20,
        "sortable": true,
        "columns": [
          { "field": "time",    "label": "Time",    "width": 180 },
          { "field": "amount",  "label": "Amount",  "width": 120 },
          { "field": "country", "label": "Country", "width": 100 }
        ]
      }
    }
  ],

  "layout": {
    "cols": 12,
    "rowHeight": 80,
    "cells": {
      "panel-timeseries-001": { "x": 0, "y": 0, "w": 8, "h": 4 },
      "panel-table-002":      { "x": 8, "y": 0, "w": 4, "h": 4 }
    }
  }
}
```

### 포맷 규칙

| 필드 | 필수 | 설명 |
|------|------|------|
| `version` | O | 항상 `"1"`. 마이그레이션 분기에 사용 |
| `id` | O | 대시보드 고유 식별자. URL slug로 사용 가능 |
| `datasources[].options` | - | 플러그인이 정의한 연결 설정. 암호화 권장 |
| `variables[].options` | - | variable type 플러그인이 정의한 추가 설정 |
| `panels[].options` | - | panel 플러그인이 정의한 시각화 설정 |
| `panels[].title` | O | `$varName` 참조 가능. 런타임에 치환됨 |
| `layout.cells` | O | panelId → `{x, y, w, h}`. 그리드 단위 |

---

## 6. Plugin Options 시스템

각 플러그인은 `options` 의 스키마를 직접 정의한다.  
엔진은 `options` 내부 구조를 모르며, 플러그인에게 그대로 전달만 한다.

### 6.1 OptionSchema 타입

플러그인이 자신의 `options` 구조를 선언하는 방식.  
에디터 UI 자동 생성, 유효성 검사, 기본값 주입에 사용된다.

```typescript
// packages/core/src/options.ts

export type OptionFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'      // 고정 선택지
  | 'multiselect' // 다중 선택
  | 'color'       // 색상 피커
  | 'json'        // 자유 JSON 입력
  | 'array';      // 배열 (items 스키마 재귀 적용)

export interface OptionField {
  type: OptionFieldType;
  label: string;
  description?: string;
  default?: unknown;

  // type='select' | 'multiselect'
  choices?: Array<{ label: string; value: unknown }>;

  // type='number'
  min?: number;
  max?: number;
  step?: number;

  // type='array'
  items?: OptionSchema;

  // 이 필드를 보여줄 조건 (다른 옵션값에 따른 동적 표시)
  showIf?: (options: Record<string, unknown>) => boolean;
}

export type OptionSchema = Record<string, OptionField>;
```



---

## 7. defineXxx Public API (packages/core/src/define.ts)

사용자가 플러그인을 등록하는 진입점. 세 함수 모두 타입 안전한 팩토리.

```typescript
// packages/core/src/define.ts

// ─── Datasource 플러그인 ──────────────────────────────────────────────────────
export interface DatasourcePluginDef<TOptions = Record<string, unknown>> {
  id: string;
  name: string;
  optionsSchema: OptionSchema;
  builtins?: BuiltinFunction[];                    // datasource 전용 내장 함수

  query: (options: QueryOptions<TOptions>) => Promise<QueryResult>;
  metricFindQuery?: (
    query: string,
    vars: Record<string, string | string[]>,
  ) => Promise<VariableOption[]>;
}

export function defineDatasource<TOptions = Record<string, unknown>>(
  def: DatasourcePluginDef<TOptions>,
): DatasourcePluginDef<TOptions> {
  return def;
}

// ─── Panel 플러그인 ───────────────────────────────────────────────────────────
export interface PanelPluginDef<TOptions = Record<string, unknown>, TData = unknown> {
  id: string;
  name: string;
  optionsSchema: OptionSchema;

  // QueryResult → 패널이 소비할 형태로 변환
  transform?: (result: QueryResult) => TData;
  // React 컴포넌트 (headless: 스타일 없음)
  component: React.ComponentType<PanelProps<TOptions, TData>>;
}

export interface PanelProps<TOptions, TData> {
  options: TOptions;
  data: TData;
  rawData: QueryResult | null;
  width: number;
  height: number;
  loading: boolean;
  error: string | null;
}

export function definePanel<TOptions = Record<string, unknown>, TData = unknown>(
  def: PanelPluginDef<TOptions, TData>,
): PanelPluginDef<TOptions, TData> {
  return def;
}

// ─── VariableType 플러그인 ────────────────────────────────────────────────────
export interface VariableTypePluginDef<TOptions = Record<string, unknown>> {
  id: string;
  name: string;
  optionsSchema: OptionSchema;

  // 변수 선택지를 계산하는 함수
  resolve: (
    config: VariableConfig,
    options: TOptions,
    ctx: VariableResolveContext,
  ) => Promise<VariableOption[]>;
}

export interface VariableResolveContext {
  datasources: Record<string, DatasourcePluginDef>;
  builtins: Record<string, string>;     // 현재 내장 변수 값
  variables: Record<string, string | string[]>;  // 이미 해결된 변수 값
}

export function defineVariableType<TOptions = Record<string, unknown>>(
  def: VariableTypePluginDef<TOptions>,
): VariableTypePluginDef<TOptions> {
  return def;
}
```

---

## 8. CoreEngineAPI (packages/core/src/engine.ts)

`createDashboardEngine`이 반환하는 인터페이스. React 없이도 사용 가능.

```typescript
// packages/core/src/engine.ts

export interface CreateDashboardEngineOptions {
  panels:        PanelPluginDef[];
  datasources:   DatasourcePluginDef[];
  variableTypes: VariableTypePluginDef[];
  builtinVariables?: BuiltinVariable[];   // 전역 내장 변수 추가
}

export interface CoreEngineAPI {
  // ─── 설정 로드 ────────────────────────────────────────────────────────────
  load(config: DashboardConfig): void;
  getConfig(): DashboardConfig;

  // ─── 변수 ─────────────────────────────────────────────────────────────────
  getVariable(name: string): VariableState;
  setVariable(name: string, value: string | string[]): void;
  refreshVariables(): Promise<void>;          // DAG 위상 정렬 후 순차 실행

  // ─── 패널 ─────────────────────────────────────────────────────────────────
  getPanel(panelId: string): PanelState;
  refreshPanel(panelId: string): Promise<void>;
  refreshAll(): Promise<void>;                // 모든 활성 패널 병렬 새로고침

  // ─── 시간 범위 (addon-time-range 없어도 직접 설정 가능) ─────────────────
  setTimeRange(range: { from: string; to: string }): void;
  getTimeRange(): { from: string; to: string } | undefined;

  // ─── 구독 ─────────────────────────────────────────────────────────────────
  subscribe(listener: (event: EngineEvent) => void): () => void;  // unsubscribe 반환
}

export type EngineEvent =
  | { type: 'variable-changed'; name: string; value: string | string[] }
  | { type: 'panel-loading';    panelId: string }
  | { type: 'panel-data';       panelId: string; data: unknown }
  | { type: 'panel-error';      panelId: string; error: string }
  | { type: 'time-range-changed'; range: { from: string; to: string } };

export function createDashboardEngine(
  options: CreateDashboardEngineOptions,
): CoreEngineAPI {
  // 구현체 반환. DAG, 캐시, 스토어 초기화.
  // ...
}
```

**addon 연결 방식:**

```typescript
// addon은 CoreEngineAPI를 받아서 side effect로 기능을 추가하는 패턴
// packages/addon-time-range/src/index.ts

export function attachTimeRangeAddon(
  engine: CoreEngineAPI,
  options?: { defaultRange?: { from: string; to: string } },
): TimeRangeAddonAPI {
  // engine.setTimeRange() 래핑, 상대 시간 파싱, 내장 변수 주입
  return { /* ... */ };
}
```

---

## 9. DAG 및 캐싱 전략 (packages/core/src/dag.ts)

### 9.1 DAG 구성 및 순환 탐지

```
변수 등록 시 (engine.load 호출 시점):
  1. 각 VariableConfig.query 에 parseRefs() 실행
  2. refs → DAG 엣지 추가 (dependency: name → ref)
  3. 위상 정렬 (Kahn's algorithm)
  4. 사이클 감지 시 즉시 오류: "Circular variable dependency: city → country → city"
  5. 정렬된 실행 순서를 저장 (변수 refresh 시 이 순서로 실행)
```

```typescript
// 순환 탐지 오류 타입
export class CircularDependencyError extends Error {
  constructor(public cycle: string[]) {
    super(`Circular variable dependency: ${cycle.join(' → ')}`);
  }
}
```

### 9.2 캐싱 전략

```
캐시 키: `${datasourceId}::${interpolatedQuery}::${timeRange?.from}::${timeRange?.to}`

캐시 정책:
  - 변수 변경 시: 해당 변수를 참조하는 패널 캐시만 무효화
  - 시간 범위 변경 시: 전체 패널 캐시 무효화
  - refreshPanel(id) 호출 시: 해당 패널 캐시만 무효화
  - refreshAll() 호출 시: 전체 캐시 무효화

캐시 저장소: Map<string, { data: QueryResult; ts: number }>
TTL: 기본 없음 (explicit invalidation 방식). addon-refresh에서 폴링 시 무효화.
```

---

## 10. 뷰포트 가상화 전략 (packages/react/src/DashboardGrid.tsx)

```
PanelState.active: 패널이 뷰포트 안에 있는지 여부.

구현:
  1. IntersectionObserver 로 각 패널 DOM 감지
  2. 진입 시: active = true → engine.refreshPanel(id) 트리거
  3. 이탈 시: active = false → 다음 refreshAll()에서 이 패널 스킵

패널 렌더:
  - active=false 패널: placeholder div (height 유지, 쿼리 없음)
  - active=true 패널: 실제 패널 컴포넌트 마운트

이점: 화면 밖 100개 패널이 있어도 뷰포트 내 패널만 쿼리 실행.
```

---

## 11. 보안 고려 사항

### SQL Injection 경고

`interpolate()`가 반환하는 쿼리 문자열은 변수값을 직접 삽입한다.  
`sqlstring` / `sqlin` 포맷은 single-quote escape를 수행하지만, **이것이 유일한 방어선이 되어서는 안 된다.**

**datasource 구현체에서 권장하는 방어:**
1. **Parameterized query 우선**: datasource가 지원하면 `query` 문자열 대신 `{ sql, params }` 형태로 분리해서 전달하도록 `QueryOptions`를 확장할 수 있다.
2. **신뢰 경계 명시**: `interpolate()`에 들어오는 변수값은 "사용자가 UI에서 선택한 값" 또는 "datasource 쿼리 결과"로 제한된다. 임의 문자열 입력을 직접 변수값으로 주입하면 안 된다.
3. **변수값 allowlist**: `VariableOption[]` 기반 변수(query/custom type)는 선택지 이외의 값을 값으로 수용하지 않는다 (`setVariable` 에서 검증).
