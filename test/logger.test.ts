import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger, setVerbose, startSpinner, stopSpinner } from '../src/utils/logger.js';

let consoleSpy: ReturnType<typeof vi.spyOn>;
let writeSpy: ReturnType<typeof vi.spyOn>;
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

beforeEach(() => {
  setVerbose(false);
  delete process.env['SKILLSTASH_VERBOSE'];
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  // Ensure non-TTY for spinner tests
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true, writable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  setVerbose(false);
  delete process.env['SKILLSTASH_VERBOSE'];
  if (originalIsTTY) {
    Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
  }
});

// ── logger methods ─────────────────────────────────────────────────────────────

describe('logger.info', () => {
  it('calls console.log containing the message', () => {
    logger.info('hello info');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain('hello info');
  });
});

describe('logger.success', () => {
  it('calls console.log containing the message', () => {
    logger.success('operation done');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain('operation done');
  });
});

describe('logger.warn', () => {
  it('calls console.log containing the message', () => {
    logger.warn('be careful');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain('be careful');
  });
});

describe('logger.error', () => {
  it('calls console.log containing the message', () => {
    logger.error('something failed');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain('something failed');
  });
});

describe('logger.step', () => {
  it('calls console.log containing the message', () => {
    logger.step('doing step');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain('doing step');
  });
});

describe('logger.raw', () => {
  it('calls console.log with the exact message string', () => {
    logger.raw('raw output');
    expect(consoleSpy).toHaveBeenCalledWith('raw output');
  });
});

describe('logger.verbose', () => {
  it('does not log when verbose is off by default', () => {
    logger.verbose('hidden message');
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('logs when setVerbose(true)', () => {
    setVerbose(true);
    logger.verbose('verbose message');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain('verbose message');
  });

  it('logs when SKILLSTASH_VERBOSE=1', () => {
    process.env['SKILLSTASH_VERBOSE'] = '1';
    logger.verbose('env verbose');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain('env verbose');
  });

  it('stays silent when SKILLSTASH_VERBOSE is not set', () => {
    logger.verbose('should not appear');
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe('logger.progress', () => {
  it('logs message and current/total numbers', () => {
    logger.progress('loading assets', 3, 10);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output: string = consoleSpy.mock.calls[0][0];
    expect(output).toContain('loading assets');
    expect(output).toContain('3');
    expect(output).toContain('10');
  });
});

// ── spinner ────────────────────────────────────────────────────────────────────

describe('startSpinner — non-TTY', () => {
  it('calls console.log (not stdout.write) in non-TTY mode', () => {
    startSpinner('working...');
    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls[0][0]).toContain('working...');
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('stopSpinner — non-TTY', () => {
  it('does not write to stdout in non-TTY mode', () => {
    stopSpinner(true, 'done');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('does not write to stdout on failure in non-TTY mode', () => {
    stopSpinner(false, 'failed');
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

// ── setVerbose ─────────────────────────────────────────────────────────────────

describe('setVerbose', () => {
  it('enables verbose then disables it', () => {
    setVerbose(true);
    logger.verbose('on');
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    consoleSpy.mockClear();

    setVerbose(false);
    logger.verbose('off');
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
