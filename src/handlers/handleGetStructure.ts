import { McpError, ErrorCode, AxiosResponse } from '../lib/utils.js';
import { makeAdtRequest, return_error, return_response, getBaseUrl } from '../lib/utils.js';

export async function handleGetStructure(args: any) {
    try {
        if (!args?.structure_name) {
            throw new McpError(ErrorCode.InvalidParams, 'Structure name is required');
        }
        const encodedStructureName = encodeURIComponent(args.structure_name);
        const url = `${await getBaseUrl()}/sap/bc/adt/ddic/structures/${encodedStructureName}/source/main`;
        const response = await makeAdtRequest(url, 'GET', 30000);
        return return_response(response);
    } catch (error) {
        return return_error(error);
    }
}
