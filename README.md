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

**Full-text search**

This will index your fields so that you can search them. No more Algolia or Elastic Search! No more indexing every letter! It will, however, create documents based on the number of words in the field. So a blog post with 100 words, will create 100 documents indexing 6 words (default number) at a time so you can search phrases etc. Since you generally write / update fields in firebase rarely, 100 documents is not a big deal to index, and will save you money on searching. The size of the document is just one foreign key field. This function will automatically create, delete, and update the indexes when necessary.  All of these functions also use transactions, batching, and chunking (100 documents at a time) to provide the best performance.

**Events -- VERY IMPORTANT!**

Anytime you use a counter function, or a complicated function like **fullTextIndex** that you only want run once, make sure to add the event function at the top of your code. Firebase functions can run functions more than once, messing up your indexes and counters.

```typescript
// don't run if repeated function
if (await eventExists(context.eventId)) {
    return null;
}
```

So, in order to index the title and the content of your **posts** function, you could have something like this:
```typescript
// index the posts
const searchable = ['content', 'title'];
searchable.forEach(async (field: string) => {
    await fullTextIndex(change, context, field);
});
```

*Front-end:* This will depend on your implementation, but generally, you will use something like the following code:

```typescript
let id = firebase.firestore.FieldPath.documentId();
const col = `_search/COLLECTION_NAME/COLLECTION_FIELD`;
db.collection(col).orderBy(id).startAt(term).endAt(term + '~').limit(5);
```
I will eventually make a front-end package for vanilla js or angular. You can search mulitple fields at the same time by combining the promises or combineLatest, for example, and sorting them on the front end with map. It will automatically index the correct fields and collection names.  Use **term** to search. I would also recommend using a **debounceTime** function with **rxjs** to only search when you quit typing.

**Index unique fields**

Unique fields is pretty simple, add the unique field function and it will update automatically everytime there is a change. Here you can index the a unique 'title' field. Check code for options like **friendlyURL**.

```typescript
await uniqueField(change, context, 'title');
```

*Front-end:* Again, this will depend, but generally speaking you search like so:

```typescript
db.doc(`_uniques/COLLECTION_NAME/${title}`);
```
on the document name to see if the 'title', in this case, is a unique value. Just use **snapshot.exists** depending on your front-end code.

*Note: The following indexes care created automatically if they do not exist.*

**Collection counters**

This will create a counter every time the collection is changed. 

```typescript
await colCounter(change, context);
```

**Query counters**

Query counters are very interesting, and will save you a lot of time.  For example, you can count the number of documents a user has, or the number of categories a post has, and save it on the original document.

```typescript
// postsCount on usersDoc
const userRef = after ? after.userDoc : before.userDoc;
const postsQuery = db.collection('posts').where('userDoc', "==", userRef);
await queryCounter(change, context, postsQuery, userRef);
```
This assumes you saved the userDoc as a reference, but you could easily create one with the document id:
```typescript
const userId = after ? after.userId : before.userId;
const userRef = db.doc(`users/${userId}`);
```

**Category counters**

This is specific if you want to index categories. I will eventually post code on this to explain it, but usage is like so:

On the **categories** collection:

```typescript
// update all sub category counters
await subCatCounter(change, context);
```

On the **posts** collection, or whatever your categories contain:

```typescript
// [collection]Count on categories and its subcategories
await catDocCounter(change, context);
```

**Trigger Functions**

You can change the trigger functions to update the same document with a filtered or new value.  For example, if you have a value that you want to create on a function, and them go back and update it (a friendly title in lowercase).

```typescript
// define data
const data: any = {};
data.someValue = doSomething();

// run trigger
await triggerFunction(change, data);
```

This will also automatically update **createdAt** and **updatedAt** dates in your document. This is good if you don't want the user to be able to hack these dates on the front end.  You can turn this off by passing in **false** as the last paramenter.

However, you need to add **isTriggerFunction** to the top of your code to prevent infinite loops:

```typescript
// don't run if repeated function
if (await eventExists(context.eventId) || isTriggerFunction(change)) {
    return null;
}
```

There are many options for these as well, see actual code for changing default parameters.

The default counter variable can be changed on all documents. See the code for each function.  You can also change the name of the index collections.  The defaults are _tags, _search, _uniques, _counters, _categories, _events

There is more to come as I simplify my firebase functions!
See [Fireblog.io][1] for more examples!

[1]: http://fireblog.io "Fireblog.io"
