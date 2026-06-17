import { isIPv6 } from 'node:net'
import { Address6 } from 'ip-address'


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