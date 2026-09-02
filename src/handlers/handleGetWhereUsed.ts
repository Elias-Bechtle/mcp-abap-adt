import convert from 'xml-js';

import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_text, type ToolResult } from '../lib/result.js';

export type UsageObjectType = 'program' | 'class' | 'interface' | 'table' | 'cds_view';

/** The object's own ADT URI, not its /source/main - usageReferences addresses the repository object itself. */
const OBJECT_URI: Record<UsageObjectType, (name: string) => string> = {
  program: (name) => `/sap/bc/adt/programs/programs/${encodeURIComponent(name)}`,
  class: (name) => `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}`,
  interface: (name) => `/sap/bc/adt/oo/interfaces/${encodeURIComponent(name)}`,
  table: (name) => `/sap/bc/adt/ddic/tables/${encodeURIComponent(name)}`,
  cds_view: (name) => `/sap/bc/adt/ddic/ddl/sources/${encodeURIComponent(name.toUpperCase())}`,
};

/** xml-js compact mode collapses a single child to an object rather than an array. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(node: any, ...names: string[]): string {
  const attrs = node?._attributes ?? {};
  for (const name of names) {
    if (typeof attrs[name] === 'string') return attrs[name];
  }
  return '';
}

interface UsageReference {
  uri: string;
  usageInformation: string;
  type: string;
  name: string;
  description: string;
  packageName: string;
}

/**
 * Returns undefined only when the expected root is missing entirely - an
 * unfamiliar response shape, not a real "nothing uses this object" answer.
 * Mirrors compactDataPreview's fallback: an unrecognised variant should cost
 * the caller detail, not the whole answer.
 */
function parseUsageReferences(xml: string): UsageReference[] | undefined {
  let parsed: any;
  try {
    parsed = convert.xml2js(xml, { compact: true });
  } catch {
    return undefined;
  }

  const result = parsed?.['usageReferences:usageReferenceResult'];
  if (!result) return undefined;

  const nodes = asArray(result['usageReferences:referencedObjects']?.['usageReferences:referencedObject']);
  return nodes.map((node: any) => {
    const adtObject = node?.['usageReferences:adtObject'];
    const packageRef = adtObject?.['adtcore:packageRef'];
    return {
      uri: attr(node, 'uri', 'usageReferences:uri', 'adtcore:uri'),
      usageInformation: attr(node, 'usageInformation', 'usageReferences:usageInformation'),
      type: attr(adtObject, 'adtcore:type'),
      name: attr(adtObject, 'adtcore:name'),
      description: attr(adtObject, 'adtcore:description'),
      packageName: attr(packageRef, 'adtcore:name'),
    };
  });
}

function formatUsageReferences(references: UsageReference[]): string {
  if (references.length === 0) return 'No usages found.';
  return references
    .map((r) => {
      const location = r.packageName ? `${r.name} (${r.packageName})` : r.name;
      const info = r.usageInformation ? ` [${r.usageInformation}]` : '';
      return `${r.type || '?'} ${location}${info}: ${r.uri}`;
    })
    .join('\n');
}

/**
 * The ADT "where-used list", the same one Eclipse's Ctrl+Shift+H runs. Purely
 * a lookup against SAP's usage-reference index; the request body is fixed and
 * carries no content of its own, only the target `uri` as a query parameter.
 */
export async function handleGetWhereUsed(
  connection: SapConnection,
  args: { object_type: UsageObjectType; object_name: string },
): Promise<ToolResult> {
  try {
    const uri = OBJECT_URI[args.object_type](args.object_name);
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<usagereferences:usageReferenceRequest xmlns:usagereferences="http://www.sap.com/adt/ris/usageReferences">
  <usagereferences:affectedObjects/>
</usagereferences:usageReferenceRequest>`;

    const response = await connection.request('/sap/bc/adt/repository/informationsystem/usageReferences', {
      method: 'POST',
      query: { uri },
      body,
      headers: { 'Content-Type': 'application/*', Accept: 'application/*' },
    });

    const references = parseUsageReferences(response.data);
    return return_text(references ? formatUsageReferences(references) : response.data);
  } catch (error) {
    return return_error(error);
  }
}
