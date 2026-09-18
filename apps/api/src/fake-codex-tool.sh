#!/bin/sh
printf '%s\n' '{"type":"thread.started","thread_id":"synthetic"}'
printf '%s\n' '{"type":"turn.started"}'
printf '%s\n' '{"type":"item.started","item":{"type":"command_execution","command":"forbidden"}}'
