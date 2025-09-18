FROM semtech/mu-javascript-template:1.8.0
LABEL maintainer="info@redpencil.io"

#ignore SecretsUsedInArgOrEnv, not sensitive data
ENV DEBUG_AUTH_HEADERS="false"
