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
 * `{results: [{name, kind, path, site}]}`.
 */
export function readResultRows(record: unknown): GraphEntity[] {
  return list(asObject(record)?.results)
    .map(entity)
    .filter((row): row is GraphEntity => row !== null);
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

export function readRegions(record: unknown): RegionReading[] {
  const regions: RegionReading[] = [];
  for (const value of list(asObject(record)?.regions)) {
    const region = asObject(value);
    const label = str(region?.label);
    if (!region || !label) continue;
    regions.push({ label, files: num(region.files), cohesion: num(region.cohesion), coupling: num(region.coupling) });
  }
  return regions;
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
