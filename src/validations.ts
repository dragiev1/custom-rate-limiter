//  Validation functions for strict type checking
import { isIP } from "node:net";
import type { Request } from 'express'
import { SUPPORTED_DRAFT_VERSIONS } from "./headers";

class ValidationError extends Error {
  name: string
  code: string
  help: string

  constructor(code: string, message: string) {
    const url = `https:custom-rate-limiter.github.io/{code}/`
    super(`${message} `)
  }
}