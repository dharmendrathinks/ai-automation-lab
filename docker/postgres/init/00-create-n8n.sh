#!/bin/sh
set -eu

case "$RELAYDESK_DB_PASSWORD" in
  *[!a-f0-9]*|'')
    echo "Application database passwords must be non-empty lowercase hexadecimal values" >&2
    exit 1
    ;;
esac
case "$N8N_DB_PASSWORD" in
  *[!a-f0-9]*|'')
    echo "Application database passwords must be non-empty lowercase hexadecimal values" >&2
    exit 1
    ;;
esac

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE relaydesk LOGIN PASSWORD '$RELAYDESK_DB_PASSWORD';
CREATE DATABASE relaydesk OWNER relaydesk;
CREATE ROLE n8n LOGIN PASSWORD '$N8N_DB_PASSWORD';
CREATE DATABASE n8n OWNER n8n;
SQL
