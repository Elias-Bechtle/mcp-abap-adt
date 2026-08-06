import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createInlineProvider } from '../../src/auth/providers/inline.js';
import { ConnectionRegistry } from '../../src/connection/registry.js';
import { SystemConfigSchema, type ResolvedAppConfig, type SystemConfig } from '../../src/config/schema.js';
import { TOOL_DEFINITIONS, createServer } from '../../src/server.js';

function system(overrides: Partial<SystemConfig> = {}): SystemConfig {
  return SystemConfigSchema.parse({
    url: 'https://sap.example.com:44300',
    client: '100',
    username: 'DEVELOPER',
    password: 'secret',
    ...overrides,
  });
}

async function connectClient(config: Partial<ResolvedAppConfig> & { systems: Map<string, SystemConfig> }) {
  const resolved: ResolvedAppConfig = { errors: [], sources: [], ...config };
  const registry = new ConnectionRegistry(resolved, {
    providers: [createInlineProvider()],
    fetch: (async () => new Response('<abap>source</abap>', { status: 200 })) as unknown as typeof globalThis.fetch,
  });

  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), createServer(registry).connect(serverTransport)]);
  return client;
}

const singleSystem = { systems: new Map([['dev', system()]]), defaultSystem: 'dev' };

describe('tool surface', () => {
  it('exposes every ADT tool plus ListSystems', async () => {
    const client = await connectClient(singleSystem);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).toSorted();

    expect(names).toEqual([...TOOL_DEFINITIONS.map((tool) => tool.name), 'ListSystems'].toSorted());
    expect(tools).toHaveLength(17);
  });

  it('keeps the original tool names and required arguments', async () => {
    const client = await connectClient(singleSystem);

    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    expect(byName.GetProgram.inputSchema.required).toEqual(['program_name']);
    expect(byName.GetFunction.inputSchema.required).toEqual(['function_name', 'function_group']);
    // max_rows has a default, so it must not be required.
    expect(byName.GetTableContents.inputSchema.required).toEqual(['table_name']);
  });

  it('offers an optional system argument on every ADT tool', async () => {
    const client = await connectClient(singleSystem);

    const { tools } = await client.listTools();

    for (const tool of tools) {
      if (tool.name === 'ListSystems') continue;
      const properties = tool.inputSchema.properties as Record<string, unknown> | undefined;
      expect(properties, `${tool.name} has no properties`).toHaveProperty('system');
      expect(tool.inputSchema.required ?? []).not.toContain('system');
    }
  });
});

describe('tool calls', () => {
  it('routes a call to the default system', async () => {
    const client = await connectClient(singleSystem);

    const result = await client.callTool({
      name: 'GetProgram',
      arguments: { program_name: 'RSABAPPROGRAM' },
    });

    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: '<abap>source</abap>' }]);
  });

  it('reports an unknown system as a readable tool error', async () => {
    const client = await connectClient(singleSystem);

    const result = await client.callTool({
      name: 'GetProgram',
      arguments: { program_name: 'RSABAPPROGRAM', system: 'nope' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Unknown system "nope"');
    expect(text).toContain('Configured systems: dev');
  });

  it('rejects a missing required argument', async () => {
    const client = await connectClient(singleSystem);

    const result = await client.callTool({ name: 'GetProgram', arguments: {} });

    expect(result.isError).toBe(true);
  });
});

describe('ListSystems', () => {
  it('describes the systems without revealing credentials', async () => {
    const client = await connectClient({
      systems: new Map([
        ['dev', system({ password: 'top-secret' })],
        ['prd', system({ url: 'https://prd.example.com', password: 'other-secret' })],
      ]),
      defaultSystem: 'dev',
    });

    const result = await client.callTool({ name: 'ListSystems', arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const payload = JSON.parse(text) as {
      defaultSystem: string;
      systems: Array<{ name: string; isDefault: boolean; credentialSource: string }>;
    };

    expect(payload.defaultSystem).toBe('dev');
    expect(payload.systems.map((entry) => entry.name)).toEqual(['dev', 'prd']);
    expect(payload.systems[0]).toMatchObject({ isDefault: true, credentialSource: 'inline' });
    expect(text).not.toContain('top-secret');
    expect(text).not.toContain('DEVELOPER');
  });

  it('still answers when the configuration is broken', async () => {
    const client = await connectClient({
      systems: new Map(),
      errors: [{ scope: 'global', message: 'No SAP system is configured.' }],
    });

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(17);

    const result = await client.callTool({ name: 'ListSystems', arguments: {} });
    expect((result.content as Array<{ text: string }>)[0].text).toContain('No SAP system is configured.');
  });
});
