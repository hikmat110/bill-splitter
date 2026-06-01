export class CallbackParseError extends Error {
  constructor(data: string) {
    super(`Invalid callback data: "${data}"`)
    this.name = 'CallbackParseError'
  }
}

export function encode(entity: string, action: string, id: string): string {
  const data = `${entity}:${action}:${id}`
  if (Buffer.byteLength(data, 'utf8') > 64) {
    throw new Error(`Callback data exceeds 64 bytes: "${data}"`)
  }
  return data
}

export function decode(data: string): { entity: string; action: string; id: string } {
  const parts = data.split(':')
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new CallbackParseError(data)
  }
  // id may contain colons in future; join remainder
  const [entity, action, ...rest] = parts
  return { entity: entity!, action: action!, id: rest.join(':') }
}
