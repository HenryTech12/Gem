FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY test ./test
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Runs as root only so it can read LND's root-owned credential volumes (mounted read-only).
# In production: run as non-root with credentials provisioned via secrets.
CMD ["node", "src/server.js"]
