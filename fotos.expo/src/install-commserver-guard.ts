import { LogBox } from 'react-native';

const COMM_SERVER_LOGBOX_PATTERNS: Array<string | RegExp> = [
  '[CommunicationServerListener] establishControlConnection failed:',
  '[CommunicationServerListener] claimHandoverConnection failed:',
  /\[CommunicationServerListener\]\[perf\].*authenticateConnection failed after/,
];

const COMM_SERVER_ERROR_PATTERNS = [
  /\[CommunicationServerListener\] establishControlConnection failed:/,
  /\[CommunicationServerListener\] claimHandoverConnection failed:/,
  /\[CommunicationServerListener\]\[perf\].*authenticateConnection failed after/,
];

type ConsoleErrorFn = typeof console.error;

interface GuardedConsoleError extends ConsoleErrorFn {
  __fotosCommServerGuard__?: true;
}

interface ConsoleWithErrorOriginal extends Console {
  _errorOriginal?: (...args: unknown[]) => void;
}

function formatConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }

  if (typeof arg === 'undefined') {
    return 'undefined';
  }

  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function isNonFatalCommServerError(args: unknown[]): boolean {
  const message = args.map(formatConsoleArg).join(' ');
  return COMM_SERVER_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function installCommServerGuard(): void {
  if (!__DEV__) {
    return;
  }

  LogBox.ignoreLogs(COMM_SERVER_LOGBOX_PATTERNS);

  const currentConsoleError = console.error as GuardedConsoleError;
  if (currentConsoleError.__fotosCommServerGuard__) {
    return;
  }

  const nextConsoleError = console.error.bind(console);
  const consoleWithErrorOriginal = console as ConsoleWithErrorOriginal;
  const passthroughConsoleError = typeof consoleWithErrorOriginal._errorOriginal === 'function'
    ? consoleWithErrorOriginal._errorOriginal.bind(console)
    : console.log.bind(console);

  const guardedConsoleError = ((...args: unknown[]) => {
    if (isNonFatalCommServerError(args)) {
      passthroughConsoleError(...args);
      return;
    }

    nextConsoleError(...args);
  }) as GuardedConsoleError;

  guardedConsoleError.__fotosCommServerGuard__ = true;
  console.error = guardedConsoleError;
}
