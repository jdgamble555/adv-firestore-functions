# adv-firestore

These are the back-end firestore functions that will allow you to create easy-to-use indexes. 

Import the necessary functions at the top of your firebase function file:

```typescript
import { eventExists, fullTextIndex } from '@jdgamble555/adv-firestore';
```

**Full-text search**

This will index your fields so that you can search them. No more Algolia or Elastic Search! No more indexing every letter! It will, however, create documents based on the number of words in the field. So a blog post with 300 words, will create 300 documents indexing 6 words (default number) at a time so you can search phrases etc. Since you generally write / update fields in firebase rarely, 300 documents is not a big deal to index, and will save you money on searching. The size of the document is just one foreign key field. This function will automatically create, delete, and update the indexes when necessary.  All of these functions also use transactions, batching, and chunking (100 documents at a time) to provide the best performance.

*Events --- very important!*

Anytime you use a counter function, or a complicated function like **fullTextIndex** that you only want run once, make sure to add the event function at the top of your code. Firebase functions can run functions more than once, messing up your indexes.

```typescript
// don't run if repeated function
if (await eventExists(context.eventId)) {
    return null;
}
```

So, in order to index the title and the content of your **posts** function, you could have something like this:
```typescript
import * as admin from 'firebase-admin';
try { admin.initializeApp(); } catch (e) { }
import { eventExists, fullTextIndex } from '@jdgamble555/adv-firestore';

exports = module.exports = functions.firestore
    .document('posts/{docId}')
    .onWrite(async (change: any, context: any): Promise<any> => {

        // don't run if repeated function
        if (await eventExists(context.eventId)) {
            return null;
        }
        // index the posts
        const searchable = ['content', 'title'];
        searchable.forEach(async (field: string) => {
            await fullTextIndex(change, context, field);
        })
        return null;
    });
```

*Front-end:* This will depend on your implementation, but generally, you will use something like the following code:

```typescript
let id = firebase.firestore.FieldPath.documentId();
db.collection(`_search/COLLECTION_NAME/COLLECTION_FIELD`).orderBy(id).startAt(term).endAt(term + '~').limit(5);
```
I will eventually make a front-end package for vanilla js or angular. You can search mulitple fields at the same time by combining the promises or combineLatest, for example, and sorting them on the front end with map. It will automatically index the correct fields and collection names.  Use **term** to search. I would also recommend using a **debounceTime** function with **rxjs** to only search when you quit typing.

**Index unique fields**

Unique fields is pretty simple, add the unique field function on an **onWrite** instance and it will update automatically everytime there is a change. Here you can index the a unique 'title' field. Check code for options like **friendlyURL**.

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

This will create a counter every time the collection is changed on an **onWrite** instance. 

```typescript
await colCounter(change, context);
```

**Query counters**

Query counters are very interesting, and will save you a lot of time.  For example, if you want to count the number of documents a user has, or the number of categories a post has, and save it on the original document called on **onWrite**.

```typescript
// postsCount on usersDoc
const userRef = after ? after.userDoc : before.userDoc;
const postsQuery = db.collection('posts').where('userDoc', "==", userRef);
await queryCounter(change, postsQuery, userRef, 'postsCount');
```
This assumes you saved the userDoc as a reference, but you could easily create one with the document id:
```typescript
const userId = after ? after.userId : before.userId;
const userRef = db.doc(`users/${userId}`);
```

There is more to come as I simplify my firebase functions!
See [Fireblog.io][1] for more examples!

[1]: http://fireblog.io "Fireblog.io"
