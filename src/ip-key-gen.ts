import { isIPv6 } from "node:net"
import { Address6 } from "ip-address"

// Extract only the last 32 bits of the address if it is an embedded IPv4 inside an IPv6
const ipv4CompatiableSubnet = new Address6("::/96")

/**
 * Returns IPv6/4 as a key to store for identification
 * @param ip IP address
 *
 * @param ipv6Subnet Subnet mask for IPv6 address
 * @returns {string}  generated key from IP address
 */
export function ipKeyGen(ip: string, ipv6Subnet: number | false = 56) {
  if (isIPv6(ip)) {
    const address = new Address6(ip)

    /**
     * IPv6 can have an embedded IPv4 address in it, so check if that's true.
     * `isInSubnet()` checks if a specific IP address fals inside a specific range of IP addresses (subnet).
     * In simpler terms, it checks if the first 96 bits are zeros, if so return true (its an IPv4).
     * If so, we can recorrect the address to IPv4 and proceed. 
     */
    if (
      address.isMapped4() ||
      (address.is4() && address.isInSubnet(ipv4CompatiableSubnet))  
    )
      return address.to4().correctForm()

    if (ipv6Subnet) {
      const subnet = new Address6(`${ip}/${ipv6Subnet}`)
      return subnet.networkForm()
    }
  }

  // Return IPv4 itself
  return ip
}
