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




