import type { ClientRateLimitInfo, Options, Store } from "./types";


type Client = {
  totalHits: number
  resetTime: Date
}

//  Stores the hit count for each client in memory
export class MemoryStore implements Store {  
  windowMs!: number  // Time before all counts are reset (milliseconds)

  previous = new Map<string, Client>()
  current = new Map<string, Client>()

  interval?: NodeJS.Timeout  // Reference to current timer

  localKeys?: true  // IP addresses are accessible locally

  // Initialization of the MemoryStore
  init(options: Options): void {
    this.windowMs = options.windowMs

    if(this.interval) 
      clearInterval(this.interval)

    // Resets all clients left in previous window
    this.interval = setInterval(() => {
      this.clearExpired();
    }, this.windowMs);

    // dereference the current interval for convienence when shutting down
    this.interval.unref?.()
  }

  //  Interface method implementations
  //  We return Promises to allow users to use this with external databases

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    return this.current.get(key) ?? this.previous.get(key)
  }

  //  Also responsible for creating new key value pairs if client is new
  async inc(key: string): Promise<ClientRateLimitInfo> {
    const client = this.getClient(key)
    const now = Date.now()
  
    if(client.resetTime.getTime() <= now)    
      this.resetClient(client, now)

    client.totalHits++
    return client
  }

  async dec(key: string): Promise<void> {
    const client = this.getClient(key)

    if(client.totalHits > 0) client.totalHits--
  }

  async resetKey(key: string): Promise<void> {
    this.current.delete(key)
    this.previous.delete(key)
  }

  async resetAll(): Promise<void> {
    this.current.clear()
    this.previous.clear()
  }

  // Stops timer (if running) and prevents memory leaks
  shutdown(): void {
    clearInterval(this.interval)
    void this.resetAll()  // returns nothing and clears all clients and addresses, avoids floating promise warning
  }


  // Private helper methods

  // Returns client given a key
  private getClient(key: string): Client {
    // If client exists for incoming key, return it
    if(this.current.has(key)) return this.current.get(key)!  // Will never be null

    let client
    if(this.previous.has(key)) {
      client = this.previous.get(key)!
      this.previous.delete(key)
    } else {
      // If no client exists, create a new one
      client = { totalHits: 0, resetTime: new Date() }
      this.resetClient(client)
    }

    // Move client to current map and return it
    this.current.set(key, client)
    return client
  }

  // Fully resets a client
  private resetClient(client: Client, now = Date.now()): Client {
    client.totalHits = 0
    client.resetTime.setTime(now + this.windowMs)

    return client
  }

  // Move current client to previous and create a new map for current
  private clearExpired(): void {
    this.previous = this.current
    this.current = new Map()
  }
}