# Custom Rate Limiter in Express

A rate limiter will cap the amount of API requests to minimize resource usage and potentially block abusers utilizing said APIs. 

More precisely, it is system built to control the number of requests a user (IP address or service) can make to an application within a specific time interval. 
I have decided to build a custom one to fully dive deep into the topic and understand the concept to its core. As well as implement it into my existing ongoing projects. 

For both my own benefit, and anyone else following along, I will explain the thought process and requirements needed to build this.


## Core Rate Limiting Algorithm

I will be using the sliding window counter approach. This is an implementation of the sliding window algorithm which is nice to see in application. 
It uses the current window's count and a weighted percentage of the previous window's count to estimate a total. This makes it a balanced an accurate algorithm to use, as well as memory efficient. 


## Key Components

A custom rate limiter needs four main components from what I understand.

`Identifier`: How do we recognize the requester? 

`Storage/State`: Where do we keep track of the request counts, timestamps, or tokens? 

`Logic Engine`: Executing the sliding window algorithm, checks storage, and either allows or denies the request.

`Response Handler`: What happens when a request is denied? 

To answer the first one, we can achieve this by simply using an IP address. However, some IPs are nonstatic, meaning they can change over time. This can lead to bugs right away. Instead we may use a combination of a UserID and IP. 

For storage, I will personally be using a single server, but add eventually allow horizontal scaling later to avoid overloading. A Map will work great for this for now. Later we can use Redis for multiple server instances.

A response handler will do exactly what it entails, handle the responses. In the case that the request is denied, the handler should respond with an HTTP `429 too many requests` status code. In addition, it should send a message regarding how long potentially to wait to try again for user experience.


## Request Flow

This part is to explain thoroughly how I want the custom rate limiter to work.

First, we figure out the identifier: grab user's IP address from the request.

Then, we fetch the current rate limit state for that identifier in storage (Map).

Next, apply the sliding window algorithm to calculate if the request is allowed based on current time and stored state. For example, if they have any hits left before reaching their limit?

If allowed, decrment the counter and update the timestamp in storage. Set an expiration on th storage key to clean up old data.

Finally, pass the request to the main application if allowed, or block and return a `429` response otherwise.

## Challenge: Remembering a Specific Client

A big problem with making a rate limiter is figuring out how do we reliably assign a client an identity? How do we keep track of that same user without registration info, login page, or some true identifier to know who this person is that needs a response to a request? 

A solution is using their `IPv6` address. We can block that particular IPv6 address from making a request if they reached their quota for the time frame we have set. Perfect!

Actually, not really. There is a problem with using the IPv6 address because of dynamic allocation. This means that a single customer's device might rotate through thousands of IPv6 addresses in just 24 hours. If we rate limit by the exact IPv6 address, a bad actor can easily write a bot to bypass the limiter by slightly changing the IP. Conversely, if we block the entire ISP's IPv6 block, we can accidentally block thousands of users that are not rate limited. 

The solution to this is setting up groups of IPv6 addresses into what's called "subnets" or "blocks" and rate limit the blck rather than the individual IP. 

### How do we actually remember the client, though?

The way is all through truncation and how IPv6 addresses are structured. 

An IPv6 address is made up of 128 bits. For example: `2001:0db8:85a3:0000:1111:2222:3333:4444`

The first half is the "Network Prefix." It is the local network assigned by the ISP.
The second half is the "Interface Identifier." This represents the specific device, could be a phone, laptop, or a bot on this network. 

*(A good thing to note is that most modern devices use privacy extensions to randomly generate that secondary half every time they connect to the internet to prevent tracking.)*

The rate limiter will have different "leniency" settings based on aggressive we want the rate limiter to be. A list of common settings are ` 64 | 60 | 56 | 50 | 48 | 32 `. For example, `64` is a more lenient setting and `32` is very aggressive. Now what does that mean in context of the IPv6? 

Well, it means how many digits we are going to use to generalize the IPv6. Using the `64` mask as an example, that means we will only look at the first 64 bits of the IPv6 string. In this case, that's the first half of the address, or what we know it as the network prefix. Doing this can allow us to avoid a bot from being able to change their IPv6 address by one digit or sometimes an entirely different one. Like this: 
- Request 1: (`2001:0db8:85a3:0000:1111:2222:3333:4444`)
- Request 2: (`2001:0db8:85a3:0000:1111:2222:3333:4447`)
- Request 3: (`2001:0db8:85a3:0000:aaaa:bbbb:cccc:dddd`) (completely different local interface identifier)

This is how we can avoid, somewhat sophisticated, bots trying to overcome our rate limiter. We intentionally ignore the interface identifier with the `64` block setting, so we only add to the hit count if we see `2001:0db8:85a3:0000` and not the entire address. Now it's understandable that `32` is very harsh because it sees only 32 bits of the address or `2001:0db8`. This is why it can potentially block innocent users that did not need to be rate limited. The default setting we will use in the rate limiter will be the `56` bits. 





