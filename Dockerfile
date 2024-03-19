FROM oven/bun:1 as base
WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY . .
RUN bun install

EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "index.ts" ]