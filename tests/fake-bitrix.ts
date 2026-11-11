// Simulador mínimo do REST do Bitrix24 para testes de desempenho e
// regressão, sem portal real. Cobre só o que o Jornada usa: listas com
// paginação de 50, filtros com prefixo (>=, <=, >, @), batch com subcomandos
// em query string (interpretados como o parse_str do PHP), halt, permissões
// por negócio e o limite de intensidade (leaky bucket 50 / 2 por segundo).

export interface FakeOptions {
  deals?: number;
  /** Movimentações por negócio (além da criação). */
  moves?: (id: number) => number;
  /** Negócios que o usuário não pode ler. */
  forbidden?: (id: number) => boolean;
  /** Latência simulada de cada chamada HTTP, em ms. */
  latencyMs?: number;
  /** Aplica o limite real do Bitrix24 (rajada 50, 2 por segundo). */
  enforceLimit?: boolean;
  now?: number;
}

type Row = Record<string, unknown>;
const DAY = 86400000;
const PAGE = 50;

/** Interpreta "a[b][]=1&c=2" como o parse_str do PHP. */
export function parseQuery(query: string): Row {
  const result: Row = {};
  for (const pair of query.split("&").filter(Boolean)) {
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1));
    const key = decodeURIComponent(rawKey);
    const base = key.slice(0, key.indexOf("[") === -1 ? undefined : key.indexOf("["));
    const parts = [base, ...[...key.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1])];
    let target: Row = result;
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      if (last) {
        if (part === "") (target as unknown as unknown[]).push(value);
        else target[part] = value;
        return;
      }
      const nextIsList = parts[index + 1] === "";
      const name = part === "" ? String((target as unknown as unknown[]).length) : part;
      if (target[name] === undefined) target[name] = nextIsList ? [] : {};
      target = target[name] as Row;
    });
  }
  return result;
}

function compare(a: unknown, b: unknown) {
  const ta = typeof a === "string" && /^\d{4}-\d\d-\d\dT/.test(a) ? Date.parse(a) : Number(a);
  const tb = typeof b === "string" && /^\d{4}-\d\d-\d\dT/.test(b) ? Date.parse(b) : Number(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return String(a).localeCompare(String(b));
}
function matches(row: Row, filter: Row = {}) {
  return Object.entries(filter).every(([rawKey, expected]) => {
    const op = /^(>=|<=|>|<|@|!)?(.*)$/.exec(rawKey)!;
    const field = op[2];
    const actual = row[field] ?? row[field.toUpperCase()];
    const list = Array.isArray(expected)
      ? expected
      : expected && typeof expected === "object"
        ? Object.values(expected)
        : undefined;
    switch (op[1]) {
      case ">=":
        return compare(actual, expected) >= 0;
      case "<=":
        return compare(actual, expected) <= 0;
      case ">":
        return compare(actual, expected) > 0;
      case "<":
        return compare(actual, expected) < 0;
      default:
        return list
          ? list.some((v) => String(v) === String(actual))
          : String(expected) === String(actual);
    }
  });
}
function sortRows(rows: Row[], order: Row = {}) {
  const keys = Object.entries(order);
  return [...rows].sort((a, b) => {
    for (const [field, dir] of keys) {
      const diff = compare(a[field], b[field]);
      if (diff) return String(dir).toUpperCase() === "DESC" ? -diff : diff;
    }
    return 0;
  });
}

export function createFakeBitrix(options: FakeOptions = {}) {
  const now = options.now ?? Date.now();
  const dealCount = options.deals ?? 120;
  const moves = options.moves ?? ((id) => id % 6);
  const forbidden = options.forbidden ?? ((id) => id % 37 === 0);
  const stages = {
    0: [
      ["NEW", "Novo", "P"],
      ["PREPARATION", "Proposta", "P"],
      ["EXECUTING", "Negociação", "P"],
      ["WON", "Ganho", "S"],
      ["LOSE", "Perdido", "F"],
    ],
    3: [
      ["C3:NEW", "Entrada", "P"],
      ["C3:WORK", "Atendimento", "P"],
      ["C3:WON", "Concluído", "S"],
      ["C3:LOSE", "Cancelado", "F"],
    ],
  } as Record<number, string[][]>;
  const history: Row[] = [];
  const deals: Row[] = [];
  let historyId = 1;
  // Histórico em ordem cronológica global, como os IDs reais.
  const plan: { deal: number; at: number; stage: string[]; category: number; by: number }[] = [];
  for (let id = 1; id <= dealCount; id += 1) {
    const category = id % 4 === 0 ? 3 : 0;
    const list = stages[category];
    const created = now - ((id * 7919) % 60) * DAY - (id % 24) * 3600000;
    const steps = moves(id);
    for (let step = 0; step <= steps; step += 1) {
      const index =
        step === steps && steps >= 3 && id % 2 === 0
          ? list.length - (id % 3 === 0 ? 1 : 2)
          : Math.min(step, list.length - 3);
      plan.push({
        deal: id,
        at: Math.min(now - 60000, created + step * (((id * 31) % 5) + 1) * DAY),
        stage: list[index],
        category,
        by: (id + step) % 5 + 1,
      });
    }
  }
  plan.sort((a, b) => a.at - b.at || a.deal - b.deal);
  for (const p of plan)
    history.push({
      ID: historyId++,
      OWNER_ID: p.deal,
      CATEGORY_ID: p.category,
      STAGE_ID: p.stage[0],
      STAGE_SEMANTIC_ID: p.stage[2],
      CREATED_TIME: new Date(p.at).toISOString(),
      MOVED_BY: p.by,
    });
  for (let id = 1; id <= dealCount; id += 1) {
    const last = history.filter((h) => h.OWNER_ID === id).at(-1)!;
    deals.push({
      id,
      title: `Negócio ${id}`,
      categoryId: last.CATEGORY_ID,
      stageId: last.STAGE_ID,
      stageSemanticId: last.STAGE_SEMANTIC_ID,
      movedTime: last.CREATED_TIME,
      movedBy: last.MOVED_BY,
    });
  }
  const readableDeals = () => deals.filter((d) => !forbidden(Number(d.id)));

  function page(rows: Row[], params: Row, wrap: (items: Row[]) => unknown) {
    const start = Number(params.start ?? 0);
    if (start === -1) return { result: wrap(rows.slice(0, PAGE)) };
    const items = rows.slice(start, start + PAGE);
    return {
      result: wrap(items),
      total: rows.length,
      ...(start + PAGE < rows.length ? { next: start + PAGE } : {}),
    };
  }
  function pick(row: Row, select: unknown) {
    const fields = Array.isArray(select)
      ? select
      : select && typeof select === "object"
        ? Object.values(select)
        : undefined;
    if (!fields?.length) return row;
    return Object.fromEntries(
      Object.entries(row).filter(([k]) => fields.includes(k)),
    );
  }
  class ApiError extends Error {
    constructor(
      public code: string,
      public status = 400,
    ) {
      super(code);
    }
  }
  const methods: Record<string, (params: Row) => Row> = {
    "app.info": () => ({ result: { CODE: "local.test" } }),
    profile: () => ({ result: { ID: 7, NAME: "Ana" } }),
    "crm.category.list": () => ({
      result: {
        categories: [
          { id: 0, name: "Comercial" },
          { id: 3, name: "Pós-venda" },
        ],
      },
      total: 2,
    }),
    "crm.status.entity.items": (params) => {
      const entity = String(params.entityId);
      const category = entity === "DEAL_STAGE" ? 0 : Number(entity.split("_").at(-1));
      return {
        result: (stages[category] ?? []).map(([STATUS_ID, NAME], index) => ({
          STATUS_ID,
          NAME,
          SORT: (index + 1) * 10,
          COLOR: "#3366cc",
        })),
      };
    },
    "crm.stagehistory.list": (params) => {
      const rows = sortRows(
        history.filter((h) => matches(h, params.filter as Row)),
        (params.order as Row) ?? { ID: "ASC" },
      ).map((h) => pick(h, params.select));
      return page(rows, params, (items) => ({ items }));
    },
    "crm.item.list": (params) => {
      const rows = sortRows(
        readableDeals().filter((d) => matches(d, params.filter as Row)),
        (params.order as Row) ?? { id: "ASC" },
      ).map((d) => pick(d, params.select));
      return page(rows, params, (items) => ({ items }));
    },
    "crm.item.get": (params) => {
      const id = Number(params.id);
      const deal = deals.find((d) => d.id === id);
      if (!deal) throw new ApiError("NOT_FOUND", 400);
      if (forbidden(id)) throw new ApiError("ACCESS_DENIED", 403);
      return { result: { item: deal } };
    },
    "user.get": (params) => {
      const id = Number((params.FILTER as Row | undefined)?.ID);
      return {
        result: id ? [{ ID: String(id), NAME: `Pessoa`, LAST_NAME: `${id}` }] : [],
      };
    },
    "crm.timeline.comment.add": () => ({ result: 1 }),
  };

  const stats = { hits: 0, byMethod: {} as Record<string, number>, subcommands: 0, limitErrors: 0 };
  let bucket = 0;
  let bucketAt = Date.now();
  function hit() {
    const t = Date.now();
    bucket = Math.max(0, bucket - ((t - bucketAt) / 1000) * 2);
    bucketAt = t;
    bucket += 1;
    return bucket > 50;
  }
  function run(method: string, params: Row): Row {
    stats.byMethod[method] = (stats.byMethod[method] ?? 0) + 1;
    if (method === "batch") {
      const cmd = (params.cmd ?? {}) as Record<string, string>;
      const halt = String(params.halt) === "1" || params.halt === true;
      const result: Row = {};
      const errors: Row = {};
      const total: Row = {};
      const next: Row = {};
      for (const [key, command] of Object.entries(cmd)) {
        stats.subcommands += 1;
        const [sub, query = ""] = command.split(/\?(.*)/s);
        try {
          const response = run(sub, parseQuery(query));
          result[key] = response.result;
          if (response.total !== undefined) total[key] = response.total;
          if (response.next !== undefined) next[key] = response.next;
        } catch (error) {
          errors[key] = { error: (error as Error).message, error_description: "" };
          if (halt) break;
        }
      }
      const orEmpty = (v: Row) => (Object.keys(v).length ? v : []);
      return {
        result: {
          result: orEmpty(result),
          result_error: orEmpty(errors),
          result_total: orEmpty(total),
          result_next: orEmpty(next),
          result_time: [],
        },
      };
    }
    const handler = methods[method];
    if (!handler) throw new ApiError("ERROR_METHOD_NOT_FOUND", 404);
    return handler(params);
  }

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const match = /\/rest\/(.+)\.json$/.exec(url);
    if (!match) throw new Error(`URL inesperada no teste: ${url}`);
    stats.hits += 1;
    if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs));
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (options.enforceLimit && hit()) {
      stats.limitErrors += 1;
      return json({ error: "QUERY_LIMIT_EXCEEDED", error_description: "" }, 503);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Row;
    try {
      return json(run(match[1], body));
    } catch (error) {
      const e = error as ApiError;
      return json({ error: e.code, error_description: "" }, e.status ?? 400);
    }
  };
  return { fetch, stats, deals, history, readableDeals, now };
}
