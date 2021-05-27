# Advanced Firestore Functions

These are the back-end firestore functions that will allow you to create easy-to-use indexes. 

**Installation**

Install the package into your **firebase functions** directory.

```npm i adv-firestore-functions```

Import the necessary functions at the top of your firebase function file:

```typescript
import { eventExists, fullTextIndex } from 'adv-firestore-functions';
```

All of these functions are called on an **async onWrite** firebase firestore function like so:

```typescript
functions.firestore
    .document('posts/{docId}')
    .onWrite(async (change: any, context: any) => {
//... code
}
```

The search functions, however, must be put in a callable function like so:

```typescript
functions.https.onCall(async (q: any) => {

// 'q' is the data coming in

//... code
}
```

# [Searching](SEARCHING.md)
# [Counters](COUNTERS.md)

# [Aggregation](AGGREGATION.md)

# [Helper Functions](HELPER.md)


If you see any errors or have any suggestions, please post an [issue on github](https://github.com/jdgamble555/adv-firestore-functions/issues).

There is more to come as I simplify my firebase functions!
See [Fireblog.io][1] for more examples (whenever I finally update it)!

[1]: http://fireblog.io "Fireblog.io"
