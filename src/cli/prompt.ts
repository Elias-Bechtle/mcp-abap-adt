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

export async function promptYesNo(question: string): Promise<boolean> {
  const answer = await promptLine(`${question} [y/N] `);
  return /^y(es)?$/i.test(answer);
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
