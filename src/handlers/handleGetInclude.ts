import { McpError, ErrorCode, AxiosResponse } from '../lib/utils.js';
import { makeAdtRequest, return_error, return_response, getBaseUrl } from '../lib/utils.js';

export async function handleGetInclude(args: any) {
    try {
        if (!args?.include_name) {
            throw new McpError(ErrorCode.InvalidParams, 'Include name is required');
        }
        const encodedIncludeName = encodeURIComponent(args.include_name);
        const url = `${await getBaseUrl()}/sap/bc/adt/programs/includes/${encodedIncludeName}/source/main`;
        const response = await makeAdtRequest(url, 'GET', 30000);
        return return_response(response);
    } catch (error) {
        return return_error(error);
    }
}
