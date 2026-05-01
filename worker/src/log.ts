type Level = 'info' | 'warn' | 'error'

type Fields = Record<string, unknown>

function emit(level: Level, msg: string, fields?: Fields): void {
  const entry = { level, msg, time: new Date().toISOString(), ...fields }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
}

export function errorFields(err: unknown): Fields {
  if (err instanceof Error) {
    return { err: err.message, stack: err.stack, name: err.name }
  }
  return { err: String(err) }
}
