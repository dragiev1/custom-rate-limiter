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



## Core Logic

Fully stripped from boilerplate, the main logic of the rate limiter goes like this: 

**1. Should we skip?**

  Sometimes we would want to skip a client's hit given special context. For instance, if a backend error messes up and causes the client to fire another request without them knowing, they are going to potentially get penalized for nothing. Thus, we should see first if we should ignore this hit or not.

**2. Get the key**

  This will be the IPv6/4 address that is generated from our custom key generator using the subnet mask like we discussed earlier.

**3. Increment the hits**

**4. Check limit**

  The crux of the package, checking if a client has reached their limit of request or not within a time interval. 

**5. Block or allow**

Lastly, allow the client to make the request or block them and send a `429: too many requests` message. 



## Headers

When a server responds to an HTTP request, it sends back a status code. For example, `200` for OK or `429 too many requests` and a set of HTTP headers. Pretty much metadata about the response. 

Rate limit headers are specific metadata fields, however, that tell the client exactly what their current rate limit status is. If an API does not send a rate limit header, the client can be blind as to how many shots they have left. 

Another reason headers are necessary is to prevent the "Thundering Herd" scenario. This scenario, in layman's terms, is when a client gets a `429` error, they do not know when the limit resets. 1 hour? 1 day? Who knows? Headers will solve this problem against normal users and they will stop spamming the "reload" or "retry" button a million times and cramping up our servers with unnecessary requests to block.

Since headers are so useful, they became a widely accepted standard. Otherwise known as an `IETF Draft`. With them implemented, developers will be able to integrate their projects with this rate limiter without necessarily reading the documentation. 

The standard headers for rate limiting are three main ones sent on every response, whether or not it is a `200 OK`, `429 too many requests`, or one when they are blocked.

1. `RateLimit-Limit: The request limit the client is allowed to make in the current window. 
2. `RateLimit-Remaining: Number of requests left in current window.
3. `RateLimit-Reset: Amount of time until the rate limit resets and their counter goes to 0. 
4. `Retry-After`: Sent only when user has already hit their limit with a `429` status code. Explains how many seconds they have to wait until making another request. 

This is how the rate limiter is useful in the eyes of the user without silently banishing them into the shadow realm of rate limited disorient. 

### Drafts

Briefly, a draft (`IETF Draft`) is when the IETF realizes the internet has a new problem that needs a standard solution. The problem was many big tech companies would use different headers for their rate limiters, so using API monitoring tools like Postman became nearly impossible to detect rate limits because they did not know which header to look for.

IETF decided that the solution to this problem would be to set standard headers that would be used universally. It was officially called `draft-ietf-httpapi-ratelimit-headers` (the `RateLimit-X` format). 

If we want this rate limiter to be widely used pubically, we should implement support for these. 

*Note: There exists legacy headers which take the form: `X-RateLimit-Y`. Providing support for these would be good for older systems that follow the old header formatting.*



## Validation

Final steps to the rate limiter are creating validation methods that validate and error-handle for the library. It primarily acts as a crosschecker to catch bugs or security flaws by checking the developer's configuration of the limiter, the environment, and possibly runtime behavior. 

The architecture for understanding the validation phase of the limiter, we need a couple objects that hold data in the current state of the program. 

* `validations`: this object contains all the individual checks, basically if the IP is valid or not, or "Is the trust proxy set correctly?"
* Global State: variables (like `userStores`) track information across the lifecycle of the app to prevent logical errors. 
* `getValidations`: a function that wraps all the rules together so that they can be activated, or deactivated, and log errors instead of crashing the server. 

It is important that we do not cause the entire program to crash due to the rate limiter alone, as that would be a massive detriment to the developers that want to use it. 

`userStores` specifically creates a set data structure to track every Store instance that has been passed to a rate limiter. This makes sure that a developer does not accidentally share the exact same store instance across various rate limiters, which would obviously cause bugs. 

`singleCountKeys` maps an Express `Request` to the keys that have been counted. Using a WeakMap because it used the `Request` object as the key, so when the request finishes and it is garbage collected by Node.js, the memory is automatically freed. This overall prevents memory leaks by ensuring that a single HTTP requets does not accidentally increment the rate limiter `hitCount` twice. 

### Network Checks

There are some network checks we must validate in order for our rate limiter to be safely utilized in a developer environment. One of which would be properly validating IP addresses; simple enough. But one thing that is most important to check is the `trust proxy` attribute in the request object. 

The reason `trust proxy` must not be `true` is because this essentially allows clients to bypass the rate limiter altogether. Not ideal, so we must check that it is set to false by calling `app` from the Express request object and then use the `get` method to grab the `trust proxy` attribute for validation. 
