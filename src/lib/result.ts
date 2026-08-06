import { AdtHttpError } from '../connection/errors.js';

export interface ToolResult {
  isError: boolean;
  content: Array<{ type: 'text'; text: string }>;
}

export function return_text(text: string): ToolResult {
  return { isError: false, content: [{ type: 'text', text }] };
}

export function return_response(response: { data: string }): ToolResult {
  return return_text(response.data);
}

export function return_error(error: unknown): ToolResult {
  // ADT puts a readable explanation in the error body; prefer it over the
  // generic status line.
  const text =
    error instanceof AdtHttpError
      ? error.body || error.message
      : error instanceof Error
        ? error.message
        : String(error);

  return { isError: true, content: [{ type: 'text', text: `Error: ${text}` }] };
}
