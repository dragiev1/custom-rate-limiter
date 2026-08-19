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

    it('should apply IPv6 subnet to an IPv6 address that merely ends in dotted-quad notation', () => {
        // Ordinary IPv6
        expect(ipKeyGen('2001:db8:1234:5678::1.2.3.4')).toBe(
            '2001:db8:1234:5600::/56'
        )
        expect(ipKeyGen('64:ff9b::1.2.3.4')).toBe('64:ff9b::/56')
        // IPv6 subnet mask test
        expect(ipKeyGen('2001:db8:1234:5678::1.2.3.4')).toBe(
            ipKeyGen('2001:db8:1234:5678::102:304')
        )
        // IPv6 does not equal to IPv4, checks potential over-normalization bugs
        expect(ipKeyGen('2001:db8:1234:5678::1.2.3.4')).not.toBe(
            ipKeyGen('1.2.3.4')
        )
    })

    it('should apply the IPv6 subnet mask to normal short-form IPv6 addresses', () => {
        expect(ipKeyGen('::1')).toBe('::/56')
        expect(ipKeyGen('::')).toBe('::/56')
    })

    it('should return an IPv6 address unchanged with `ipv6Subnet` false', () => {
        expect(ipKeyGen('2001:db8:1234:5678::1.2.3.4', false)).toBe(
            '2001:db8:1234:5678::1.2.3.4'
        )
    })

    it('should apply a default /56 mask to an incoming IPv6 address', () => {
        expect(ipKeyGen('2001:db8:1234:5678::1.2.3.4')).toBe('2001:db8:1234:5600::/56')
        expect(ipKeyGen('::1.2.3.4', 16)).toBe('1.2.3.4')
        expect(ipKeyGen('::ffff:1.2.3.4', 16)).toBe('1.2.3.4')
        expect(ipKeyGen('::1.2.3.4', false)).toBe('1.2.3.4')
    })

    it('should apply a /63 mask to an IPv6 address', () => {
        expect(ipKeyGen('2001:db8:1234:5678::1.2.3.4', 63)).toBe('2001:db8:1234:5678::/63')
    })

    it('should accept abbreviated IPv6 addresses', () => {
        expect(ipKeyGen('123:ABC::89')).toBe('123:abc::/56')
    })

    it('should return an IPv6 address normalized but otherwise unchanged with a /128 mask', () => {
        expect(ipKeyGen('0123:4567:89ab:cdef:0123:4567:89ab:cdef', 128)).toBe('123:4567:89ab:cdef:123:4567:89ab:cdef/128')
    })
})