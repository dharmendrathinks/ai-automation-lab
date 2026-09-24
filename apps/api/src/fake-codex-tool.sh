#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\n' 'codex-cli 0.155.0'; exit 0; fi
printf '%s\n' '{"type":"thread.started","thread_id":"synthetic"}'
printf '%s\n' '{"type":"turn.started"}'
printf '%s\n' '{"type":"item.started","item":{"type":"command_execution","command":"forbidden"}}'
