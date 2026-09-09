# SMTP ingress.
#
# This is the one component that cannot run on Workers: `connect()` is
# egress-only and there is no inbound TCP listener, so `smtp.<domain>:587` needs
# a real socket stack. It is a plain OCI image — run it on Cloudflare
# Containers behind Spectrum, on the same box as a Node deployment, or anywhere
# else that can hold a port open.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Submission port. 25 is deliberately not exposed: this relays authenticated
# submissions into the API, it is not an MX.
EXPOSE 587
USER node
CMD ["node", "src/index.js"]
