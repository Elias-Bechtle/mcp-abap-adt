import convert from 'xml-js';

import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_text, type ToolResult } from '../lib/result.js';

export async function handleGetPackage(connection: SapConnection, args: { package_name: string }): Promise<ToolResult> {
  try {
    const response = await connection.request('/sap/bc/adt/repository/nodestructure', {
      method: 'POST',
      query: {
        parent_type: 'DEVC/K',
        parent_name: args.package_name,
        withShortDescriptions: true,
      },
    });

    // xml2js is typed as Element | ElementCompact; the compact form is a plain
    // object tree that only makes sense to index dynamically.
    const result = convert.xml2js(response.data, { compact: true }) as any;

    const nodes = result['asx:abap']?.['asx:values']?.DATA?.TREE_CONTENT?.SEU_ADT_REPOSITORY_OBJ_NODE ?? [];
    const extractedData = (Array.isArray(nodes) ? nodes : [nodes])
      .filter((node: any) => node.OBJECT_NAME?._text && node.OBJECT_URI?._text)
      .map((node: any) => ({
        OBJECT_TYPE: node.OBJECT_TYPE._text,
        OBJECT_NAME: node.OBJECT_NAME._text,
        OBJECT_DESCRIPTION: node.DESCRIPTION?._text,
        OBJECT_URI: node.OBJECT_URI._text,
      }));

    return return_text(JSON.stringify(extractedData));
  } catch (error) {
    return return_error(error);
  }
}
