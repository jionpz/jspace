// application/context/payload.ts — render collected workbench state into the
// hook injection blocks. Pure: takes the state + root, returns block text,
// never touches the filesystem. Budget rules follow the methodology §2/§6:
// give paths not content, truncate lists with an explicit "and N more" tail
// (never drop silently), keep session-start under 4KiB.
import type { WorkbenchState } from "./collect.ts";
import skillsManifest from "../../skills-manifest.json";

const MAX_STATE_DOMAINS = 5;
const MAX_CRON_LINES = 5;
const MAX_LIST_LINES = 12;
const MAX_CRON_ID_CHARS = 48;
const MAX_SESSION_START_BYTES = 4 * 1024;

/** Workbench skill roster for the <available> block, derived from
 *  skills-manifest.json (the single source for which skills ship in the binary
 *  — see scripts/gen-assets.ts). A hardcoded copy froze at 4 names while the
 *  manifest grew to 7; deriving makes that drift impossible. */
const SKILL_LIST = skillsManifest.workbench.map((s) => s.name).join(" / ");

/** Open-incident banner (issue #13): put failures at the very top of context
 *  output so a session that does not run `jspace cron check` still sees them. */
function incidentBanner(state: WorkbenchState): string {
  if (state.cronIncidents.length === 0) return "";
  return `⚠️ open incidents: ${state.cronIncidents.length}（jspace cron check）`;
}

/** Session-start blocks (design §3.1): static pointer, evaluated state,
 *  path list for on-demand reads, and a computed next action. Empty state
 *  emits only the pointer + next-action (design §7: no noise on a clean
 *  workbench). */
export function renderSessionStart(state: WorkbenchState, root: string): string {
  const workbenchBlock = `<jspace-workbench>\nJSpace 工作台 ${root}。路由规则与治理在工作台根 AGENTS.md（未随本块复制；从根目录启动时经 CLAUDE.md 加载，按需读取）。\n</jspace-workbench>`;

  const stateLinesText = stateLines(state);
  const banner = incidentBanner(state);
  const parts = [workbenchBlock];
  if (banner) parts.unshift(banner);
  if (stateLinesText.length > 0) {
    parts.push(`<current-state>\n${stateLinesText.join("\n")}\n</current-state>`);
  }
  parts.push(`<next-action>\n${nextAction(state)}\n</next-action>`);
  const fixed = parts.join("\n\n");

  // <available> only when there are domain paths to list; an empty read list
  // is noise, and skills are already surfaced by the harness skill selector.
  if (state.domainsDetail.length === 0) {
    return Buffer.byteLength(fixed, "utf-8") <= MAX_SESSION_START_BYTES
      ? fixed
      : fixed.slice(0, MAX_SESSION_START_BYTES); // extreme: pointer-only still fits in practice
  }

  // <available> is the only elidable part: cap at MAX_LIST_LINES paths, then
  // shrink further (with an explicit "and N more" tail) until under budget —
  // never mid-word, never silent.
  const availBase = `<available>\n按需读（不要预读全部）:\n`;
  const availEnd = `\n技能: ${SKILL_LIST}（已在 skill 列表，直接调用）\n</available>`;
  const paths = state.domainsDetail.map((d) => `- ${d.path}/README.md`);
  const maxShown = Math.min(paths.length, MAX_LIST_LINES);
  for (let n = maxShown; n >= 0; n--) {
    const list = paths.slice(0, n);
    if (n < paths.length) list.push(`（另有 ${paths.length - n} 个域，见 .jspace/hub.json）`);
    const cand = `${fixed}\n\n${availBase}${list.join("\n")}${availEnd}`;
    if (Buffer.byteLength(cand, "utf-8") <= MAX_SESSION_START_BYTES) return cand;
  }
  return fixed; // extreme: even the empty <available> overflows — keep state, drop list
}

export interface TurnOptions {
  /** Caller has claimed this session's single write-back nudge (B4). Only
   *  honored when nothing more urgent is pending — the nudge is the lowest
   *  priority line, never a competitor to hub/pending/cron/inbox. */
  writebackNudge?: boolean;
}

/** Per-turn single-line state (design §3.2). Empty string = nothing actionable,
 *  and the caller emits nothing (zero output, exit 0). Always well under the
 *  512B turn budget by construction (single line, ids truncated). */
export function renderTurn(state: WorkbenchState, opts: TurnOptions = {}): string {
  if (state.hubBroken) return `<jspace-state>hub.json 缺失或损坏（jspace doctor --dir .）</jspace-state>`;
  if (state.pendingCount > 0) {
    return `<jspace-state>pending: ${state.pendingCount} 笔暂存写待落盘（jspace pending apply）</jspace-state>`;
  }
  if (state.cronIncidents.length > 0) {
    const inc = state.cronIncidents[0];
    const id = truncateId(inc.cronId);
    return `<jspace-state>cron: ${id}[${inc.failureClass}] 失败未确认（jspace cron check）</jspace-state>`;
  }
  if (state.inboxCount > 0) {
    return `<jspace-state>inbox: ${state.inboxCount} 份待整理（「整理一下 inbox」）</jspace-state>`;
  }
  // Lowest priority, at most once per session (B4 flywheel): most harnesses have
  // no usable session-end hook, and the two that do discard the hook's output —
  // so this line is the only in-session write-back reminder. It nudges an
  // EXPLICIT action; nothing here ever writes gbrain.
  if (opts.writebackNudge) {
    return `<jspace-state>${WRITEBACK_NUDGE}</jspace-state>`;
  }
  return "";
}

/** The one in-session write-back reminder (B4). Actionable on purpose: names the
 *  trigger phrase, the skill, and the provenance tag retro counts — a vague
 *  "记得写回" produced zero `source:session` pages. Still only a reminder. */
const WRITEBACK_NUDGE =
  "收工写回：本次若有值得留存的事实（进展/决策/教训），说一句「收工」触发 memory-writeback，写回页带 tags: source:session；没有则静默结束（每会话只提醒一次，本提示不写 gbrain）";

/** Pre-compact passive reminder (only nudge, never auto-write): the session is about to compact;
 *  surface the state that could be lost + remind that write-back stays explicit
 *  (never auto). This is an injection, NOT a gbrain write — the discipline is
 *  "你说收工才写". */
export function renderPreCompact(state: WorkbenchState, root: string): string {
  const workbenchBlock = `<jspace-workbench>JSpace 工作台 ${root}。会话即将 compaction：以下状态若需持久化，说一句「收工」显式触发 memory-writeback（写回页带 tags: source:session），本提醒不自动写 gbrain。\n</jspace-workbench>`;
  const stateLinesText = stateLines(state);
  const banner = incidentBanner(state);
  const parts = [workbenchBlock];
  if (banner) parts.unshift(banner);
  if (stateLinesText.length > 0) {
    parts.push(`<current-state>\n${stateLinesText.join("\n")}\n</current-state>`);
  }
  parts.push(`<next-action>\n${nextAction(state, "closing")}\n</next-action>`);
  return parts.join("\n\n");
}

/** Session-end settlement reminder (Grok SessionEnd): the session is closing;
 *  same discipline — surface state + remind explicit write-back, never auto. */
export function renderSessionEnd(state: WorkbenchState, root: string): string {
  const workbenchBlock = `<jspace-workbench>JSpace 工作台 ${root}。会话结束：如需记忆本次事实，说一句「收工」显式触发 memory-writeback（写回页带 tags: source:session），本提醒不自动写 gbrain。\n</jspace-workbench>`;
  const stateLinesText = stateLines(state);
  const banner = incidentBanner(state);
  const parts = [workbenchBlock];
  if (banner) parts.unshift(banner);
  if (stateLinesText.length > 0) {
    parts.push(`<current-state>\n${stateLinesText.join("\n")}\n</current-state>`);
  }
  parts.push(`<next-action>\n${nextAction(state, "closing")}\n</next-action>`);
  return parts.join("\n\n");
}

function truncateId(id: string): string {
  return id.length > MAX_CRON_ID_CHARS ? `${id.slice(0, MAX_CRON_ID_CHARS)}…` : id;
}

/** <current-state> lines: evaluated conclusions only; empty/zero lines omitted. */
function stateLines(state: WorkbenchState): string[] {
  const lines: string[] = [];
  if (state.hubBroken) {
    lines.push("告警: hub.json 缺失或损坏（先跑 jspace doctor --dir .）");
  }
  if (state.domains.length > 0) {
    const shown = state.domainsDetail
      .slice(0, MAX_STATE_DOMAINS)
      .map((d) => (d.summary ? `${d.id}（${d.summary}）` : d.id))
      .join(" / ");
    const more = state.domains.length > MAX_STATE_DOMAINS ? `（另有 ${state.domains.length - MAX_STATE_DOMAINS} 个）` : "";
    lines.push(`域: ${state.domains.length} 个 — ${shown}${more}`);
  }
  if (state.pendingCount > 0) {
    const producers = state.pendingProducers.length > 0 ? `（${state.pendingProducers.join(", ")}）` : "";
    lines.push(`pending: ${state.pendingCount} 笔 gbrain 暂存写待落盘${producers}`);
  }
  const incidents = state.cronIncidents.slice(0, MAX_CRON_LINES);
  for (const inc of incidents) {
    lines.push(`cron: ${truncateId(inc.cronId)}[${inc.failureClass}] 上次失败，未确认`);
  }
  if (state.cronIncidents.length > MAX_CRON_LINES) {
    lines.push(`（另有 ${state.cronIncidents.length - MAX_CRON_LINES} 个 cron 失败，见 .jspace/state/incidents/）`);
  }
  if (state.inboxCount > 0) {
    lines.push(`待办: filehub/_inbox 有 ${state.inboxCount} 份未归档资料`);
  }
  if (state.projects.length > 0) {
    const shown = state.projects
      .map((p) => (p.summary ? `${p.id}（${p.summary}）` : p.id))
      .join(" / ");
    lines.push(`项目: ${state.projects.length} 个活跃 — ${shown}`);
  }
  if (state.profiles.length > 0) {
    const shown = state.profiles
      .map((p) => (p.summary ? `${p.theme}（${p.summary}）` : p.theme))
      .join(" / ");
    lines.push(`偏好: ${shown}`);
  }
  return lines;
}

/** Priority: broken hub > pending writes > open cron incident > inbox.
 *  `closing` (pre-compact / session-end) always appends the write-back action:
 *  at that moment it is the point of the injection, not a filler for an
 *  otherwise-idle workbench — and "按 AGENTS.md 路由进入域工作" is nonsense
 *  advice for a session that is ending. */
function nextAction(state: WorkbenchState, mode: "start" | "closing" = "start"): string {
  const actions: string[] = [];
  if (state.hubBroken) actions.push("先跑 jspace doctor --dir . 修复注册表");
  if (state.pendingCount > 0) actions.push(`先跑 jspace pending apply 落盘 ${state.pendingCount} 笔暂存写`);
  if (state.cronIncidents.length > 0) {
    const inc = state.cronIncidents[0];
    actions.push(`处理 cron 失败: ${truncateId(inc.cronId)}[${inc.failureClass}]（jspace cron check）`);
  }
  if (state.inboxCount > 0) actions.push(`inbox 有 ${state.inboxCount} 份待整理，可说「整理一下 inbox」`);
  if (mode === "closing") {
    actions.push(CLOSING_WRITEBACK_ACTION);
    return actions.join("；");
  }
  if (actions.length === 0) actions.push("按 AGENTS.md 路由进入域工作；当前无待办");
  return actions.join("；");
}

/** Closing-event write-back action: same executable shape as the turn nudge
 *  (trigger phrase + skill + provenance tag), phrased for a session that is
 *  about to lose its context. Still a nudge — nothing here writes gbrain. */
const CLOSING_WRITEBACK_ACTION =
  "本次若有持久事实，说一句「收工」触发 memory-writeback（写回页带 tags: source:session）；无则静默结束";
