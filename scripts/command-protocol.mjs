export function validateCommand(value) {
  if (!value || typeof value.command !== 'string' || !value.command.trim() || value.command.includes('\0')) {
    throw new Error('command must be a nonempty shell command without NUL characters');
  }
  if (!Number.isSafeInteger(value.timestamp) || value.timestamp <= 0) {
    throw new Error('timestamp must be a positive integer (Unix milliseconds)');
  }
  return { command: value.command, timestamp: value.timestamp };
}
