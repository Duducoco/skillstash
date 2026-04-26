import React, { useState, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { t } from '../i18n/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MainChoice =
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

export type AgentsSubChoice = 'list' | 'select' | 'enable' | 'disable';

export interface BuildArgsInputs {
  initUrl?: string;
  installName?: string;
  listVerbose?: boolean;
  removeName?: string;
  agentsSub?: AgentsSubChoice;
  agentName?: string;
  addRemoteUrl?: string;
}

type Screen =
  | 'menu'
  | 'install-input'
  | 'init-input'
  | 'list-verbose'
  | 'remove-input'
  | 'agents-sub'
  | 'agents-name'
  | 'add-remote-input';

// ── Menu definitions ──────────────────────────────────────────────────────────

const MENU_ITEMS: ReadonlyArray<{ value: MainChoice; emoji: string; descKey: string }> = [
  { value: 'init',       emoji: '🚀', descKey: 'tui.initDesc' },
  { value: 'install',    emoji: '📦', descKey: 'tui.installDesc' },
  { value: 'list',       emoji: '📋', descKey: 'tui.listDesc' },
  { value: 'sync',       emoji: '🔄', descKey: 'tui.syncDesc' },
  { value: 'link',       emoji: '🔗', descKey: 'tui.linkDesc' },
  { value: 'diff',       emoji: '📊', descKey: 'tui.diffDesc' },
  { value: 'import',     emoji: '📥', descKey: 'tui.importDesc' },
  { value: 'remove',     emoji: '🗑️',  descKey: 'tui.removeDesc' },
  { value: 'agents',     emoji: '🤖', descKey: 'tui.agentsDesc' },
  { value: 'assign',     emoji: '🎯', descKey: 'tui.assignDesc' },
  { value: 'language',   emoji: '🌍', descKey: 'tui.languageDesc' },
  { value: 'add-remote', emoji: '🌐', descKey: 'tui.addRemoteDesc' },
  { value: 'exit',       emoji: '🚪', descKey: 'tui.exit' },
];

const AGENTS_ITEMS: ReadonlyArray<{ value: AgentsSubChoice; label: string; descKey: string }> = [
  { value: 'list',    label: 'agents list',    descKey: 'tui.agentsListDesc' },
  { value: 'select',  label: 'agents select',  descKey: 'tui.agentsSelectDesc' },
  { value: 'enable',  label: 'agents enable',  descKey: 'tui.agentsEnableDesc' },
  { value: 'disable', label: 'agents disable', descKey: 'tui.agentsDisableDesc' },
];

const LIST_ITEMS: ReadonlyArray<{ value: boolean; labelKey: string }> = [
  { value: false, labelKey: 'tui.listNormal' },
  { value: true,  labelKey: 'tui.listVerbose' },
];

// ── Pure args builder (exported for testing) ──────────────────────────────────

export function buildArgs(choice: MainChoice, inputs: BuildArgsInputs): string[] | null {
  switch (choice) {
    case 'exit':     return null;
    case 'sync':     return ['sync'];
    case 'link':     return ['link'];
    case 'diff':     return ['diff'];
    case 'import':   return ['import'];
    case 'assign':   return ['assign'];
    case 'language': return ['language'];

    case 'init': {
      const url = inputs.initUrl?.trim() ?? '';
      return url ? ['init', url] : ['init'];
    }

    case 'install': {
      const name = inputs.installName?.trim() ?? '';
      return name ? ['install', name] : null;
    }

    case 'list':
      return inputs.listVerbose ? ['list', '--verbose'] : ['list'];

    case 'remove': {
      const name = inputs.removeName?.trim() ?? '';
      return name ? ['remove', name] : null;
    }

    case 'agents': {
      const sub = inputs.agentsSub;
      if (!sub) return null;
      if (sub === 'enable' || sub === 'disable') {
        const name = inputs.agentName?.trim() ?? '';
        return name ? ['agents', sub, name] : null;
      }
      return ['agents', sub];
    }

    case 'add-remote': {
      const url = inputs.addRemoteUrl?.trim() ?? '';
      return url ? ['add-remote', url] : null;
    }

    default:
      return null;
  }
}

// ── Helper: pad label to fixed width ─────────────────────────────────────────

function pad(s: string, n: number): string {
  return s + ' '.repeat(Math.max(0, n - s.length));
}

// ── Ink App component ─────────────────────────────────────────────────────────

interface AppProps {
  onDone: (args: string[] | null) => void;
}

function App({ onDone }: AppProps) {
  const { exit } = useApp();

  const [screen, setScreen]               = useState<Screen>('menu');
  const [menuIdx, setMenuIdx]             = useState(0);
  const [textValue, setTextValue]         = useState('');
  const [selectedChoice, setSelectedChoice] = useState<MainChoice>('install');
  const [agentsSubIdx, setAgentsSubIdx]   = useState(0);
  const [listVerboseIdx, setListVerboseIdx] = useState(0);
  const [error, setError]                 = useState('');

  const done = useCallback((args: string[] | null) => {
    onDone(args);
    exit();
  }, [onDone, exit]);

  useInput((input, key) => {
    setError('');

    // ── Main menu ────────────────────────────────────────────────────────────
    if (screen === 'menu') {
      if (key.upArrow) {
        setMenuIdx(i => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setMenuIdx(i => Math.min(MENU_ITEMS.length - 1, i + 1));
      } else if (key.return) {
        const choice = MENU_ITEMS[menuIdx].value;
        if (choice === 'exit') {
          done(null);
        } else if (choice === 'install') {
          setSelectedChoice('install'); setTextValue(''); setScreen('install-input');
        } else if (choice === 'init') {
          setSelectedChoice('init'); setTextValue(''); setScreen('init-input');
        } else if (choice === 'list') {
          setSelectedChoice('list'); setListVerboseIdx(0); setScreen('list-verbose');
        } else if (choice === 'remove') {
          setSelectedChoice('remove'); setTextValue(''); setScreen('remove-input');
        } else if (choice === 'agents') {
          setSelectedChoice('agents'); setAgentsSubIdx(0); setScreen('agents-sub');
        } else if (choice === 'add-remote') {
          setSelectedChoice('add-remote'); setTextValue(''); setScreen('add-remote-input');
        } else {
          // Simple commands: sync, link, diff, import, assign, language
          done(buildArgs(choice, {}));
        }
      } else if (input === 'q') {
        done(null);
      }
      return;
    }

    // ── Text-input screens (install, init, remove, add-remote) ───────────────
    if (
      screen === 'install-input' ||
      screen === 'init-input'    ||
      screen === 'remove-input'  ||
      screen === 'add-remote-input'
    ) {
      if (key.escape) {
        setScreen('menu');
      } else if (key.return) {
        let result: string[] | null;
        if (selectedChoice === 'install')    result = buildArgs('install',    { installName:   textValue });
        else if (selectedChoice === 'init')  result = buildArgs('init',       { initUrl:       textValue });
        else if (selectedChoice === 'remove') result = buildArgs('remove',    { removeName:    textValue });
        else                                  result = buildArgs('add-remote', { addRemoteUrl:  textValue });
        if (result !== null) {
          done(result);
        } else {
          setError('Field is required.');
        }
      } else if (key.backspace || key.delete) {
        setTextValue(v => v.slice(0, -1));
      } else if (!key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow && input.length > 0) {
        setTextValue(v => v + input);
      }
      return;
    }

    // ── list verbose / normal selection ──────────────────────────────────────
    if (screen === 'list-verbose') {
      if (key.escape) {
        setScreen('menu');
      } else if (key.upArrow) {
        setListVerboseIdx(0);
      } else if (key.downArrow) {
        setListVerboseIdx(1);
      } else if (key.return) {
        done(buildArgs('list', { listVerbose: listVerboseIdx === 1 }));
      }
      return;
    }

    // ── agents sub-command selection ─────────────────────────────────────────
    if (screen === 'agents-sub') {
      if (key.escape) {
        setScreen('menu');
      } else if (key.upArrow) {
        setAgentsSubIdx(i => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setAgentsSubIdx(i => Math.min(AGENTS_ITEMS.length - 1, i + 1));
      } else if (key.return) {
        const sub = AGENTS_ITEMS[agentsSubIdx].value;
        if (sub === 'enable' || sub === 'disable') {
          setTextValue('');
          setScreen('agents-name');
        } else {
          done(buildArgs('agents', { agentsSub: sub }));
        }
      }
      return;
    }

    // ── agents name input (for enable / disable) ─────────────────────────────
    if (screen === 'agents-name') {
      if (key.escape) {
        setScreen('agents-sub');
      } else if (key.return) {
        const sub = AGENTS_ITEMS[agentsSubIdx].value as 'enable' | 'disable';
        const result = buildArgs('agents', { agentsSub: sub, agentName: textValue });
        if (result !== null) {
          done(result);
        } else {
          setError('Field is required.');
        }
      } else if (key.backspace || key.delete) {
        setTextValue(v => v.slice(0, -1));
      } else if (!key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow && input.length > 0) {
        setTextValue(v => v + input);
      }
    }
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" paddingX={1}>

      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={2} marginBottom={1}>
        <Text bold color="cyan">🗂   skillstash  TUI</Text>
      </Box>

      {/* Main menu */}
      {screen === 'menu' && (
        <Box flexDirection="column">
          <Text bold>{t('tui.selectCommand')}</Text>
          <Box flexDirection="column" marginTop={1}>
            {MENU_ITEMS.map((item, i) => {
              const active = i === menuIdx;
              const cursor = active ? '▶' : ' ';
              const label  = pad(item.value, 12);
              const desc   = item.value === 'exit' ? '' : t(item.descKey as Parameters<typeof t>[0]);
              return (
                <Text key={item.value} color={active ? 'cyan' : undefined} bold={active}>
                  {cursor} {item.emoji}  {label}  {desc}
                </Text>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Text input screens */}
      {(screen === 'install-input' || screen === 'init-input' || screen === 'remove-input' || screen === 'add-remote-input') && (
        <Box flexDirection="column">
          <Text bold>
            {screen === 'install-input'    && t('tui.installNamePrompt')}
            {screen === 'init-input'       && t('tui.initUrlPrompt')}
            {screen === 'remove-input'     && t('tui.removeNamePrompt')}
            {screen === 'add-remote-input' && t('tui.addRemoteUrlPrompt')}
          </Text>
          <Box marginTop={1}>
            <Text color="green">{'> '}</Text>
            <Text color="cyan">{textValue}</Text>
            <Text bold inverse>{' '}</Text>
          </Box>
        </Box>
      )}

      {/* List: normal / verbose */}
      {screen === 'list-verbose' && (
        <Box flexDirection="column">
          <Text bold>{t('tui.listVerbosePrompt')}</Text>
          <Box flexDirection="column" marginTop={1}>
            {LIST_ITEMS.map((item, i) => {
              const active = i === listVerboseIdx;
              return (
                <Text key={String(item.value)} color={active ? 'cyan' : undefined} bold={active}>
                  {active ? '▶' : ' '} {t(item.labelKey as Parameters<typeof t>[0])}
                </Text>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Agents sub-command */}
      {screen === 'agents-sub' && (
        <Box flexDirection="column">
          <Text bold>{t('tui.agentsSubcmdPrompt')}</Text>
          <Box flexDirection="column" marginTop={1}>
            {AGENTS_ITEMS.map((item, i) => {
              const active = i === agentsSubIdx;
              return (
                <Text key={item.value} color={active ? 'cyan' : undefined} bold={active}>
                  {active ? '▶' : ' '} {pad(item.label, 18)}  {t(item.descKey as Parameters<typeof t>[0])}
                </Text>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Agents name input */}
      {screen === 'agents-name' && (
        <Box flexDirection="column">
          <Text bold>{t('tui.agentNamePrompt')}</Text>
          <Box marginTop={1}>
            <Text color="green">{'> '}</Text>
            <Text color="cyan">{textValue}</Text>
            <Text bold inverse>{' '}</Text>
          </Box>
        </Box>
      )}

      {/* Validation error */}
      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {/* Footer: key hints */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray">
          {screen === 'menu'
            ? '↑↓ navigate   Enter select   q quit'
            : 'Enter confirm   Esc back'}
        </Text>
      </Box>

    </Box>
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Launch the full-screen Ink TUI.
 * Returns the argument array to pass to Commander, or null if the user chose
 * to exit or the environment is non-interactive.
 */
export async function launchTUI(): Promise<string[] | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  return new Promise<string[] | null>(resolve => {
    const { unmount } = render(
      <App onDone={args => { resolve(args); unmount(); }} />,
    );
  });
}
