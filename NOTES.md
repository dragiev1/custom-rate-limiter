# Custom Rate Limiter in Express

A rate limiter will cap the amount of API requests to minimize resource usage and potentially block abusers utilizing said APIs. 

More precisely, it is system built to control the number of requests a user (IP address or service) can make to an application within a specific time interval. 
I have decided to build a custom one to fully dive deep into the topic and understand the concept to its core. As well as implement it into my existing ongoing projects. 

For both my own benefit, and anyone else following along, I will explain the thought process and requirements needed to build this as well.


## Core Rate Limiting Algorithm

I will be using the fixed window counter approach. This is an implementation of the fixed window algorithm which is nice to see in application. 

Details about this approach will be explained shortly. 

## Key Components

A custom rate limiter needs four main components from what I understand.

`Identifier`: How do we recognize the requester? 

`Storage/State`: Where do we keep track of the request counts, timestamps, or tokens? 

`Logic Engine`: Executing the fixed window algorithm, checks storage, and either allows or denies the request.

`Response Handler`: What happens when a request is denied? 

To answer the first one, we can achieve this by simply using an IP address. However, some IPs are nonstatic, meaning they can change over time. This can lead to bugs right away. Instead we may use a combination of a UserID and IP. 

For storage, I will personally be using a single server, but add eventually allow horizontal scaling later to avoid overloading. A Map will work great for this for now. Later we can use Redis for multiple server instances.

A response handler will do exactly what it entails, handle the responses. In the case that the request is denied, the handler should respond with an HTTP `429 too many requests` status code. In addition, it should send a message regarding how long potentially to wait to try again for user experience.


## Request Flow

This part is to explain thoroughly how I want the custom rate limiter to work.

First, we figure out the identifier: grab user's IP address from the request.

Then, we fetch the current rate limit state for that identifier in storage (Map).

Next, apply the fixed window algorithm to calculate if the request is allowed based on current time and stored state. For example, if they have any hits left before reaching their limit?

If allowed, decrment the counter and update the timestamp in storage. Set an expiration on th storage key to clean up old data.

Finally, pass the request to the main application if allowed, or block and return a `429` response otherwise.


## When to Rate Limit? 

The way the algorithm works is by utilizing a technique called the fixed window technique. In the future, I plan to implement other algorithms as an option to the developer using the rate limiter, such as sliding window. 
The fixed window algorithm essentially is a window of time, looking at the current number of requests sent by each user of the developer's app and keeping track of them throughout the time interval set. 

In the fixed window approach, there are two distinct `Map`s:
`current` and `previous`. 

Assume the rate limit configuration is every 60 seconds (60000 ms) and the limit of requests per client are 5. We'll assume for now we can confidently keep track of the users by a special ID. 

The first step at `T = 0` seconds. The user `ID = 1` makes a request. The middleware will store this ID along with the current amount of requests they have made. It'll look something like:
`info = { ID: 1, hits: 1 }` 

Continuing from the initial request at `T = 0`, the `current` and `previous` maps will right away check if this user has been accounted for before within the set time interval (60s). Both will see there is no user with such ID, so they miss. 

Then, the algorithm will create a special object called `Client` and store the total number of requests of this user made within the set time window, along with the expiration date of this object to say when to reset this user's recorded hit count. Said object would look something like this: 
+ `Client = { totalHits: 0, resetTime: Date.now() + 60000 }`

Next, still at `T = 0`, we place the `Client` object into the `current` map and increment the total hits to 1.

Lastly, the middleware checks the total hits to the limit set and decides whether or not to block the request. 
+ `1 < 5` => allow the request through.

But, now `T = 10`, so user `ID = 1` makes a second, third, and fourth request. For each request, the storage checks `current` and finds the `Client` object matching the ID and immediately checks the expiration date. 
+ `if (Date.now() <= client.resetTime)` 

Since `T = 10 < 60`, then the total hits for that user increments respectively for each request within the window: `totalHits = 4`.

The timer then reached `T = 30` seconds. The same user makes another request, marking requests number 5 within the time interval of 60 seconds: `totalHits = 5`. This is still fine, the limit is less than or equal to 5, so this request passes. 

Although, at `T = 50` seconds, the same user makes another request yet again. The algorithm checks `current` and finds the `Client` object with a total of 5 hits already. It then realizes that `5 < 6` and sees that the user exceeded the maximum number of requests within 60 seconds. The middleware then blocks that user, sending a `429: too many requests` status code and message. 

Once the server reaches `T = 61` seconds, the `current` map becomes old or "expired." The same user makes request #7 and the algorthm finds the `Client` object inside `current`. It checks the expiration of the object and realizes that it expired: `T = 61 > 60`!

The code then resets the client object, total hits become 0 and the reset time because the time now plus 60 seconds: `Client = { totalHits: 0, resetTime: Date.now() + 60000 }`. Total hits increments as follows and the middleware sees that, then allows the request. 

The cycle restarts.

However, where does the `previous` map play into this? When the interval exceeds the set window, all of the client objects found inside `current` get forced into `previous`. So actually, at `T = 61`, `Client` object from before would **not** be in `current`, but instead `previous`.

The swap then creates a brand new empty `current` map for the next interval: `T = 60 -> T = 119`.

This is an amazing algorithm because if the user never makes another request, they sit inside `previous` for one window cycle. At the end of that cycle, the old `previous` map gets overwritten by the new `current` map! So effectively, our user is wiped from memory and the server didn't ever have to run slow checks for expired client objects! If the user does eventually come back later, it doesn't matter as they are well past expiration and have a clean slate of requests to make. 

*Additional notes: if we wanted to implement a sliding window algorithm instead, we need to struture the `Client` object to store an array of timestamps. So we would filter the array and then check the size of it to get the total requests made by that user. But this will be implemented after fixed window is complete.* 


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

*A good thing to note is that most modern devices use privacy extensions to randomly generate that secondary half every time they connect to the internet to prevent tracking.*

The rate limiter will have different "leniency" settings based on aggressive we want the rate limiter to be. A list of common settings are ` 64 | 60 | 56 | 50 | 48 | 32 `. For example, `64` is a more lenient setting and `32` is very aggressive. Now what does that mean in context of the IPv6? 

Well, it means how many digits we are going to use to generalize the IPv6. Using the `64` mask as an example, that means we will only look at the first 64 bits of the IPv6 string. In this case, that's the first half of the address, or what we know it as the network prefix. Doing this can allow us to avoid a bot from being able to change their IPv6 address by one digit or sometimes an entirely different one. Like this: 
- Request 1: (`2001:0db8:85a3:0000:1111:2222:3333:4444`)
- Request 2: (`2001:0db8:85a3:0000:1111:2222:3333:4447`)
- Request 3: (`2001:0db8:85a3:0000:aaaa:bbbb:cccc:dddd`) (entirely different local interface identifier)

This is how we can avoid, somewhat sophisticated, bots trying to overcome our rate limiter. We intentionally ignore the interface identifier with the `64` block setting, so we only add to the hit count if we see `2001:0db8:85a3:0000` and not the entire address. Now it's understandable that `32` is very harsh because it sees only 32 bits of the address or `2001:0db8`. This is why it can potentially block innocent users that did not need to be rate limited. The default setting we will use in the rate limiter will be the `56` bits. 

## IPv4 vs IPv6

Another type of identification is through IPv4 addresses that take the simple form: `a.b.c.d`. Something you can notice right away is that it is much simpiler than the IPv6 address, but know that they can actual be equal and mean the same thing! The way this works is the IPv4 can be *embedded* inside the IPv6 address. 
Ex: `::ffff:a.b.c.d`. 

IPv4-compatitable IPv6 addresses back in the day looked like: `::a.b.c.d`. So the IPv4 `192.168.1.10` can look like: `::192.168.1.10`. Although, this is a deprecated format which was originally made for tunneling IPv4 over IPv6 networks. They still are around, however, so it is important to factor these cases into our rate limiter. 

The type of IP is dependent on the user's ISP, VPN/proxy, and perhaps mobile networks which use NAT64. 

So, this means in our rate limiter, we need to check if an IPv6 is secretly an IPv4 behind the scenes. The reason why we need to do this is suppose we have an incoming address that looks like, `::ffff:192.168.1.10`, and we applied the default `/56` subnet mask we discussed about earlier. This would be disastrous because beneath the hood, `::ffff:192.168.1.10 = 0000:0000:0000:0000:0000:ffff:c0a8:010a`. So applying the subnet mask would ignore the actual unique data in the last 32 bits, which would obviously rate limit many innocent users. This is exactly why checking if there is an IPv4 address inside of the IPv6 one is so important to do. It properly limit rates the real user's identity without affecting other individuals. 

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


## Configurations

I want to go over all the types of configurations to be possible in this rate limiter. 
* `windowMs`: The time interval in which the rate limiter will look at to track user hit frequency. If there are 5 hits found from a specific user in this window, and the limit is set to 5, the rate limiter with then block any further hits from that user. 
* `limit`: Max amount of requests allowed per user within the time interval set.
* `message`: A message to add for users to know they have been rate limited.
* `statusCode`: HTTP status code to send back when a client has been rate limited.
* `legacyHeaders`: A boolean used to toggle the use of old style headers *(X-RateLimit-Y)*.
* `standardHeaders`: Support for standardized headers *(defaults to false)*.
* `requestPropertyName`: Specific name for accessing per-request metadata (`request.**rateLimiterName** = ...`)
* `identifier`: 8th draft specification for the name used to identify the quota policy in headers. 
* `skipFailedRequests`: Boolean to either skip a user's hit based on any error causing the request to fail or not go through. 
* `skipSuccessfulRequests`: Boolean to skip a user's hit if the request was successful.
* `skip`: Boolean to use for more complex needs to rate specific users on specific things. 
* `keyGen`: An optional key generator for creating more complex identifying keys for limiting users with the IPv6 addresses (nondefault).
* `handler`: A handler used for sending back a response to user stating they are rate limited. 
* `reqSuccessful`: Boolean stating whether a request was successful or not.
* `passOnStoreError`: Useful boolean to allow a user to make a further requests if the ability to store information on the rate limiter is either broken or down. 
* `store`: The datastructure or specific database used to store user's IPs, their hit counts, and other necessary data.
* `validate`: Boolean used to allow validation of data and objects as they come in and out *(on at default)*.
* `logger`: Custom logger for processing/displaying errors and warning to the server console.
* `ipv6Subnet`: Subnet mask settings for rate limiting sensitivity based on developer's desires. 


### Further Explainations on Configuration Options
 
When I started researching on this topic, I was very confused on a lot of different needs listed above. I want to explain below every single thing that is not so obvious when first starting out. 

Beginning with: `requestPropertyName`, the name is not super self explainatory if you aren't familiar with how requests and metadata work. To be put simply, if I have two rate limiters `globalLimiter` and `loginLimiter` then the `requestPropertyName` for each of these when making them in the beginning would look like: 
`...requestPropertyName: 'globalLimiter', ...` and `...requestPropertyName: 'loginLimiter', ...` respectively. So to access various metadata on users through different rate limiting middleware, we can find it through one request object and the respecitive property name! If all the rate limiters were named `rateLimit`, then those collisions can be bad or very bad.

Next, `reqSuccessful`. This property is calculated based on each request that comes in. It is designed to see if the HTTP status code is below a 400, which means it was a success. This boolean can be used in several applications depending on the developer's needs. 

Another is `passOnStoreError`. This one was the most confusing for me personally. I thought that this was weird since why would we want anything to pass during a store error? Turns out, there are some caveats to this depending on the type of store error. The option is false by default, but if a developer needs it to be on and knows what they are doing, its toggable for that reason. 
Now a reason as to why one would want this to be on is the following example. If our application is not dealing with sensitive data (i.e. bank information) then during a store outage we can prefer serving traffic and accept temporary overuse of requests (rate limiter off). If the application revolves around sensitive data, we definitely do NOT want the rate limiter to be off. It is more highly advisable to prevent a hacker brute forcing requests on a hypothetical weakpoint to gain access to sensitive information after somehow finding out the rate limiter is off.  



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

Since our middleware revolves around a time interval, or "fixed window," which is a core component in our rate limiter, this tells us that we want to use a testing tool which has a built-in fake timer system. `Jest` has exactly that! 

Jest allows us to *freeze* time, make requests, and instantly fast-forward the clock to simulate the expiration of a window with its `useFakeTimers()` object. In addition, we do not want to connect this to a real database just for testing purposes. As in a production environment, the `Store` could be a Redis or PostgreSQL database. This would be unnecessarily complicated and resource intensive. A solution is to use Jest's built-in mocking system to create a `MockStore` class, in which implements the `Store` interface and using a simple JavaScript `Map` or object. On top of that, Jest has "spying" capabilities that allow us to spy on methods to verify their intentional or unintentional behaviors. 

It begins to be obvious why Jest is an industry standard for a standard testing framework. That is because it groups many nice tools (runner, assertions, spying, etc.) into one package. 

### Information+

To be specific, there are two types of tests we are making: **Integration** and **Unit** tests. 

For anyone that is unaware or heard of them and does not know what these types of tests are, I will explain them briefly. 

**Unit** tests, tests each module of a software separately and are responsible to observe only the functionality of these indiviudal *units*. These tests are performed first, as they involve the internal design of the software without external parts of the whole software; typically executed by the developer. 

**Integration** tests verify all of the modules of the software combined. Contrary to unit tests, integration tests do not know the internal design of the software, it assumes it is law and checks if our code is *integrated* with the external dependencies to create an overall working system. These tests are executed by the tester and is performed *after* unit testing is complete. 

Since integration tests do not know internal designs of interfaces, it is difficult to detect defects, hence why unit tests handle those types of verifications themselves. A common example of an external part is data integrity involving retrieving and storing data in a database, which is something that we will be doing!


