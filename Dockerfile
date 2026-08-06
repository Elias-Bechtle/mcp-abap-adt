# Build and run the mcp-abap-adt MCP server in a container.
# The server speaks MCP over stdio, so nothing is exposed on a port; run it
# with `docker run -i` and mount a config file if you use one:
#   docker run -i --rm \
#     -v ./mcp-abap-adt.config.jsonc:/app/mcp-abap-adt.config.jsonc \
#     mcp-abap-adt
# The OS keychain is not available inside a container, so configure
# credentials with passwordEnv or the SAP_* variables.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "./dist/index.js"]
