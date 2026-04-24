import chalk from 'chalk';

let _verbose = false;
export function setVerbose(v: boolean): void { _verbose = v; }

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let _spinnerTimer: ReturnType<typeof setInterval> | null = null;
let _spinnerMessage = '';

export function startSpinner(msg: string): void {
  _spinnerMessage = msg;
  if (!process.stdout.isTTY) {
    console.log(chalk.cyan('→ ') + msg);
    return;
  }
  let i = 0;
  _spinnerTimer = setInterval(() => {
    process.stdout.write(`\r${chalk.cyan(spinnerFrames[i % spinnerFrames.length])} ${_spinnerMessage}   `);
    i++;
  }, 80);
}

export function stopSpinner(success = true, msg?: string): void {
  if (_spinnerTimer) {
    clearInterval(_spinnerTimer);
    _spinnerTimer = null;
  }
  if (!process.stdout.isTTY) return;
  const icon = success ? chalk.green('✔') : chalk.red('✖');
  process.stdout.write(`\r${icon} ${msg || _spinnerMessage}   \n`);
}

export const logger = {
  info: (msg: string) => console.log(chalk.blue('ℹ ') + msg),
  success: (msg: string) => console.log(chalk.green('✔ ') + msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠ ') + msg),
  error: (msg: string) => console.log(chalk.red('✖ ') + msg),
  step: (msg: string) => console.log(chalk.cyan('→ ') + msg),
  raw: (msg: string) => console.log(msg),
  verbose: (msg: string) => { if (_verbose || process.env.SKILLSTASH_VERBOSE === '1') console.log(chalk.gray('… ') + msg); },
  progress: (msg: string, current: number, total: number) => {
    console.log(chalk.cyan(`→ [${current}/${total}] `) + msg);
  },
};
