// Copyright 2026 Ix Infrastructure Inc.

/**
 * Typed readers for the `ix <command> --format json` records the graph tools
 * read, one per record, in the pattern of impact-record.ts. The field names
 * are the ones recorded from ix v0.12.0 in issue #67; the tools used to read
 * names no released ix printed (`results[].file` from locate, `items` from
 * callers, `systems[].name` and `fileCount` from subsystems, `names`/`list`
 * from `subsystems --list`, `graphPresent`/`fileCount`/`staleness` from
 * status, `members`/`components` from overview), so a successful answer
 * rendered as "not found", "none", "unknown" or "[object Object]".
 *
 * Every reader takes `unknown` and checks each field's type, so a record
 * missing a field leaves that field out instead of printing `undefined`.
 */

export interface GraphEntity {
  name: string;
  kind?: string;
  path?: string;
}

/** `ix locate`: `{resolvedTarget, lineRange, container, systemPath, ...}`. */
export interface LocateReading {
  target: GraphEntity;
  /** First line of the entity, from `lineRange.start`. */
  line?: number;
  container?: string;
  /** The regions above the entity, outermost first (`systemPath[].name`). */
  systemPath: string[];
}

export function readLocate(record: unknown): LocateReading | null {
  const body = asObject(record);
  const target = entity(body?.resolvedTarget);
  if (!body || !target) return null;
  const lineRange = asObject(body.lineRange);
  return {
    target,
    line: num(lineRange?.start),
    container: str(asObject(body.container)?.name),
    systemPath: list(body.systemPath)
      .map((step) => str(asObject(step)?.name))
      .filter((name): name is string => name !== undefined),
  };
}

/**
 * `ix callers` / `ix callees` (and the other list lookups):
 * `{results: [{name, kind, path, site}], resultSource, summary: {total, truncated}}`.
 * The CLI has already applied `--limit` to `results`; `summary.total` is the
 * count before it. A row ix could not resolve to an entity has no `name`
 * (`resolved: false`) and is counted, not listed. When the graph has no edges
 * for the target, callers falls back to a text search: `resultSource: "text"`
 * and rows of kind `text-match` named `path:line`.
 */
export interface ResultList {
  rows: GraphEntity[];
  /** Rows ix returned without a resolved entity. */
  unresolved: number;
  /** All matches before `--limit`, from `summary.total`. */
  total?: number;
  /** Whether ix cut the list at `--limit`, from `summary.truncated`. */
  truncated: boolean;
  /** `resultSource`: "graph", or "text" for the text-search fallback. */
  source?: string;
}

export function readResultList(record: unknown): ResultList {
  const body = asObject(record);
  const rows: GraphEntity[] = [];
  let unresolved = 0;
  for (const value of list(body?.results)) {
    const row = entity(value);
    if (row) rows.push(row);
    else if (asObject(value)) unresolved += 1;
  }
  const summary = asObject(body?.summary);
  return {
    rows,
    unresolved,
    total: num(summary?.total),
    truncated: summary?.truncated === true,
    source: str(body?.resultSource),
  };
}

export interface TreeNode extends GraphEntity {
  children: TreeNode[];
}

/**
 * `ix depends`: `{resolvedTarget, tree}`. The nodes under the target; `tree`
 * may be the list of them or a root node (the target) that carries them as
 * `children`.
 */
export function readDependsTree(record: unknown): TreeNode[] {
  const tree = asObject(record)?.tree;
  if (Array.isArray(tree)) return treeNodes(tree, 0);
  return treeNodes(list(asObject(tree)?.children), 0);
}

const MAX_TREE_DEPTH = 8;

function treeNodes(values: unknown[], depth: number): TreeNode[] {
  if (depth > MAX_TREE_DEPTH) return [];
  const nodes: TreeNode[] = [];
  for (const value of values) {
    const node = entity(value);
    if (!node) continue;
    nodes.push({ ...node, children: treeNodes(list(asObject(value)?.children), depth + 1) });
  }
  return nodes;
}

/** One region of `ix subsystems`: `regions[].{label, files, cohesion, coupling}`. */
export interface RegionReading {
  label: string;
  files?: number;
  cohesion?: number;
  coupling?: number;
}

/**
 * The regions of `ix subsystems` (`regions[]`), or of `ix subsystems <scope>`,
 * which prints `{target, parent, summary, hierarchy, children}` with the
 * scope's regions under `children[]`.
 */
export function readRegions(record: unknown): RegionReading[] {
  const body = asObject(record);
  const values = Array.isArray(body?.regions) ? body.regions : list(body?.children);
  const regions: RegionReading[] = [];
  for (const value of values) {
    const region = asObject(value);
    const label = str(region?.label);
    if (!region || !label) continue;
    regions.push({ label, files: num(region.files), cohesion: num(region.cohesion), coupling: num(region.coupling) });
  }
  return regions;
}

/** The label of the region `ix subsystems <scope>` resolved (`target.label`). */
export function readSubsystemTarget(record: unknown): string | undefined {
  return str(asObject(asObject(record)?.target)?.label);
}

/** `ix subsystems --list`: `{scores: [{name, level, health, files}]}`, the names in ix's order. */
export function readSubsystemNames(record: unknown): string[] {
  return list(asObject(record)?.scores)
    .map((score) => str(asObject(score)?.name))
    .filter((name): name is string => name !== undefined);
}

/**
 * `ix stats`: `{nodes: {total, byKind: [{kind, count}]}, edges: {total,
 * byPredicate: [{predicate, count}]}}`. There is no file total: the file
 * count is the `file` entry of `nodes.byKind`.
 */
export interface StatsReading {
  files?: number;
  nodes?: number;
  edges?: number;
  nodesByKind: Array<{ kind: string; count: number }>;
  edgesByPredicate: Array<{ predicate: string; count: number }>;
}

export function readStats(record: unknown): StatsReading {
  const body = asObject(record);
  const nodes = asObject(body?.nodes);
  const edges = asObject(body?.edges);
  const nodesByKind = counts(nodes?.byKind, "kind").map(({ key, count }) => ({ kind: key, count }));
  const edgesByPredicate = counts(edges?.byPredicate, "predicate").map(({ key, count }) => ({ predicate: key, count }));
  return {
    files: nodesByKind.find((entry) => entry.kind === "file")?.count,
    nodes: num(nodes?.total),
    edges: num(edges?.total),
    nodesByKind,
    edgesByPredicate,
  };
}

/** `ix status`: `{graphCompleted, mapCompleted, currentRev, staleFiles, lastIngestAt}`. */
export interface StatusReading {
  graphCompleted?: boolean;
  mapCompleted?: boolean;
  currentRev?: number;
  /** How many files changed since the last ingest (a count, or the length of a list). */
  staleFiles?: number;
  lastIngestAt?: string;
}

export function readStatus(record: unknown): StatusReading {
  const body = asObject(record);
  if (!body) return {};
  const stale = Array.isArray(body.staleFiles) ? body.staleFiles.length : num(body.staleFiles);
  const lastIngest = typeof body.lastIngestAt === "number" && Number.isFinite(body.lastIngestAt)
    ? String(body.lastIngestAt)
    : str(body.lastIngestAt);
  return {
    graphCompleted: typeof body.graphCompleted === "boolean" ? body.graphCompleted : undefined,
    mapCompleted: typeof body.mapCompleted === "boolean" ? body.mapCompleted : undefined,
    currentRev: num(body.currentRev),
    staleFiles: stale,
    lastIngestAt: lastIngest,
  };
}

/** Whether `ix status` says a graph has been ingested. */
export function graphIngested(status: StatusReading): boolean {
  return status.graphCompleted === true || (status.currentRev ?? 0) > 0;
}

/**
 * `ix overview`: `{resolvedTarget, childrenByKind, keyItems, ...}`. The kind
 * and path are the resolved target's; `childrenByKind` maps a kind to a count.
 */
export interface OverviewReading {
  kind?: string;
  path?: string;
  childrenByKind: Array<{ kind: string; count: number }>;
}

export function readOverview(record: unknown): OverviewReading {
  const body = asObject(record);
  const target = asObject(body?.resolvedTarget);
  const childrenByKind: Array<{ kind: string; count: number }> = [];
  for (const [kind, count] of Object.entries(asObject(body?.childrenByKind) ?? {})) {
    const value = num(count);
    if (kind.trim() && value !== undefined) childrenByKind.push({ kind: kind.trim(), count: value });
  }
  return { kind: str(target?.kind), path: str(target?.path), childrenByKind };
}

/**
 * The source-text matches of an `ix locate` that resolved no entity and fell
 * back to a text search (`resolutionMode: "text"`): one `path:line` (or the
 * row's name) per match, in ix's order. Empty for any other record.
 */
export function readLocateTextMatches(record: unknown): string[] {
  const body = asObject(record);
  if (!body || body.resolutionMode !== "text") return [];
  const rows = [body.results, body.matches, body.textMatches, body.candidates].find(Array.isArray) ?? [];
  const matches: string[] = [];
  for (const value of rows) {
    const row = asObject(value);
    if (!row) continue;
    const path = str(row.path) ?? str(row.file);
    const line = num(row.line) ?? num(row.line_start) ?? num(asObject(row.lineRange)?.start);
    const where = path && line !== undefined ? `${path}:${line}` : str(row.name) ?? path;
    if (where) matches.push(where);
  }
  return matches;
}

/** `ix overview`: the names of its `keyItems` (entities, or bare names), in ix's order. */
export function readKeyItemNames(record: unknown): string[] {
  return list(asObject(record)?.keyItems)
    .map((item) => (typeof item === "string" ? str(item) : str(asObject(item)?.name)))
    .filter((name): name is string => name !== undefined);
}

function entity(value: unknown): GraphEntity | null {
  const row = asObject(value);
  const name = str(row?.name);
  if (!row || !name) return null;
  return { name, kind: str(row.kind), path: str(row.path) };
}

function counts(value: unknown, keyField: string): Array<{ key: string; count: number }> {
  const entries: Array<{ key: string; count: number }> = [];
  for (const item of list(value)) {
    const row = asObject(item);
    const key = str(row?.[keyField]);
    const count = num(row?.count);
    if (key !== undefined && count !== undefined) entries.push({ key, count });
  }
  return entries;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
