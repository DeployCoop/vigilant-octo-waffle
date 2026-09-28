# Multi-stage Dockerfile for Vigilant Octo Waffle Next.js Web Control Plane
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install system dependencies & CLIs needed for cluster management
RUN apt-get update && apt-get install -y \
    curl \
    git \
    bash \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install kubectl (pinned)
ARG KUBECTL_VERSION="v1.32.2"
RUN curl -LO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/

# Install kind (pinned)
ARG KIND_VERSION="v0.27.0"
RUN curl -Lo ./kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64" \
    && chmod +x ./kind \
    && mv ./kind /usr/local/bin/kind

# Install helm (pinned)
ARG HELM_VERSION="v3.17.1"
RUN curl -fsSL -o helm.tar.gz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
    && tar -zxvf helm.tar.gz \
    && mv linux-amd64/helm /usr/local/bin/helm \
    && chmod +x /usr/local/bin/helm \
    && rm -rf linux-amd64 helm.tar.gz

WORKDIR /app

FROM base AS builder
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app ./

EXPOSE 3000
CMD ["pnpm", "start"]
