export type AppErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'rate_limited'

const STATUS: Record<AppErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  rate_limited: 429,
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly status: number

  constructor(code: AppErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS[code]
  }
}

export const unauthenticated = (message = 'You need to sign in.') =>
  new AppError('unauthenticated', message)

export const forbidden = (message = 'You do not have access to that.') =>
  new AppError('forbidden', message)

export const notFound = (message = 'That record does not exist.') =>
  new AppError('not_found', message)

export const invalid = (message: string) => new AppError('invalid', message)

export const conflict = (message: string) => new AppError('conflict', message)
