import { isIPv6 } from 'node:net'
import { Address6 } from 'ip-address'

/**
 * Returns IPv6/4 as a key to store for identification
 * @param ip IP address
 * 
 * @param ipv6Subnet Subnet mask for IPv6 address 
 * @returns {string}  generated key from IP address
 */
export function ipKeyGen(ip: string, ipv6Subnet: number | false = 56) {
  if(isIPv6(ip)) {
    const address = new Address6(ip)

    if(address.is4()) return address.to4().correctForm()

    if(ipv6Subnet) {
      const subnet = new Address6(`${ip}/${ipv6Subnet}`)
      return subnet.networkForm()
    }
  }

  // return ipv4 itself
  return ip
}