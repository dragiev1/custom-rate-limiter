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



## Validations

Final steps to the rate limiter are creating validation methods that validate and error-handle for the library. It primarily acts as a crosschecker to catch bugs or security flaws by checking the developer's configuration of the limiter, the environment, and possibly runtime behavior. 

The architecture for understanding the validation phase of the limiter, we need a couple objects that hold data in the current state of the program. 

* `validations`: this object contains all the individual checks, basically if the IP is valid or not, or "Is the trust proxy set correctly?"
* Global State: variables (like `userStores`) track information across the lifecycle of the app to prevent logical errors. 
* `getValidations`: a function that wraps all the rules together so that they can be activated, or deactivated, and log errors instead of crashing the server. 

It is important that we do not cause the entire program to crash due to the rate limiter alone, as that would be a massive detriment to the developers that want to use it. 

`userStores` specifically creates a set data structure to track every Store instance that has been passed to a rate limiter. This makes sure that a developer does not accidentally share the exact same store instance across various rate limiters, which would obviously cause bugs. 

Since it is very easy to accidentally apply middleware twice to the same route by applying it globally on the `app`, and then again on a specific router for instance. So we create the `singleCountKeys` data structure which maps an Express `Request` to the keys that have been counted. For this specific HTTP request, we keep a list of keys we have already  counted. If we try to count it again, we want to throw an error! But if we store these request objects as keys in a standard `Map`, they will be there forever as even after the response is finished, so their data is still there taking up precious space. Utilizing a WeakMap makes sense here because when the `Request` object is the key, and the request finishes, it is gone when garbage collected by Node.js. The memory is automatically freed in this case. `singleCountKeys` overall prevents memory leaks and the validation logic ensures that a single HTTP request does not accidentally increment the rate limiter `hitCount` twice. 

`const singleCountKeys = new WeakMap<Request, Map<Store | string, string[]>>()`

The value `Map<Store | string, string[]>` is inside of `singleCountKeys` because we want to map a request to a standard map tracking the Store objects, and then the keys. Why? Because we want it so that way if a developer wants to use mutiple rate limiters in their project, we can safely account for each store for each request and increment as the developer intended. For instance, if we have a global limit of 100 requests per user, and a second specific limiter for only 5 login attempts. In this scenario, only the global limiter will increment and the login limiter will not; clearly resulting in an annoying bug.   


### Network Checks

There are some network checks we must validate in order for our rate limiter to be safely utilized in a developer environment. One of which would be properly validating IP addresses as real IP addresses; simple enough. But a few things that are most important to check is with the `trust proxy` attribute in the express `req` object. 

The `trust proxy` setting must not be `true` because this essentially allows clients to bypass the rate limiter altogether. Not ideal, as a hacker can spam various fake headers that store user IP addresses, all while using their real IP as the TCP IP, rendering our rate-limiter useless. 

`trust proxy` must also not be `false` as this programmitally reads the express `req.ip` attribute as the TCP IP, when in reality we want the user's IP. This can rate-limit everyone in the worst case scenario!  

So the solution to this is: 
* `trust proxy = our trusted machine's TCP network IP`, not a generic boolean value. This allows us to only trust one proxy and if requests come from a random proxy, we ignore it and rate limit that proxy instead of the fake headers inside of it. Thus, we can safely rate limit **real** users and not fake ones spoofed by hackers.  



## Testing

Testing is absolutely a must when developing a rate limiter. There are many requirements we need to check off to ensure this package will do what it is intended to do. 

A loaded question I had when learning about developing a rate limiter is: **what do we even check and how?**

A few things I have learned that we need are: 

* A Test Server: a helper file that essentially spins up a minimal Express app and applies the rate limiter, plus a simple test route. 

* Be able to send HTTP requests to the app without needing a manual live server on a port.

* Create a Mock Store: a class that implements the Store interface but stores data in a simple in memory JavaScript object or `Map`, ensuring the tests do not depend on external database connections.

* Implement the fake timers to write tests that return various responses per request(s).

* Verify the headers after each request and assert that the response headers are as expected

* Lastly, error handling to deal with tests that pass invalid options or broken stores to the middleware and assert that it is throwing the appropriate error during initialization. 



### What tool do we use? 

At this point, we have a semi-advanced rate limiter! Although, one thing we want to do is test it, as we want to make sure it functions properly. But the question is: how? 

There are plenty of tools to use in the Node.js ecosystem, some examples being `Mocha`, `Vitest`, `Ava`, and `Jest`. Which one is best for our needs, however? 

Since our middleware revolves around a time interval, or "sliding window," which is a core component in our rate limiter, this tells us that we want to use a testing tool which has a built-in fake timer system. `Jest` has exactly that! 

Jest allows us to *freeze* time, make requests, and instantly fast-forward the clock to simulate the expiration of a window with its `useFakeTimers()` object. In addition, we do not want to connect this to a real database just for testing purposes. As in a production environment, the `Store` could be a Redis or PostgreSQL database. This would be unnecessarily complicated and resource intensive. A solution is to use Jest's built-in mocking system to create a `MockStore` class, in which implements the `Store` interface and using a simple JavaScript `Map` or object. On top of that, Jest has "spying" capabilities that allow us to spy on methods to verify their intentional or unintentional behaviors. 

It begins to be obvious why Jest is an industry standard for a standard testing framework. That is because it groups many nice tools (runner, assertions, spying, etc.) into one package. 

### Information+

To be specific, there are two types of tests we are making: **Integration** and **Unit** tests. 

For anyone that is unaware or heard of them and does not know what these types of tests are, I will explain them briefly. 

**Unit** tests, tests each module of a software separately and are responsible to observe only the functionality of these indiviudal *units*. These tests are performed first, as they involve the internal design of the software without external parts of the whole software; typically executed by the developer. 

**Integration** tests verify all of the modules of the software combined. Contrary to unit tests, integration tests do not know the internal design of the software, it assumes it is law and checks if our code is *integrated* with the external dependencies to create an overall working system. These tests are executed by the tester and is performed *after* unit testing is complete. 

Since integration tests do not know internal designs of interfaces, it is difficult to detect defects, hence why unit tests handle those types of verifications themselves. A common example of an external part is data integrity involving retrieving and storing data in a database, which is something that we will be doing!

