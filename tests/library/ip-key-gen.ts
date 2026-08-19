import { describe, expect, it } from "@jest/globals";
import { ipKeyGen } from "../../src/ip-key-gen";

describe('ipKeyGenerator', () => {
    it('should return an IPv4 address untouched', () => {
        expect(ipKeyGen('1.2.3.4')).toBe('1.2.3.4')
        expect(ipKeyGen('1.2.3.4', 16)).toBe('1.2.3.4')  // With subnet, shouldn't matter/change the address
    })

    // Essentially, two IPs can be the same, so they must produce the same key regardless, this tests that requirement
    // Read NOTES.md/IPv4 vs IPv6 for more information
    it('should return an IPv4 mapped to IPv6 as an IPv4 address regardless of notation', () => {
        expect(ipKeyGen('::ffff:102:304')).toBe('1.2.3.4')
        expect(ipKeyGen('::ffff:102:304', 16)).toBe('1.2.3.4')
        expect(ipKeyGen('::ffff:102:304', false)).toBe('1.2.3.4')
        expect(ipKeyGen('::ffff:102:304')).toBe(
            ipKeyGen('::ffff:1.2.3.4')
        )
    })
})