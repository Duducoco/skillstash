import React, { useState, useCallback, useRef, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import * as os from 'node:os';
import * as child_process from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, getLocale, setLocale, type Locale } from '../i18n/index.js';
import {
  loadRegistry,
  saveRegistry,
  hubExists,
  getDefaultHubPath,
  detectAgents,
  detectAgentsAsync,
  loadLocalState,
  saveLocalState,
  invalidateHubCache,
} from '../core/hub.js';
import { AgentConfig, setAgentEnabled, addAgentToRegistry } from '../core/registry.js';

// Resolve the absolute path to dist/index.js regardless of how the binary was
// invoked (global npm install creates a bin shim where process.argv[1] points
// to the shim, not to this package's dist directory).
const __tuiDir = path.dirname(fileURLToPath(import.meta.url));
const ENTRY_POINT = path.resolve(__tuiDir, '..', 'index.js');

// ── Layout constants ───────────────────────────────────────────────────────────

const SIDEBAR_W = 22;
const OUTPUT_MAX_LINES = 500;

// ── Display-width helper (emoji=2, CJK=2, ASCII=1) ─────────────────────────────

function dw(s: string): number {
  let w = 0;
  for (const ch of [...s]) {
    const cp = ch.codePointAt(0) ?? 0;
    // Variation selector (VS16) and ZWJ are zero-width
    if (cp === 0xFE0F || cp === 0x200D) continue;
    if (
      (cp >= 0x1100 && cp <= 0x115F) ||
      (cp >= 0x2E80 && cp <= 0x303F) ||
      (cp >= 0x3040 && cp <= 0x33FF) ||
      (cp >= 0x3400 && cp <= 0x4DBF) ||
      (cp >= 0x4E00 && cp <= 0xA4CF) ||
      (cp >= 0xAC00 && cp <= 0xD7AF) ||
      (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE30 && cp <= 0xFE6F) ||
      (cp >= 0xFF01 && cp <= 0xFF60) ||
      cp >= 0x1F000
    ) {
      w += 2;
    } else if (cp > 0) {
      w += 1;
    }
  }
  return w;
}

function padR(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - dw(s)));
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type MainChoice =
  | 'home'
  | 'init'
  | 'install'
  | 'list'
  | 'sync'
  | 'link'
  | 'diff'
  | 'import'
  | 'remove'
  | 'agents'
  | 'assign'
  | 'language'
  | 'add-remote'
  | 'exit';

export type AgentsSubChoice = 'list' | 'select' | 'enable' | 'disable' | 'add' | 'remove-agent';

type Screen =
  | 'home'
  | 'init-input'
  | 'install-input'
  | 'list-verbose'
  | 'remove-pick'
  | 'agents-sub'
  | 'agents-select'
  | 'agents-enable'
  | 'agents-disable'
  | 'agents-add'
  | 'agents-remove'
  | 'assign-pick-agent'
  | 'assign-pick-skills'
  | 'language-pick'
  | 'add-remote-input'
  | 'running'
  | 'confirm-modal';

type Focus = 'sidebar' | 'content' | 'output';

type SessionState = 'idle' | 'loading' | 'success' | 'error';

type OutputLine = { text: string; type: 'success' | 'warn' | 'error' | 'step' | 'raw' };

// ── Hub info ───────────────────────────────────────────────────────────────────

interface HubInfo {
  initialized: boolean;
  hubPath: string;
  lastSync: string | null;
  skillCount: number;
  skillNames: string[];
  agents: AgentConfig[];
}

function loadHubInfo(): HubInfo {
  const hubPath = getDefaultHubPath();
  if (!hubExists(hubPath)) {
    return { initialized: false, hubPath, lastSync: null, skillCount: 0, skillNames: [], agents: detectAgents() };
  }
  try {
    const registry = loadRegistry(hubPath);
    return {
      initialized: true,
      hubPath,
      lastSync: registry.lastSync ?? null,
      skillCount: Object.keys(registry.skills).length,
      skillNames: Object.keys(registry.skills),
      agents: Object.values(registry.agents) as AgentConfig[],
    };
  } catch {
    return { initialized: false, hubPath, lastSync: null, skillCount: 0, skillNames: [], agents: detectAgents() };
  }
}

async function loadHubInfoAsync(): Promise<HubInfo> {
  const hubPath = getDefaultHubPath();
  if (!hubExists(hubPath)) {
    return { initialized: false, hubPath, lastSync: null, skillCount: 0, skillNames: [], agents: await detectAgentsAsync() };
  }
  try {
    const registry = loadRegistry(hubPath);
    return {
      initialized: true,
      hubPath,
      lastSync: registry.lastSync ?? null,
      skillCount: Object.keys(registry.skills).length,
      skillNames: Object.keys(registry.skills),
      agents: Object.values(registry.agents) as AgentConfig[],
    };
  } catch {
    return { initialized: false, hubPath, lastSync: null, skillCount: 0, skillNames: [], agents: await detectAgentsAsync() };
  }
}

// ── Menu definitions ───────────────────────────────────────────────────────────

const MENU_ITEMS: ReadonlyArray<{
  value: MainChoice;
  emoji: string;
  zh: string;
  en: string;
  descKey: string;
}> = [
  { value: 'home',       emoji: '🏠', zh: '首页',      en: 'Home',       descKey: 'tui.homeDesc'       },
  { value: 'init',       emoji: '🔧', zh: '初始化',    en: 'Init',       descKey: 'tui.initDesc'       },
  { value: 'install',    emoji: '📦', zh: '安装 skill', en: 'Install',   descKey: 'tui.installDesc'    },
  { value: 'list',       emoji: '📋', zh: '列出',       en: 'List',       descKey: 'tui.listDesc'       },
  { value: 'sync',       emoji: '🔄', zh: '同步',       en: 'Sync',       descKey: 'tui.syncDesc'       },
  { value: 'link',       emoji: '🔗', zh: '链接',       en: 'Link',       descKey: 'tui.linkDesc'       },
  { value: 'diff',       emoji: '📊', zh: '差异',       en: 'Diff',       descKey: 'tui.diffDesc'       },
  { value: 'import',     emoji: '📥', zh: '导入',       en: 'Import',     descKey: 'tui.importDesc'     },
  { value: 'remove',     emoji: '🚮', zh: '删除',       en: 'Remove',     descKey: 'tui.removeDesc'     },
  { value: 'agents',     emoji: '🤖', zh: 'Agent 管理', en: 'Agents',    descKey: 'tui.agentsDesc'     },
  { value: 'assign',     emoji: '🎯', zh: '分配 skill', en: 'Assign',    descKey: 'tui.assignDesc'     },
  { value: 'language',   emoji: '🌍', zh: '语言',       en: 'Language',   descKey: 'tui.languageDesc'   },
  { value: 'add-remote', emoji: '🌐', zh: '添加远端',   en: 'Add Remote', descKey: 'tui.addRemoteDesc'  },
  { value: 'exit',       emoji: '🚪', zh: '退出',       en: 'Exit',       descKey: 'tui.exit'           },
];

const AGENTS_ITEMS: ReadonlyArray<{ value: AgentsSubChoice; labelKey: string; descKey: string }> = [
  { value: 'list',    labelKey: 'tui.agentsListLabel',    descKey: 'tui.agentsListDesc'   },
  { value: 'select',  labelKey: 'tui.agentsSelectLabel',  descKey: 'tui.agentsSelectDesc' },
  { value: 'enable',  labelKey: 'tui.agentsEnableLabel',  descKey: 'tui.agentsEnableDesc' },
  { value: 'disable', labelKey: 'tui.agentsDisableLabel', descKey: 'tui.agentsDisableDesc'},
  { value: 'add',     labelKey: 'tui.agentsAddLabel',     descKey: 'tui.agentsAddDesc'    },
  { value: 'remove-agent', labelKey: 'tui.agentsRemoveLabel', descKey: 'tui.agentsRemoveDesc' },
];

// ── Section header ──────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <Box marginTop={1} marginBottom={0}>
      <Text color="blue" dimColor>{'─── '}</Text>
      <Text color="cyan" bold>{title}</Text>
      <Text color="blue" dimColor>{' ─────────────────────────────────────────'}</Text>
    </Box>
  );
}

// ── ASCII watermark ────────────────────────────────────────────────────────────

const ASCII_LOGO = [
  '  ____  _    _ _ _ ____  _            _     ',
  ' / ___|| | _(_) | / ___|| |_ __ _ ___| |__  ',
  ' \\___ \\| |/ / | | \\___ \\| __/ _` / __| \'_ \\ ',
  '  ___) |   <| | | |___) | || (_| \\__ \\ | | |',
  ' |____/|_|\\_\\_|_|_|____/ \\__\\__,_|___/_| |_|',
];

// ── Home dashboard ──────────────────────────────────────────────────────────────

function HomeContent({ hubInfo, loading }: { hubInfo: HubInfo; loading: boolean }) {
  const zh = getLocale() === 'zh';
  const hubPathShort = hubInfo.hubPath.replace(os.homedir(), '~');
  const syncStr = hubInfo.lastSync
    ? new Date(hubInfo.lastSync).toLocaleString()
    : t('tui.neverSynced');

  const agentRows: AgentConfig[][] = [];
  for (let i = 0; i < hubInfo.agents.length; i += 3) {
    agentRows.push(hubInfo.agents.slice(i, i + 3));
  }

  return (
    <Box flexDirection="column">
      <SectionHeader title={zh ? 'Hub 状态' : 'Hub Status'} />
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Box>
          <Box width={12}><Text color="gray">{zh ? '路径' : 'Path'}</Text></Box>
          <Text color="gray">  :  </Text>
          <Text color={hubInfo.initialized ? 'green' : 'yellow'}>{hubPathShort}</Text>
          {!hubInfo.initialized && <Text color="red">  ({zh ? '未初始化' : 'not initialized'})</Text>}
        </Box>
        <Box>
          <Box width={12}><Text color="gray">{zh ? '上次同步' : 'Last sync'}</Text></Box>
          <Text color="gray">  :  </Text>
          <Text color={hubInfo.lastSync ? 'white' : 'yellow'}>{syncStr}</Text>
        </Box>
        <Box>
          <Box width={12}><Text color="gray">{zh ? '技能' : 'Skills'}</Text></Box>
          <Text color="gray">  :  </Text>
          <Text color="white">{loading ? '...' : hubInfo.skillCount}</Text>
        </Box>
      </Box>

      <SectionHeader title={zh ? '已检测 Agent' : 'Detected Agents'} />
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {loading ? (
          <Text color="gray" dimColor>{zh ? '正在检测...' : 'Detecting...'}</Text>
        ) : agentRows.map((row, ri) => (
          <Box key={ri} flexDirection="row" marginBottom={0}>
            {row.map((a) => (
              <Box key={a.name} marginRight={4}>
                <Text color="blue" dimColor>{'>_ '}</Text>
                <Box width={14}><Text color={a.available ? 'white' : 'gray'} bold={a.available}>{a.name}</Text></Box>
                <Text color={a.available ? (a.enabled ? 'green' : 'gray') : 'gray'}>
                  {a.available ? (a.enabled ? '✓' : '○') : '✗'}
                </Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={2}>
        {ASCII_LOGO.map((line, i) => (
          <Text key={i} color="gray" dimColor>{line}</Text>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor italic>
          {zh
            ? '↑↓ 选择命令  Enter 执行  Esc/← 返回  q 退出  Tab 切换区域'
            : '↑↓ select  Enter execute  Esc/← back  q quit  Tab switch area'}
        </Text>
      </Box>
    </Box>
  );
}

// ── Text input cursor ──────────────────────────────────────────────────────────

function TextInput({ value, hint }: { value: string; hint?: string }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">{'> '}</Text>
        <Text>{value}</Text>
        <Text inverse>{' '}</Text>
      </Box>
      {hint && <Text color="gray" dimColor>{hint}</Text>}
    </Box>
  );
}

// ── Multi-select list (checkbox) ───────────────────────────────────────────────

interface MultiSelectItem {
  value: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  detail?: string;
}

function MultiSelectList({
  items,
  cursorIdx,
  zh,
}: {
  items: MultiSelectItem[];
  cursorIdx: number;
  zh: boolean;
}) {
  const termRows = process.stdout.rows || 24;
  const pageSize = Math.max(5, Math.min(termRows - 12, items.length || 1));
  const half = Math.floor(pageSize / 2);
  const start = Math.max(0, Math.min(cursorIdx - half, Math.max(0, items.length - pageSize)));
  const end = Math.min(items.length, start + pageSize);
  const visible = items.slice(start, end);

  return (
    <Box flexDirection="column" marginTop={1}>
      {visible.map((item, vi) => {
        const i = start + vi;
        const active = i === cursorIdx;
        const marker = item.checked ? '◉' : '◯';
        const dimmed = item.disabled;
        return (
          <Box key={item.value} flexDirection="row">
            <Text color={active ? 'cyan' : 'gray'} bold={active}>
              {active ? '▶ ' : '  '}
            </Text>
            <Text
              color={dimmed ? 'gray' : (active ? 'cyan' : 'white')}
              bold={active && !dimmed}
              dimColor={dimmed}
            >
              {marker} {padR(item.value, 14)}
            </Text>
            <Text
              color={dimmed ? 'gray' : (item.checked ? 'green' : 'gray')}
              dimColor={dimmed}
            >
              {item.detail ?? ''}
            </Text>
          </Box>
        );
      })}
      {items.length > pageSize && (
        <Box marginTop={0}>
          <Text color="gray" dimColor>
            {start > 0 ? `↑ ${start} more  ` : '          '}
            [{cursorIdx + 1} / {items.length}]
            {end < items.length ? `  ↓ ${items.length - end} more` : ''}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {zh ? '空格切换  a全选  i反转  Enter确认  Esc返回'
            : 'space toggle  a all  i invert  Enter confirm  Esc back'}
        </Text>
      </Box>
    </Box>
  );
}

// ── Single-select list ──────────────────────────────────────────────────────────

interface SelectItem {
  value: string;
  label: string;
  detail?: string;
}

function SelectList({
  items,
  cursorIdx,
}: {
  items: SelectItem[];
  cursorIdx: number;
}) {
  const termRows = process.stdout.rows || 24;
  const pageSize = Math.max(5, Math.min(termRows - 12, items.length || 1));
  const half = Math.floor(pageSize / 2);
  const start = Math.max(0, Math.min(cursorIdx - half, Math.max(0, items.length - pageSize)));
  const end = Math.min(items.length, start + pageSize);
  const visible = items.slice(start, end);

  return (
    <Box flexDirection="column" marginTop={1}>
      {visible.map((item, vi) => {
        const i = start + vi;
        const active = i === cursorIdx;
        return (
          <Box key={item.value} flexDirection="row">
            <Text color={active ? 'cyan' : 'gray'} bold={active}>
              {active ? '▶ ' : '  '}
            </Text>
            <Text color={active ? 'cyan' : 'white'} bold={active}>
              {padR(item.value, 14)}
            </Text>
            {item.detail && <Text color={active ? 'white' : 'gray'} dimColor={!active}>{item.detail}</Text>}
          </Box>
        );
      })}
      {items.length > pageSize && (
        <Box marginTop={0}>
          <Text color="gray" dimColor>
            {start > 0 ? `↑ ${start} more  ` : '          '}
            [{cursorIdx + 1} / {items.length}]
            {end < items.length ? `  ↓ ${items.length - end} more` : ''}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {getLocale() === 'zh' ? '↑↓ 选择  Enter 确认  Esc 返回'
            : '↑↓ select  Enter confirm  Esc back'}
        </Text>
      </Box>
    </Box>
  );
}

// ── Confirm modal ───────────────────────────────────────────────────────────────

function ConfirmModal({
  message,
  cursorIdx,
  zh,
}: {
  message: string;
  cursorIdx: number;
  zh: boolean;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
      <Text color="yellow" bold>{'⚠ '}{message}</Text>
      <Box marginTop={1} flexDirection="row">
        <Text color={cursorIdx === 0 ? 'red' : 'gray'} bold={cursorIdx === 0}>
          {cursorIdx === 0 ? '▶ ' : '  '}{zh ? '取消' : 'Cancel'}
        </Text>
        <Text>{'    '}</Text>
        <Text color={cursorIdx === 1 ? 'green' : 'gray'} bold={cursorIdx === 1}>
          {cursorIdx === 1 ? '▶ ' : '  '}{zh ? '确认' : 'Confirm'}
        </Text>
      </Box>
      <Text color="gray" dimColor>
        {zh ? '←→ 选择  Enter 确认  Esc 取消' : '←→ choose  Enter confirm  Esc cancel'}
      </Text>
    </Box>
  );
}

// ── Output panel ────────────────────────────────────────────────────────────────

function OutputPanel({ lines, maxLines = 30, offset = 0, follow = false }: {
  lines: OutputLine[];
  maxLines?: number;
  offset?: number;
  follow?: boolean;
}) {
  const colorMap = { success: 'green', warn: 'yellow', error: 'red', step: 'cyan', raw: 'white' };
  const iconMap  = { success: '✔',     warn: '⚠',      error: '✖',   step: '→',   raw: ''     };
  const contentRows = Math.max(1, maxLines - 1); // reserve 1 row for the scroll indicator
  const fromIdx     = follow ? Math.max(0, lines.length - contentRows) : offset;
  const displayLines = lines.slice(fromIdx, fromIdx + contentRows);
  const toIdx        = fromIdx + displayLines.length;
  const total        = lines.length;

  return (
    <Box flexDirection="column">
      {displayLines.map((line, i) => (
        <Text key={fromIdx + i} color={colorMap[line.type]} wrap="truncate">
          {iconMap[line.type] ? `${iconMap[line.type]} ` : ''}{line.text}
        </Text>
      ))}
      {total > contentRows && (
        <Text color="gray" dimColor>
          {fromIdx > 0 ? `↑${fromIdx} ` : '     '}
          [{fromIdx + 1}–{toIdx}/{total}]
          {toIdx < total ? ` ↓${total - toIdx}` : ''}
          {!follow && '  ↑↓ scroll'}
        </Text>
      )}
    </Box>
  );
}

// ── Spinner frames ──────────────────────────────────────────────────────────────

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ── Main App ────────────────────────────────────────────────────────────────────

interface AppProps {
  onDone: (args: string[] | null) => void;
}

function App({ onDone }: AppProps) {
  const { exit } = useApp();

  // ── Terminal dimensions (reactive to resize) ─────────────────────────────────
  const [termRows, setTermRows] = useState(process.stdout.rows || 24);
  const [termCols, setTermCols] = useState(process.stdout.columns || 80);

  useEffect(() => {
    const handleResize = () => {
      setTermRows(process.stdout.rows || 24);
      setTermCols(process.stdout.columns || 80);
    };
    process.stdout.on('resize', handleResize);
    return () => { process.stdout.off('resize', handleResize); };
  }, []);

  // top-bar(1) + border-top(1) + border-bottom(1) + status-bar(1) = 4 fixed lines
  const bodyHeight = Math.max(5, termRows - 4);

  // ── Core state ──────────────────────────────────────────────────────────────
  const [hubInfo, setHubInfo]           = useState<HubInfo>({
    initialized: false,
    hubPath: getDefaultHubPath(),
    lastSync: null,
    skillCount: 0,
    skillNames: [],
    agents: [],
  });
  const [hubLoading, setHubLoading]     = useState(true);

  // Load hub info asynchronously after first paint — TUI appears instantly,
  // data fills in once detectAgentsAsync() parallel checks complete.
  useEffect(() => {
    let cancelled = false;
    loadHubInfoAsync().then(info => {
      if (!cancelled) {
        setHubInfo(info);
        setHubLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);
  const [focus, setFocus]               = useState<Focus>('sidebar');
  const [menuIdx, setMenuIdx]           = useState(1);
  const [screen, setScreen]             = useState<Screen>('home');
  const [session, setSession]           = useState<SessionState>('idle');
  const [textValue, setTextValue]       = useState('');
  const [agentsSubIdx, setAgentsSubIdx] = useState(1);
  const [listVerboseIdx, setListVerboseIdx] = useState(0);
  const [outputLines, setOutputLines]   = useState<OutputLine[]>([]);
  const [outputScroll, setOutputScroll] = useState(0);
  const [statusMsg, setStatusMsg]       = useState('');
  const [statusType, setStatusType]     = useState<'info' | 'success' | 'warn' | 'error'>('info');
  const [spinnerIdx, setSpinnerIdx]     = useState(0);
  const [spinnerLabel, setSpinnerLabel] = useState('');

  // ── Sub-screen state ─────────────────────────────────────────────────────────
  const [agentSelectItems, setAgentSelectItems] = useState<MultiSelectItem[]>([]);
  const [agentSelectCursor, setAgentSelectCursor] = useState(0);
  const [singleSelectItems, setSingleSelectItems] = useState<SelectItem[]>([]);
  const [singleSelectCursor, setSingleSelectCursor] = useState(0);
  const [langCursor, setLangCursor]       = useState(getLocale() === 'zh' ? 1 : 0);
  const [confirmCursor, setConfirmCursor] = useState(0);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [assignAgentName, setAssignAgentName] = useState('');
  const [agentsAddName, setAgentsAddName] = useState('');
  const [agentsAddStep, setAgentsAddStep] = useState<'name' | 'path'>('name');

  const zh = getLocale() === 'zh';
  const childRef = useRef<child_process.ChildProcess | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const refreshHub = useCallback(() => {
    invalidateHubCache();
    loadHubInfoAsync().then(setHubInfo);
  }, []);

  const addOutput = useCallback((line: OutputLine) => {
    setOutputLines(prev => {
      const next = [...prev, line];
      return next.length > OUTPUT_MAX_LINES ? next.slice(-OUTPUT_MAX_LINES) : next;
    });
  }, []);

  const clearOutput = useCallback(() => { setOutputLines([]); setOutputScroll(0); }, []);

  const setStatus = useCallback((msg: string, type: 'info' | 'success' | 'warn' | 'error') => {
    setStatusMsg(msg);
    setStatusType(type);
  }, []);

  // ── Spinner animation ────────────────────────────────────────────────────────
  useEffect(() => {
    if (session !== 'loading') return;
    const timer = setInterval(() => setSpinnerIdx(i => (i + 1) % SPINNER.length), 80);
    return () => clearInterval(timer);
  }, [session]);

  // ── Run a CLI command as child process ───────────────────────────────────────
  const runCommand = useCallback((args: string[]) => {
    setSession('loading');
    setSpinnerLabel(args[0] || 'running');
    clearOutput();

    const child = child_process.spawn(
      process.execPath,
      [ENTRY_POINT, ...args],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1', NO_TTY: '1' } },
    );
    childRef.current = child;

    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuf += data.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) addOutput({ text: line.trim(), type: 'raw' });
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderrBuf += data.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) addOutput({ text: line.trim(), type: 'error' });
      }
    });

    child.on('close', (code) => {
      childRef.current = null;
      if (stdoutBuf.trim()) addOutput({ text: stdoutBuf.trim(), type: 'raw' });
      if (stderrBuf.trim()) addOutput({ text: stderrBuf.trim(), type: 'error' });
      if (code === 0) {
        setSession('success');
        setStatus(zh ? `✔ ${args[0]} 完成` : `✔ ${args[0]} completed`, 'success');
      } else {
        setSession('error');
        setStatus(zh ? `✖ ${args[0]} 失败 (code ${code})` : `✖ ${args[0]} failed (code ${code})`, 'error');
      }
      refreshHub();
      setOutputScroll(0);
    });

    child.on('error', (err) => {
      childRef.current = null;
      setSession('error');
      setStatus(`✖ ${err.message}`, 'error');
      addOutput({ text: err.message, type: 'error' });
    });
  }, [addOutput, clearOutput, refreshHub, zh]);

  const execSimple = useCallback((args: string[]) => {
    runCommand(args);
    setScreen('running');
    setFocus('output');
  }, [runCommand]);

  const confirmThenExec = useCallback((message: string, args: string[]) => {
    setConfirmMessage(message);
    setConfirmCursor(0);
    setConfirmAction(() => () => {
      setScreen('running');
      setFocus('output');
      runCommand(args);
    });
    setScreen('confirm-modal');
    setFocus('content');
  }, [runCommand]);

  // ── Native Ink actions (no child process) ─────────────────────────────────────

  const enterAgentsSelect = useCallback(() => {
    if (!hubInfo.initialized) {
      setStatus(zh ? 'Hub 未初始化，请先运行 init' : 'Hub not initialized, run init first', 'error');
      return;
    }
    const registry = loadRegistry(hubInfo.hubPath);
    const detected = detectAgents();
    for (const agent of detected) {
      if (!registry.agents[agent.name]) addAgentToRegistry(registry, agent.name, agent);
      else registry.agents[agent.name].available = agent.available;
    }
    const items: MultiSelectItem[] = Object.values(registry.agents).map((a: AgentConfig) => ({
      value: a.name, label: a.name,
      checked: a.available ? a.enabled : false,
      disabled: !a.available,
      detail: a.available ? (zh ? '✓ 可用' : '✓ available') : (zh ? '✗ 未找到' : '✗ not found'),
    }));
    setAgentSelectItems(items);
    setAgentSelectCursor(0);
    setScreen('agents-select');
    setFocus('content');
  }, [hubInfo, zh]);

  const commitAgentsSelect = useCallback(() => {
    if (!hubInfo.initialized) return;
    const registry = loadRegistry(hubInfo.hubPath);
    const detected = detectAgents();
    for (const agent of detected) {
      if (!registry.agents[agent.name]) addAgentToRegistry(registry, agent.name, agent);
      else registry.agents[agent.name].available = agent.available;
    }
    const selectedSet = new Set(agentSelectItems.filter(i => i.checked && !i.disabled).map(i => i.value));
    for (const agent of Object.values(registry.agents)) {
      setAgentEnabled(registry, agent.name, selectedSet.has(agent.name));
    }
    saveRegistry(registry, hubInfo.hubPath);
    const enabledCount = Object.values(registry.agents).filter((a: AgentConfig) => a.enabled).length;
    const total = Object.keys(registry.agents).length;
    setStatus(zh ? `✔ 已托管 ${enabledCount}/${total} 个 Agent` : `✔ Managing ${enabledCount}/${total} agents`, 'success');
    refreshHub();
    setSession('success');
    setFocus('sidebar');
    setScreen('home');
  }, [hubInfo, agentSelectItems, refreshHub, zh]);

  const enterRemovePick = useCallback(() => {
    if (!hubInfo.initialized) { setStatus(zh ? 'Hub 未初始化' : 'Hub not initialized', 'error'); return; }
    if (hubInfo.skillNames.length === 0) { setStatus(zh ? '没有可删除的技能' : 'No skills to remove', 'warn'); return; }
    setSingleSelectItems(hubInfo.skillNames.map(name => ({ value: name, label: name })));
    setSingleSelectCursor(0);
    setScreen('remove-pick');
    setFocus('content');
  }, [hubInfo, zh]);

  const enterSingleAgentPick = useCallback((sub: 'enable' | 'disable' | 'remove-agent') => {
    if (!hubInfo.initialized) { setStatus(zh ? 'Hub 未初始化' : 'Hub not initialized', 'error'); return; }
    const registry = loadRegistry(hubInfo.hubPath);
    const agents = Object.values(registry.agents) as AgentConfig[];
    const items: SelectItem[] = agents.map(a => ({
      value: a.name, label: a.name,
      detail: a.available
        ? (a.enabled ? (zh ? '✓ 已托管' : '✓ managed') : (zh ? '○ 已禁用' : '○ disabled'))
        : (zh ? '✗ 未找到' : '✗ not found'),
    }));
    if (items.length === 0) { setStatus(zh ? '没有注册的 Agent' : 'No registered agents', 'warn'); return; }
    setSingleSelectItems(items);
    setSingleSelectCursor(0);
    setScreen(sub === 'enable' ? 'agents-enable' : sub === 'disable' ? 'agents-disable' : 'agents-remove');
    setFocus('content');
  }, [hubInfo, zh]);

  const enterAssignPickAgent = useCallback(() => {
    if (!hubInfo.initialized) { setStatus(zh ? 'Hub 未初始化' : 'Hub not initialized', 'error'); return; }
    const registry = loadRegistry(hubInfo.hubPath);
    const enabledAgents = Object.values(registry.agents).filter((a: AgentConfig) => a.available && a.enabled);
    if (enabledAgents.length === 0) { setStatus(zh ? '没有可用的已托管 Agent' : 'No enabled agents available', 'warn'); return; }
    setSingleSelectItems(enabledAgents.map(a => ({ value: a.name, label: a.name })));
    setSingleSelectCursor(0);
    setScreen('assign-pick-agent');
    setFocus('content');
  }, [hubInfo, zh]);

  const enterAssignPickSkills = useCallback((agentName: string) => {
    if (!hubInfo.initialized) return;
    const registry = loadRegistry(hubInfo.hubPath);
    const enabledSkills = Object.entries(registry.skills)
      .filter(([, meta]) => meta.enabled)
      .map(([name]) => name);
    if (enabledSkills.length === 0) { setStatus(zh ? '没有可分配的技能' : 'No enabled skills to assign', 'warn'); return; }
    const currentAssignment = registry.agentSkills[agentName];
    const items: MultiSelectItem[] = enabledSkills.map(name => ({
      value: name, label: name,
      checked: currentAssignment === undefined ? true : currentAssignment.includes(name),
    }));
    setAgentSelectItems(items);
    setAgentSelectCursor(0);
    setAssignAgentName(agentName);
    setScreen('assign-pick-skills');
    setFocus('content');
  }, [hubInfo, zh]);

  const commitAssign = useCallback(() => {
    if (!hubInfo.initialized || !assignAgentName) return;
    const registry = loadRegistry(hubInfo.hubPath);
    const selectedSkills = agentSelectItems.filter(i => i.checked).map(i => i.value);
    registry.agentSkills[assignAgentName] = selectedSkills;
    saveRegistry(registry, hubInfo.hubPath);
    setStatus(
      zh ? `✔ 已为 ${assignAgentName} 分配 ${selectedSkills.length} 个技能`
        : `✔ Assigned ${selectedSkills.length} skills to ${assignAgentName}`,
      'success',
    );
    refreshHub();
    setSession('success');
    setFocus('sidebar');
    setScreen('home');
  }, [hubInfo, assignAgentName, agentSelectItems, refreshHub, zh]);

  const commitLanguage = useCallback(() => {
    const newLang: Locale = langCursor === 0 ? 'en' : 'zh';
    setLocale(newLang);
    const localState = loadLocalState();
    localState.language = newLang;
    saveLocalState(localState);
    setStatus(newLang === 'zh' ? '✔ 语言已切换为中文' : '✔ Language switched to English', 'success');
    refreshHub();
    setSession('success');
    setFocus('sidebar');
    setScreen('home');
  }, [langCursor, refreshHub]);

  // ── Exit ──────────────────────────────────────────────────────────────────────
  const doExit = useCallback(() => { exit(); onDone(null); }, [exit, onDone]);

  // ── Preview sidebar item → update right panel without changing focus ─────────
  const previewMenuItem = useCallback((choice: MainChoice) => {
    if (choice === 'exit' || choice === 'home') { setScreen('home'); return; }
    const simpleCmds: MainChoice[] = ['sync', 'link', 'diff', 'import'];
    if (simpleCmds.includes(choice)) { setScreen('home'); return; }
    setTextValue('');
    setAgentsAddStep('name');
    setAgentsAddName('');
    if (choice === 'init')       { setScreen('init-input'); return; }
    if (choice === 'install')    { setScreen('install-input'); return; }
    if (choice === 'add-remote') { setScreen('add-remote-input'); return; }
    if (choice === 'list')       { setListVerboseIdx(0); setScreen('list-verbose'); return; }
    if (choice === 'agents')     { setAgentsSubIdx(1); setScreen('agents-sub'); return; }
    if (choice === 'language')   { setLangCursor(getLocale() === 'zh' ? 1 : 0); setScreen('language-pick'); return; }
    if (choice === 'remove') {
      if (!hubInfo.initialized || hubInfo.skillNames.length === 0) { setScreen('home'); return; }
      setSingleSelectItems(hubInfo.skillNames.map(name => ({ value: name, label: name })));
      setSingleSelectCursor(0);
      setScreen('remove-pick');
      return;
    }
    if (choice === 'assign') {
      if (!hubInfo.initialized) { setScreen('home'); return; }
      const reg = loadRegistry(hubInfo.hubPath);
      const enabledAgents = Object.values(reg.agents).filter((a: AgentConfig) => a.available && a.enabled);
      if (enabledAgents.length === 0) { setScreen('home'); return; }
      setSingleSelectItems(enabledAgents.map(a => ({ value: a.name, label: a.name })));
      setSingleSelectCursor(0);
      setScreen('assign-pick-agent');
      return;
    }
  }, [hubInfo]);

  // ── Navigate sidebar → screen ────────────────────────────────────────────────
  const selectMenuItem = useCallback((choice: MainChoice) => {
    if (choice === 'exit')  { doExit(); return; }
    if (choice === 'home')  { setScreen('home'); setFocus('sidebar'); setSession('idle'); return; }

    setTextValue('');
    setAgentsAddStep('name');
    setAgentsAddName('');

    const simpleCmds: MainChoice[] = ['sync', 'link', 'diff', 'import'];
    if (simpleCmds.includes(choice)) { execSimple([choice]); return; }

    if (choice === 'init')     { setScreen('init-input');    setFocus('content'); }
    if (choice === 'install')  { setScreen('install-input'); setFocus('content'); }
    if (choice === 'add-remote') { setScreen('add-remote-input'); setFocus('content'); }
    if (choice === 'list')     { setListVerboseIdx(0); setScreen('list-verbose'); setFocus('content'); }
    if (choice === 'remove')   { enterRemovePick(); }
    if (choice === 'agents')   { setAgentsSubIdx(1); setScreen('agents-sub'); setFocus('content'); }
    if (choice === 'assign')   { enterAssignPickAgent(); }
    if (choice === 'language') { setLangCursor(getLocale() === 'zh' ? 1 : 0); setScreen('language-pick'); setFocus('content'); }
  }, [doExit, execSimple, enterRemovePick, enterAssignPickAgent]);

  // ── Input handler ─────────────────────────────────────────────────────────────
  useInput((input, key) => {
    if (input === '\x03') { doExit(); return; }

    // ── Running state: Esc to abort ──────────────────────────────────────────
    if (session === 'loading' && screen === 'running') {
      if (key.escape) {
        if (childRef.current) { childRef.current.kill(); childRef.current = null; }
        setSession('error');
        setStatus(zh ? '✖ 已取消' : '✖ cancelled', 'warn');
      }
      return;
    }

    // ── Confirm modal ─────────────────────────────────────────────────────────
    if (screen === 'confirm-modal') {
      if (key.leftArrow)  { setConfirmCursor(0); return; }
      if (key.rightArrow) { setConfirmCursor(1); return; }
      if (key.upArrow || key.downArrow) { setConfirmCursor(c => c === 0 ? 1 : 0); return; }
      if (key.escape) { setConfirmCursor(0); setFocus('sidebar'); setScreen('home'); setSession('idle'); return; }
      if (key.return) {
        if (confirmCursor === 0) { setFocus('sidebar'); setScreen('home'); setSession('idle'); }
        else if (confirmCursor === 1 && confirmAction) { confirmAction(); setConfirmAction(null); }
      }
      return;
    }

    // ── Sidebar focus ─────────────────────────────────────────────────────────
    if (focus === 'sidebar') {
      if (key.upArrow)   { const i = Math.max(0, menuIdx - 1); setMenuIdx(i); previewMenuItem(MENU_ITEMS[i].value); return; }
      if (key.downArrow) { const i = Math.min(MENU_ITEMS.length - 1, menuIdx + 1); setMenuIdx(i); previewMenuItem(MENU_ITEMS[i].value); return; }
      if (key.return)     { selectMenuItem(MENU_ITEMS[menuIdx].value); return; }
      if (key.rightArrow || key.tab) {
        if (screen === 'running') setFocus('output');
        else setFocus('content');
        return;
      }
      if (input === 'q') { doExit(); return; }
      if (input === 'j') { const i = Math.min(MENU_ITEMS.length - 1, menuIdx + 1); setMenuIdx(i); previewMenuItem(MENU_ITEMS[i].value); return; }
      if (input === 'k') { const i = Math.max(0, menuIdx - 1); setMenuIdx(i); previewMenuItem(MENU_ITEMS[i].value); return; }
      return;
    }

    // ── Output focus ──────────────────────────────────────────────────────────
    if (focus === 'output') {
      if (key.escape || key.leftArrow) { setFocus('sidebar'); return; }
      if (key.tab) { setFocus('content'); return; }
      if (key.upArrow) {
        setOutputScroll(s => Math.max(0, s - 1));
        return;
      }
      if (key.downArrow) {
        const contentRows = Math.max(1, Math.max(3, bodyHeight - 3) - 1);
        setOutputScroll(s => Math.max(0, Math.min(Math.max(0, outputLines.length - contentRows), s + 1)));
        return;
      }
      if (input === 'c') { clearOutput(); return; }
      return;
    }

    // ── Content focus: Tab switches to output ──────────────────────────────────
    if (focus === 'content' && key.tab) { setFocus('output'); return; }

    // ── Content focus: universal back ─────────────────────────────────────────
    if (key.escape || key.leftArrow) {
      if (session === 'success' || session === 'error') {
        setSession('idle'); setScreen('home'); setFocus('sidebar'); return;
      }
      // Agents-add path step: Esc goes back to name step
      if (screen === 'agents-add' && agentsAddStep === 'path') {
        setAgentsAddStep('name');
        setTextValue(agentsAddName);
        return;
      }
      setFocus('sidebar'); setSession('idle'); previewMenuItem(MENU_ITEMS[menuIdx].value); return;
    }

    // ── After command finished ────────────────────────────────────────────────
    if (session === 'success' || session === 'error') {
      if (key.return) { setSession('idle'); setScreen('home'); setFocus('sidebar'); return; }
      if (key.tab) { setFocus('output'); return; }
      return;
    }

    // ── Text-input screens ────────────────────────────────────────────────────
    if (['init-input', 'install-input', 'add-remote-input'].includes(screen)) {
      if (key.return) {
        const trimmed = textValue.trim();
        if (screen === 'init-input') {
          if (trimmed) execSimple(['init', trimmed]);
          else execSimple(['init']);
        } else if (screen === 'install-input') {
          if (!trimmed) { setStatus(zh ? '请输入技能名称' : 'Skill name is required', 'error'); return; }
          execSimple(['install', trimmed]);
        } else if (screen === 'add-remote-input') {
          if (!trimmed) { setStatus(zh ? '请输入远程 URL' : 'Remote URL is required', 'error'); return; }
          execSimple(['add-remote', trimmed]);
        }
      } else if (key.backspace || key.delete) {
        setTextValue(v => v.slice(0, -1));
      } else if (!key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow && input.length > 0) {
        setTextValue(v => v + input);
      }
      return;
    }

    // ── Agents-add (two-step: name then path) ─────────────────────────────────
    if (screen === 'agents-add') {
      if (agentsAddStep === 'name') {
        if (key.return) {
          const trimmed = textValue.trim();
          if (!trimmed) { setStatus(zh ? '请输入 Agent 名称' : 'Agent name is required', 'error'); return; }
          setAgentsAddName(trimmed);
          setTextValue('');
          setAgentsAddStep('path');
        } else if (key.backspace || key.delete) {
          setTextValue(v => v.slice(0, -1));
        } else if (!key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow && input.length > 0) {
          setTextValue(v => v + input);
        }
      } else { // path step
        if (key.return) {
          const agentPath = textValue.trim();
          if (!agentPath) { setStatus(zh ? '请输入技能路径' : 'Skills path is required', 'error'); return; }
          execSimple(['agents', 'add', agentsAddName, '--path', agentPath]);
        } else if (key.backspace || key.delete) {
          setTextValue(v => v.slice(0, -1));
        } else if (!key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow && input.length > 0) {
          setTextValue(v => v + input);
        }
      }
      return;
    }

    // ── List verbose picker ────────────────────────────────────────────────────
    if (screen === 'list-verbose') {
      if (key.upArrow)   { setListVerboseIdx(i => (i - 1 + 2) % 2); return; }
      if (key.downArrow) { setListVerboseIdx(i => (i + 1) % 2); return; }
      if (key.return)    { execSimple(listVerboseIdx === 1 ? ['list', '--verbose'] : ['list']); return; }
      return;
    }

    // ── Agents sub ──────────────────────────────────────────────────────────────
    if (screen === 'agents-sub') {
      if (key.upArrow)   { setAgentsSubIdx(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setAgentsSubIdx(i => Math.min(AGENTS_ITEMS.length - 1, i + 1)); return; }
      if (key.return) {
        const sub = AGENTS_ITEMS[agentsSubIdx].value;
        if (sub === 'list')    { execSimple(['agents', 'list']); return; }
        if (sub === 'select')  { enterAgentsSelect(); return; }
        if (sub === 'enable')  { enterSingleAgentPick('enable'); return; }
        if (sub === 'disable') { enterSingleAgentPick('disable'); return; }
        if (sub === 'add')     { setScreen('agents-add'); setFocus('content'); setTextValue(''); setAgentsAddStep('name'); return; }
        if (sub === 'remove-agent') { enterSingleAgentPick('remove-agent'); return; }
      }
      return;
    }

    // ── Multi-select screens ────────────────────────────────────────────────────
    if (['agents-select', 'assign-pick-skills'].includes(screen)) {
      if (key.upArrow)   { setAgentSelectCursor(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setAgentSelectCursor(i => Math.min(agentSelectItems.length - 1, i + 1)); return; }
      if (input === ' ') {
        const idx = agentSelectCursor;
        if (!agentSelectItems[idx]?.disabled) {
          setAgentSelectItems(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], checked: !next[idx].checked };
            return next;
          });
        }
        return;
      }
      if (key.return) {
        if (screen === 'agents-select') { commitAgentsSelect(); return; }
        if (screen === 'assign-pick-skills') { commitAssign(); return; }
      }
      if (input === 'a') { setAgentSelectItems(prev => prev.map(item => ({ ...item, checked: !item.disabled }))); return; }
      if (input === 'i') { setAgentSelectItems(prev => prev.map(item => item.disabled ? item : { ...item, checked: !item.checked })); return; }
      return;
    }

    // ── Single-select screens ────────────────────────────────────────────────────
    if (['remove-pick', 'agents-enable', 'agents-disable', 'agents-remove', 'assign-pick-agent'].includes(screen)) {
      if (key.upArrow)   { setSingleSelectCursor(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setSingleSelectCursor(i => Math.min(singleSelectItems.length - 1, i + 1)); return; }
      if (key.return) {
        const val = singleSelectItems[singleSelectCursor]?.value;
        if (!val) return;
        if (screen === 'remove-pick') {
          confirmThenExec(zh ? `确认删除技能 "${val}"？此操作不可撤销。` : `Delete skill "${val}"? This cannot be undone.`, ['remove', val]);
          return;
        }
        if (screen === 'agents-enable')   { execSimple(['agents', 'enable', val]); return; }
        if (screen === 'agents-disable')  { execSimple(['agents', 'disable', val]); return; }
        if (screen === 'agents-remove')   { confirmThenExec(zh ? `确认移除 Agent "${val}"？` : `Remove agent "${val}"?`, ['agents', 'remove', val]); return; }
        if (screen === 'assign-pick-agent') { enterAssignPickSkills(val); return; }
      }
      return;
    }

    // ── Language picker ─────────────────────────────────────────────────────────
    if (screen === 'language-pick') {
      if (key.upArrow)   { setLangCursor(0); return; }
      if (key.downArrow) { setLangCursor(1); return; }
      if (key.return)    { commitLanguage(); return; }
      return;
    }
  });

  // ── Derive display values ────────────────────────────────────────────────────
  const curItem = MENU_ITEMS[menuIdx];
  const label = (item: typeof MENU_ITEMS[0]) => zh ? item.zh : item.en;
  const pills = hubInfo.agents.filter(a => a.available && a.enabled).slice(0, 5);
  const statusColorMap = { info: 'blue', success: 'green', warn: 'yellow', error: 'red' };

  // Border colors based on focus
  const sideBC = focus === 'sidebar' ? 'cyan' : 'gray';
  const contBC = focus === 'content' ? 'cyan' : 'gray';
  const outBC  = focus === 'output'   ? 'cyan' : 'gray';

  // Layout widths (border chars: │sidebar│ │content│ │output│ = 4 vertical chars + 2 padding on each panel)
  const SIDEBAR_INNER = SIDEBAR_W + 2;  // inner width (padX=1 each side)
  const OUTPUT_FULL   = 36;             // output panel total column width (inner + 2 border separators)
  const OUTPUT_INNER  = OUTPUT_FULL - 2; // inner width
  // Column widths for top/bottom borders
  const SIDE_BORDER_W = SIDEBAR_INNER;      // ─ chars between ┌ and ┬
  const OUT_BORDER_W  = OUTPUT_INNER;       // ─ chars between ┬ and ┐
  const CONT_BORDER_W = Math.max(0, termCols - SIDE_BORDER_W - OUT_BORDER_W - 4); // 4 = ┌┬┬┐

  // ── Build border segments ───────────────────────────────────────────────────

  // Full-height vertical border column
  const vbar = (color: string) => (
    <Box flexDirection="column">
      {Array.from({length: bodyHeight}, (_, i) => <Text key={i} color={color}>│</Text>)}
    </Box>
  );

  // Top border: ┌── Sidebar ──┬── Content ──┬── Output ──┐
  const topBorder = (
    <Box flexDirection="row">
      <Text color={sideBC}>┌{'─'.repeat(SIDE_BORDER_W)}┬</Text>
      <Text color={contBC}>{'─'.repeat(CONT_BORDER_W)}┬</Text>
      <Text color={outBC}>{'─'.repeat(OUT_BORDER_W)}┐</Text>
    </Box>
  );

  // Bottom border: └── Sidebar ──┴── Content ──┴── Output ──┘
  const bottomBorder = (
    <Box flexDirection="row">
      <Text color={sideBC}>└{'─'.repeat(SIDE_BORDER_W)}┴</Text>
      <Text color={contBC}>{'─'.repeat(CONT_BORDER_W)}┴</Text>
      <Text color={outBC}>{'─'.repeat(OUT_BORDER_W)}┘</Text>
    </Box>
  );

  // Content panel inner content
  const contentInner = (
    <Box flexDirection="column">
      {/* Home */}
      {screen === 'home' && <HomeContent hubInfo={hubInfo} loading={hubLoading} />}

      {/* Text-input screens */}
      {['init-input', 'install-input', 'add-remote-input'].includes(screen) && (
        <Box flexDirection="column">
          <Text bold>
            {screen === 'init-input' && t('tui.initUrlPrompt')}
            {screen === 'install-input' && t('tui.installNamePrompt')}
            {screen === 'add-remote-input' && t('tui.addRemoteUrlPrompt')}
          </Text>
          <Box marginTop={1}><TextInput value={textValue} hint={zh ? '回车确认  Esc返回' : 'Enter confirm  Esc back'} /></Box>
        </Box>
      )}

      {/* Agents-add (two-step) */}
      {screen === 'agents-add' && (
        <Box flexDirection="column">
          <Text bold>{zh ? '添加自定义 Agent' : 'Add custom agent'}</Text>
          {agentsAddStep === 'name' && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan">{zh ? 'Agent 名称：' : 'Agent name: '}</Text>
              <TextInput value={textValue} hint={zh ? '回车继续  Esc返回' : 'Enter next  Esc back'} />
            </Box>
          )}
          {agentsAddStep === 'path' && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan">{zh ? `技能目录路径（${agentsAddName}）：` : `Skills path (${agentsAddName}): `}</Text>
              <TextInput value={textValue} hint={zh ? '回车确认  Esc改名称' : 'Enter confirm  Esc back to name'} />
            </Box>
          )}
        </Box>
      )}

      {/* List verbose */}
      {screen === 'list-verbose' && (
        <Box flexDirection="column">
          <Text bold>{t('tui.listVerbosePrompt')}</Text>
          <SelectList
            items={[{ value: 'normal', label: t('tui.listNormal') }, { value: 'verbose', label: t('tui.listVerbose') }]}
            cursorIdx={listVerboseIdx}
          />
        </Box>
      )}

      {/* Agents sub */}
      {screen === 'agents-sub' && (
        <Box flexDirection="column">
          <Text bold>{t('tui.agentsSubcmdPrompt')}</Text>
          <SelectList
            items={AGENTS_ITEMS.map(item => ({ value: item.value, label: t(item.labelKey as any), detail: t(item.descKey as any) }))}
            cursorIdx={agentsSubIdx}
          />
        </Box>
      )}

      {/* Agents-select */}
      {screen === 'agents-select' && (
        <Box flexDirection="column">
          <Text bold>{zh ? '选择要托管的 Agent' : 'Select agents to manage'}</Text>
          <MultiSelectList items={agentSelectItems} cursorIdx={agentSelectCursor} zh={zh} />
        </Box>
      )}

      {/* Single-select screens */}
      {['remove-pick', 'agents-enable', 'agents-disable', 'agents-remove', 'assign-pick-agent'].includes(screen) && (
        <Box flexDirection="column">
          <Text bold>
            {screen === 'remove-pick' && (zh ? '选择要删除的技能：' : 'Select skill to remove:')}
            {screen === 'agents-enable' && (zh ? '选择要启用的 Agent：' : 'Select agent to enable:')}
            {screen === 'agents-disable' && (zh ? '选择要禁用的 Agent：' : 'Select agent to disable:')}
            {screen === 'agents-remove' && (zh ? '选择要移除的 Agent：' : 'Select agent to remove:')}
            {screen === 'assign-pick-agent' && (zh ? '选择要分配技能的 Agent：' : 'Select agent to assign skills to:')}
          </Text>
          <SelectList items={singleSelectItems} cursorIdx={singleSelectCursor} />
        </Box>
      )}

      {/* Assign-pick-skills */}
      {screen === 'assign-pick-skills' && (
        <Box flexDirection="column">
          <Text bold>{zh ? `为 ${assignAgentName} 选择技能` : `Select skills for ${assignAgentName}`}</Text>
          <MultiSelectList items={agentSelectItems} cursorIdx={agentSelectCursor} zh={zh} />
        </Box>
      )}

      {/* Language picker */}
      {screen === 'language-pick' && (
        <Box flexDirection="column">
          <Text bold>{zh ? '选择语言 / Select language' : 'Select language / 选择语言'}</Text>
          <SelectList items={[{ value: 'en', label: 'English' }, { value: 'zh', label: '中文' }]} cursorIdx={langCursor} />
        </Box>
      )}

      {/* Confirm modal */}
      {screen === 'confirm-modal' && (
        <ConfirmModal message={confirmMessage} cursorIdx={confirmCursor} zh={zh} />
      )}
    </Box>
  );

  // Output panel inner content
  const outputInner = (
    <Box flexDirection="column">
      {screen === 'running' && session === 'loading' && (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan">{SPINNER[spinnerIdx]}</Text>
            <Text color="white">{`  ${spinnerLabel}...`}</Text>
          </Box>
          <Box marginTop={1}>
            <OutputPanel lines={outputLines} maxLines={Math.max(3, bodyHeight - 4)} follow={true} />
          </Box>
          <Box marginTop={1}>
            <Text color="gray" dimColor>{zh ? 'Esc 取消' : 'Esc cancel'}</Text>
          </Box>
        </Box>
      )}

      {screen === 'running' && (session === 'success' || session === 'error') && (
        <Box flexDirection="column">
          <OutputPanel lines={outputLines} maxLines={Math.max(3, bodyHeight - 2)} offset={outputScroll} />
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              {zh ? 'Enter 返回  ↑↓ 滚动  Tab 切换焦点' : 'Enter back  ↑↓ scroll  Tab switch focus'}
            </Text>
          </Box>
        </Box>
      )}

      {screen !== 'running' && outputLines.length > 0 && (
        <Box flexDirection="column">
          <OutputPanel lines={outputLines} maxLines={Math.max(3, bodyHeight - 2)} offset={outputScroll} />
        </Box>
      )}

      {screen !== 'running' && outputLines.length === 0 && (
        <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
          <Text color="gray" dimColor italic>{zh ? '输出区域' : 'Output'}</Text>
        </Box>
      )}
    </Box>
  );

  return (
    <Box flexDirection="column">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <Box flexDirection="row" paddingX={1}>
        <Text bold color="cyan">skillstash</Text>
        <Text>{'  '}</Text>
        {pills.map(a => (
          <Box key={a.name} marginRight={1}>
            <Text backgroundColor="cyan" color="black">{` ${a.name} `}</Text>
          </Box>
        ))}
        <Box flexGrow={1} />
        <Text color={hubInfo.initialized ? 'green' : 'yellow'}>
          {hubInfo.initialized ? (zh ? '● Hub 已就绪' : '● Hub ready') : (zh ? '○ 未初始化' : '○ Not initialized')}
        </Text>
      </Box>

      {/* ── Border: top ─────────────────────────────────────────────────────── */}
      {topBorder}

      {/* ── Main body (3 panels, shared borders) ───────────────────────────── */}
      <Box flexDirection="row" height={bodyHeight}>

        {/* Left border │ */}
        {vbar(sideBC)}

        {/* Sidebar */}
        <Box flexDirection="column" width={SIDEBAR_W + 2} paddingX={1}>
          <Box marginBottom={1}>
            <Text bold color={focus === 'sidebar' ? 'cyan' : 'gray'}>{zh ? '菜单' : 'Menu'}</Text>
          </Box>
          {MENU_ITEMS.map((item, i) => {
            const active = i === menuIdx;
            const lbl = label(item);
            if (active && focus === 'sidebar') return (
              <Box key={item.value} width={SIDEBAR_W}>
                <Text backgroundColor="cyan" color="black" wrap="truncate">{padR(` ${item.emoji} ${lbl}`, SIDEBAR_W)}</Text>
              </Box>
            );
            if (active) return (
              <Box key={item.value} width={SIDEBAR_W}>
                <Box width={4}><Text color="cyan">{`▶${item.emoji}`}</Text></Box>
                <Text color="cyan" wrap="truncate">{lbl}</Text>
              </Box>
            );
            return (
              <Box key={item.value} width={SIDEBAR_W}>
                <Box width={4}><Text color="gray">{` ${item.emoji}`}</Text></Box>
                <Text color="gray" wrap="truncate">{lbl}</Text>
              </Box>
            );
          })}
        </Box>

        {/* Separator │ between sidebar and content */}
        {vbar(contBC)}

        {/* Content */}
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          <Box flexDirection="row" marginBottom={1}>
            <Text bold color={focus === 'content' ? 'cyan' : 'white'}>{`${curItem.emoji}  ${label(curItem)}`}</Text>
          </Box>
          {contentInner}
        </Box>

        {/* Separator │ between content and output */}
        {vbar(outBC)}

        {/* Output */}
        <Box flexDirection="column" width={OUTPUT_FULL - 2} paddingX={1}>
          <Box marginBottom={1}>
            <Text bold color={focus === 'output' ? 'cyan' : 'gray'}>{zh ? '输出' : 'Output'}</Text>
          </Box>
          {outputInner}
        </Box>

        {/* Right border │ */}
        {vbar(outBC)}
      </Box>

      {/* ── Border: bottom ──────────────────────────────────────────────────── */}
      {bottomBorder}

      {/* ── Status bar ──────────────────────────────────────────────────────── */}
      <Box paddingX={1}>
        {statusMsg ? (
          <Text color={statusColorMap[statusType]} bold>{statusMsg}</Text>
        ) : (
          <Text color="gray" dimColor italic>{zh ? '就绪' : 'Ready'}</Text>
        )}
        <Box flexGrow={1} />
        <Text bold color="gray">{'NAV'}</Text>
        <Text color="gray" dimColor>{' ←→'}</Text>
        <Text color="gray">{zh ? '切换' : 'switch'}</Text>
        <Text color="gray" dimColor>{' ↑↓'}</Text>
        <Text color="gray">{zh ? '移动' : 'move'}</Text>
        <Text color="gray" dimColor>{' '}</Text>
        <Text bold color="gray">{'ACT'}</Text>
        <Text color="gray" dimColor>{' Enter'}</Text>
        <Text color="gray">{zh ? '执行' : 'exec'}</Text>
        <Text color="gray" dimColor>{' Esc'}</Text>
        <Text color="gray">{zh ? '返回' : 'back'}</Text>
        <Text color="gray" dimColor>{' q'}</Text>
        <Text color="gray">{zh ? '退出' : 'quit'}</Text>
      </Box>
    </Box>
  );
}

// ── Public API ──────────────────────────────────────────────────────────────────

export async function launchTUI(): Promise<string[] | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;

  // Enter alternate screen buffer + hide cursor (standard fullscreen terminal app pattern)
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H');

  let result: string[] | null = null;
  try {
    const { waitUntilExit } = render(<App onDone={args => { result = args; }} />, {
      exitOnCtrlC: false,
      patchConsole: true,
    });
    await waitUntilExit().catch((err) => {
      if (process.env.SKILLSTASH_DEBUG) console.error('[TUI error]', err);
    });
  } finally {
    // Exit alternate screen buffer + restore cursor unconditionally
    process.stdout.write('\x1b[?1049l\x1b[?25h');
  }
  return result;
}

// ── buildArgs (exported for tests) ──────────────────────────────────────────────

export interface BuildArgsInputs {
  initUrl?: string;
  installName?: string;
  listVerbose?: boolean;
  removeName?: string;
  agentsSub?: 'list' | 'select' | 'enable' | 'disable';
  agentName?: string;
  addRemoteUrl?: string;
}

export function buildArgs(choice: MainChoice, inputs: BuildArgsInputs): string[] | null {
  switch (choice) {
    case 'home':      return null;
    case 'exit':      return null;
    case 'sync':      return ['sync'];
    case 'link':      return ['link'];
    case 'diff':      return ['diff'];
    case 'import':    return ['import'];
    case 'assign':    return ['assign'];
    case 'language':  return ['language'];
    case 'init':      return (inputs.initUrl?.trim() ?? '') ? ['init', inputs.initUrl!.trim()] : ['init'];
    case 'install':   return (inputs.installName?.trim() ?? '') ? ['install', inputs.installName!.trim()] : null;
    case 'list':      return inputs.listVerbose ? ['list', '--verbose'] : ['list'];
    case 'remove':    return (inputs.removeName?.trim() ?? '') ? ['remove', inputs.removeName!.trim()] : null;
    case 'agents': {
      const sub = inputs.agentsSub;
      if (!sub) return null;
      if (sub === 'enable' || sub === 'disable') {
        const name = inputs.agentName?.trim() ?? '';
        return name ? ['agents', sub, name] : null;
      }
      return ['agents', sub];
    }
    case 'add-remote': return (inputs.addRemoteUrl?.trim() ?? '') ? ['add-remote', inputs.addRemoteUrl!.trim()] : null;
    default: return null;
  }
}