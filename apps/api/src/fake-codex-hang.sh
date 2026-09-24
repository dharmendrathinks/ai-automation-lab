#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\n' 'codex-cli 0.155.0'; exit 0; fi
trap '' TERM
sleep 300 &
wait
