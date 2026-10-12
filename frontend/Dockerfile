FROM node:22-alpine AS base
WORKDIR /app

# ---- development: next dev with bind-mounted source ----------------------------------------------
FROM base AS dev
ARG BACKEND_INTERNAL_URL=http://backend:8000
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- build ---------------------------------------------------------------------------------------
FROM base AS builder
ARG BACKEND_INTERNAL_URL=http://backend:8000
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ---- production runtime: minimal standalone server ---------------------------------------------
FROM base AS prod
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
