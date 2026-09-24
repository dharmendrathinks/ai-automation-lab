#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\n' 'codex-cli 0.155.0'; exit 0; fi
printf '%s\n' '{"type":"thread.started","thread_id":"synthetic"}'
printf '%s\n' '{"type":"turn.started"}'
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"{\"schemaVersion\":1,\"category\":\"billing\",\"intent\":\"invoice_download\",\"priority\":\"normal\",\"recommendedAction\":\"reply\",\"needsHumanReview\":false,\"ambiguity\":\"clear\",\"evidenceRefs\":[\"ticket.message\"],\"unresolvedIssues\":[],\"reason\":\"Synthetic provider test.\"}"}}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":5}}'
