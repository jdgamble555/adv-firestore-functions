# Advanced Firestore Functions

*Note: The following indexes care created automatically if they do not exist.*

**Collection counters**

This will create a counter every time the collection is changed. 

```typescript
await colCounter(change, context);
```

You can find any collection counter that you index here:

```typescript
// count = n
db.doc(`_counters/COLLECTION_NAME`);
```

```typescript
/**
 * Runs the counter function
 * @param change - change ref
 * @param context - event context
 */
```

**Condition counters**

This will allow you to count changes in a condition. 

Let's say you want to count **isNice** being **true** on a **posts** doc.

You would run this in the **onWrite** function of a **posts** doc.

```typescript
await conditionCounter(change, context, 'isNice', '==', true);
```

This will count automatically update the **isNiceCount**, or "isNice == true" on the "_counters/posts" doc.

Possible where operators [here](https://firebase.google.com/docs/reference/node/firebase.firestore#wherefilterop)
(no support for: array-contains, in, array-contains-any, or not-in)
Post an issue if you need this [here](https://github.com/jdgamble555/adv-firestore-functions/issues)

```typescript
/**
 * Adds a condition counter to a doc
 * @param change - change ref
 * @param context - event context
 * @param field - where field path
 * @param operator - where operator
 * @param value - where value
 * @param countName - counter field name, default ${field}Count
 * @param countersCol - counter collection name, default _counters
 * @param del - boolean, delete counter document if 0 ?
 * @returns
 */
```

**Query counters**

Query counters are very interesting, and will save you a lot of time.  For example, you can count the number of documents a user has, or the number of categories a post has, and save it on the original document.

(See below for the *getValue* function)

```typescript
// postsCount on usersDoc
import { eventExists, queryCounter, getValue } from 'adv-firestore-functions';

const userId = getValue(change, 'userId');
const userRef = db.doc(`users/${userId}`);
const postsQuery = db.collection('posts').where('userDoc', "==", userRef);

await queryCounter(change, context, postsQuery, userRef);
```

You would get the counter from your target document. In this case it will automatically create **postsCount** on the **users** document.

```typescript
/**
 * Adds a counter to a doc
 * @param change - change ref
 * @param context - event context
 * @param queryRef - the query ref to count
 * @param countRef - the counter document ref
 * @param countName - the name of the counter on the counter document
 * @param del - whether or not to delete the document
 * @param n - 1 for create, -1 for delete
 * @param check - whether or not to check for create or delete doc
 */
```

**Trigger Functions** and **createdAt** / **updatedAt**

You can change the trigger functions to update the same document with a filtered or new value.  For example, if you have a value that you want to create on a function, and then go back and update it (a friendly title in lowercase).

```typescript
// define data
const data: any = {};
data[someValue] = 'some new field value';

// run trigger
await triggerFunction(change, data);
```

ALWAYS HAVE ONLY 1 TRIGGER FUNCTION.  You only need one.

```typescript
/**
 * trigger Function to update dates and filtered values
 * @param change - change event
 * @param data - data to update
 * @param updateDates - use createdAt and updatedAt
 */
```

This will also automatically update **createdAt** and **updatedAt** dates in your document. This is good if you don't want the user to be able to hack these dates on the front end.  You can turn this off by passing in **false** as the last paramenter.

Note: *If you only want to update the dates **createdAt** and **updatedAt**, simply leave out the data parameter.*

However, you need to add **isTriggerFunction** to the top of your code to prevent infinite loops:

```typescript
// don't run if repeated function
if (isTriggerFunction(change, context)) {
    return null;
}
```

There are many options for these as well, see actual code for changing default parameters.

The default counter variable can be changed on all documents. See the code for each function.  You can also change the name of the index collections.  The defaults are *_tags, _search, _uniques, _counters, _categories, _events*.

```typescript
/**
 * Check for trigger function
 * @param change - change ref
 * @param context - event context
 */
```
[HOME](README.md)