export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERR = "ERR",
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERR]: 3,
};

const COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "\x1b[36m",  // cyan
  [LogLevel.INFO]: "\x1b[32m",   // green
  [LogLevel.WARN]: "\x1b[33m",   // yellow
  [LogLevel.ERR]: "\x1b[31m",    // red
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

let currentLevel: LogLevel = LogLevel.INFO;

export function setLogLevel(level: string) {
  const upper = level.toUpperCase() as LogLevel;
  if (upper in LEVEL_PRIORITY) {
    currentLevel = upper;
  }
}

export function getLogLevel(): string {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function format(level: LogLevel, msg: string): string {
  const ts = timestamp();
  const color = COLORS[level];
  return `${DIM}${ts}${RESET} ${color}${level.padEnd(5)}${RESET} ${msg}`;
}

export function statusBadge(code: number): string {
  const bg =
    code < 300 ? "\x1b[42m" :  // green bg
    code < 400 ? "\x1b[46m" :  // cyan bg
    code < 500 ? "\x1b[43m" :  // yellow bg
    "\x1b[41m";                // red bg
  return `${bg}\x1b[97m ${code} ${RESET}`;
}

export const logger = {
  debug: (msg: string) => {
    if (shouldLog(LogLevel.DEBUG)) console.log(format(LogLevel.DEBUG, msg));
  },
  info: (msg: string) => {
    if (shouldLog(LogLevel.INFO)) console.log(format(LogLevel.INFO, msg));
  },
  warn: (msg: string) => {
    if (shouldLog(LogLevel.WARN)) console.warn(format(LogLevel.WARN, msg));
  },
  err: (msg: string) => {
    if (shouldLog(LogLevel.ERR)) console.error(format(LogLevel.ERR, msg));
  },
};