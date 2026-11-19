# All-in-one image for Render (or any single-container host): bitcoind (regtest) + 3 LND nodes
# (buyer, seller, rider) + Gëm, sharing one persistent disk at /data. Real LND, regtest coins.
# Build context: repository root.
FROM polarlightning/bitcoind:27.0 AS bitcoin
FROM lightninglabs/lnd:v0.18.3-beta AS lnd

FROM node:22-bookworm-slim
COPY --from=bitcoin /opt/bitcoin-27.0/bin/bitcoind /opt/bitcoin-27.0/bin/bitcoin-cli /usr/local/bin/
COPY --from=lnd /bin/lnd /bin/lncli /usr/local/bin/
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/src ./src
COPY backend/public ./public
COPY backend/test ./test
COPY render/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV NODE_ENV=production PORT=10000 DATA_DIR=/data
EXPOSE 10000
CMD ["/entrypoint.sh"]
