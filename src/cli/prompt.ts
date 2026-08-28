import { createInterface } from 'node:readline/promises';

// Compared as char codes so no control characters appear in this source file.
const ENTER_CODES = new Set([13, 10]);
const BACKSPACE_CODES = new Set([8, 127]);
const CTRL_C_CODE = 3;

/** Reads a visible line of input. */
export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Exported for tests; the terminal handling stays in promptYesNo. */
export function interpretYesNo(answer: string, defaultYes: boolean): boolean {
  if (answer.trim() === '') return defaultYes;
  return /^y(es)?$/i.test(answer.trim());
}

/**
 * The default expresses where the reader stands: "no" protects an action they
 * have not asked for yet (overwriting an entry another tool may own), "yes"
 * ratifies one they have already worked towards (a summary they read and a
 * password they typed).
 */
export async function promptYesNo(question: string, defaultYes = false): Promise<boolean> {
  const answer = await promptLine(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `);
  return interpretYesNo(answer, defaultYes);
}

/**
 * Reads a secret without echoing it. Falls back to a plain read when stdin is
 * not a terminal, which is what makes `echo secret | mcp-abap-adt ...` work.
 */
export async function promptSecret(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return promptLine(question);
  }

  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise<string>((resolve, reject) => {
    let value = '';

    const finish = (settle: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
      settle();
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        const code = char.charCodeAt(0);
        if (ENTER_CODES.has(code)) {
          finish(() => resolve(value));
          return;
        }
        if (code === CTRL_C_CODE) {
          finish(() => reject(new Error('Aborted.')));
          return;
        }
        if (BACKSPACE_CODES.has(code)) {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on('data', onData);
  });
}
