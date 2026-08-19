import { afterEach, beforeEach, describe, it, jest, expect } from "@jest/globals";
import { ConsoleLogger } from '../../src/console-logger'


describe('logger tests', () => {
    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('error', () => {
        const error = new Error('mock error')

        it('forwards the call to the console', () => {
            ConsoleLogger.error(error)
            expect(console.error).toHaveBeenCalledWith(error)
        })

        it('logs the message first if provided', () => {
            ConsoleLogger.error(error, 'An error occurred')
            expect(console.error).toHaveBeenCalledWith('An error occurred', error)
        })
    })

    describe('warn', () => {
        const error = new Error('mock error')

        it('fowards the call to the console', () => {
            ConsoleLogger.warn(error)
            expect(console.warn).toHaveBeenCalledWith(error)
        })

        it('logs the message first if provided', () => {
            ConsoleLogger.warn(error, 'An error occured')
            expect(console.warn).toHaveBeenCalledWith('An error occured', error)
        })
    })
})