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

    describe('trustProxy', () => {
        it('should log an error on "trust proxy" set to true', () => {
            validations.trustProxy({app: {get: () => true}} as any)  // Mock object that returns get true function to turn on trustProxy
            expect(logger.error).toHaveBeenCalled()  // Should error because trustProxy is bad, read commments in src/validations.ts for more information
        })

        it.each([
            false,
            '1.2.3.4',
            /1.2.3.4/,
            ['1.2.3.4'],
        ])('should not log an error on "trust proxy" = %s', (val) => {
            validations.trustProxy({ app: {get: () => val }} as any)
            expect(logger.error).not.toHaveBeenCalled()
        })
    })

    describe('xForwardedFor', () => {
        it.each([
            [{'x-forwarded-for': '1.2.3.4'}, true],
            [{}, false],
            [{}, true],
        ])('should log an error with x-forwarded-for header and "trust proxy" is %s', (headers, trustProxy) => {
            validations.xForwardedForHeader({
                app: { get: () => trustProxy},
                headers,
            } as any)
            expect(logger.error).not.toHaveBeenCalled()
        })

        it('should log an error with x-forwarded-for header and "trust proxy" is false', () => {
            validations.xForwardedForHeader({
                app: { get: () => false },
                headers: { 'x-forwarded-for': '1.2.3.4'},
            } as any)
            expect(logger.error).toHaveBeenCalled()
        })
    })

    
})