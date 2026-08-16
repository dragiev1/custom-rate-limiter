// Testing validation.ts for strict configuration rules
import { it, beforeEach, afterEach, jest, describe, expect } from '@jest/globals'
import { getValidations, Validations } from '../../src/validations'
import { Logger } from '../../src/types'

describe('validation tests', () => {
    let validations: Validations
    let logger: Logger
    
    beforeEach(() => {
        logger = {
            warn: jest.fn(),
            error: jest.fn()
        }

        validations = getValidations(true, logger)
    })
    
    describe('ip', () => {
        it('should allow a valid IPv4', () => {
            validations.ip('1.2.2.1')
            expect(logger.error).not.toHaveBeenCalled()
        })

        it('should log an error for an invalid IP', () => {
            validations.ip('1.2.3')
            expect(logger.error).toHaveBeenCalled()

            validations.ip('grrr')
            expect(logger.error).toHaveBeenCalled()

            validations.ip('1.2.3.4.5')
            expect(logger.error).toHaveBeenCalled()
        })

        it('should allow a valid IPv6', () => {
            validations.ip('1200:0000:AB00:1234:0000:2552:7777:1111')
            expect(logger.error).not.toHaveBeenCalled()
        })

        it('should log an error for an undefined IP', () => {
            validations.ip(undefined)
            expect(logger.error).toHaveBeenCalled()
        })

        it('should log an error for an IPv6 with a port', () => {
            validations.ip('[1200:0000:AB00:1234:0000:2552:7777:1313]:1234')
            expect(logger.error).toHaveBeenCalled()
        })

        it('should log an error for an IPv4 with a port', () => {
            validations.ip('1.2.3.4:1234')
            expect(logger.error).toHaveBeenCalled()
        })
    })


})