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

*WARNING!* - This function can create A LOT of documents if you have a big text field. However, it is worth it if you only **write** sporatically.

This will index your fields so that you can search them. No more Algolia or Elastic Search! It will create documents based on the number of words in the field. So a blog post with 100 words, will create 100 documents indexing 6 words at a time. You can change this number. Since you generally write / update fields in firebase rarely, 100 documents is not a big deal to index, and will save you money on searching. The size of the document is just 6 words, plus the other foreign key fields you want to index. This function will automatically create, delete, and update the indexes when necessary.  All of these functions use transactions, batching, and chunking (100 documents at a time) to provide the best performance.

**Events -- VERY IMPORTANT!**

Anytime you use a counter function, or a complicated function like **fullTextIndex** that you only want run once, make sure to add the event function at the top of your code. Firebase functions can run functions more than once, messing up your indexes and counters.

```typescript
// don't run if repeated function
if (await eventExists(context)) {
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

--options--

```typescript
await fullTextIndex(change, context, 'field-to-index', ['foreign', 'keys', 'to', 'index']);
```
The foreign keys to index will be all of the fields you will get back in a search. It defaults to ONLY the **document id**, however, you can add or change this to whatever fields you like.

```typescript
await fullTextIndex(change, context, field, foreign-keys, type);
```
The **type** input defaults to 'id', and is indexed on all options.   
--id - just makes the document searchable from the **id** field using the *~* trick on the 6 word chunk you are searching.  
--map - makes the document searchable using a **map** of **_terms** (same as document id)  
--array - makes the document searchable using an **array** of **_terms** (same as document id)  

```typescript
// map
{
    _terms: {
        a: true,
        al: true,
        also: true,
        also : true,
        also t: true
        ...
    }
}
// array
{
    _terms: [
        a,
        al,
        als,
        also,
        also ,
        also t,
        ...
    ]
}
```

**Maps** and **Arrays** are useful when you want to do complex searching, depending on what your constraints are. They do require more space on your documents and database size, but do not create any additional documents. Obviously searching is still limited to firestore's limits.

*Front-end:* This will depend on your implementation, but generally, you will use something like the following code:

```typescript
let id = firebase.firestore.FieldPath.documentId();
const col = `_search/COLLECTION_NAME/COLLECTION_FIELD`;

db.collection(col).orderBy(id).startAt(term).endAt(term + '~').limit(5);
```
On the front-end you could theoretically combine searches for searching several collections at once, separate queries by commas or spaces, or even group documents by relevance by the number of times the documents with the same foreign key id (your source document) appear. However, I would suggest indexing using **maps** or **arrays** for some more advanced features.

If you are in fact using **map** or **array**, you may have something like this:

```typescript
const col = `_search/COLLECTION_NAME/COLLECTION_FIELD`;

db.collection(col).where('_terms.' + term, '==', true); // map
db.collection(col).where('_terms', 'array-contains', term); // array
```

**Index unique fields**

Unique fields is pretty simple, add the unique field function and it will update automatically everytime there is a change. Here you can index the unique 'title' field. Check code for options like **friendlyURL**.

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

(See below for the *getValue* function)

```typescript
// postsCount on usersDoc
import { eventExists, queryCounter, getValue } from 'adv-firestore-functions';

const userId = getValue(change, 'userId');
const userRef = db.doc(`users/${userId}`);
const postsQuery = db.collection('posts').where('userDoc', "==", userRef);

await queryCounter(change, context, postsQuery, userRef);
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

This will also automatically update **createdAt** and **updatedAt** dates in your document. This is good if you don't want the user to be able to hack these dates on the front end.  You can turn this off by passing in **false** as the last paramenter.

Note: *If you only want to update the dates **createdAt** and **updatedAt**, simply leave out the data parameter.*

However, you need to add **isTriggerFunction** to the top of your code to prevent infinite loops:

```typescript
// don't run if repeated function
if (await eventExists(context) || isTriggerFunction(change, context)) {
    return null;
}
```

There are many options for these as well, see actual code for changing default parameters.

The default counter variable can be changed on all documents. See the code for each function.  You can also change the name of the index collections.  The defaults are *_tags, _search, _uniques, _counters, _categories, _events*.

**Join Functions**

There are several join functions for different use to save you money from foreign key reads on the front end.

**Aggregate Data**

Here you can agregate data, for example the comments on a posts document. You can aggregate any document. The default number of documents added is *3*, but you can change this. You can also add any other fields to the document you want using the *data* field. This will automatically only update when the field has been changed. This will save you money on reads.

This would be called on a *comments* **onWrite** call.

```typescript
import { aggregateData } from 'adv-firestore-functions';

const postId = context.params.postId;
const docRef = admin.firestore().collection('posts').doc(postId);

const queryRef = db.collection('comments').orderBy('createdAt', 'desc');
const exemptFields = ['category'];

await aggregateData(change, context, docRef, queryRef, exemptFields);
```

To change the number of documents to aggregate (5) and the name of the field:

```typescript
import { aggregateData } from 'adv-firestore-functions';

aggregateData(change, context, docRef, queryRef, exemptFields, 'recentComments', 5);
```

**createJoinData**

In order to deal with foreign keys, you first need to add the data when a document is created. This will of course get the latest data.

So, for adding user data to a posts document, for example, you can add it like so on an **onWrite** call on a **posts** document:

```typescript
import { getValue, getJoinData } from 'adv-firestore-functions';

const joinFields = ['displayName', 'photoURL'];
const userId = getValue(change, 'userId');
const userRef = db.collection(`users/${userId}`);

await createJoinData(change, userRef, joinFields, 'user');
```

**updateJoinData**

You also have to deal with updating the data. For example, this will automatically update user data on a posts document when the user data is changed. This function would need to be called on an **onWrite** call on a **user** document:

```typescript
import { updateJoinData } from 'adv-firestore-functions';

const docId = context.params.docId;
const queryRef = db.collection('posts').where('userId', '==', docId)
const joinFields = ['displayName', 'photoURL'];
await updateJoinData(change, queryRef, joinFields, 'user');
```

Because this is **trigger** function, you need to check for it at the top of your function:

```typescript
// don't run if repeated function
if (isTriggerFunction(change, context)) {
    return null;
}
```

**getJoinData**

If you plan on updating the same document that was triggered with different types of information, you may want to just get the join data to prevent multiple writes, and write to the trigger funciton later:

```typescript
const data = await getJoinData(change, queryRef, joinFields, 'user');

// run trigger
await triggerFunction(change, data);
```

By default, **updateJoinData** and **getJoinData** do not delete the data.  For example, the user's posts will not automatically be deleted if a user is deleted. You can change this default behavior by adding **true** as the last paramenter of the function.

**Helper Functions**

There are several functions to check and see what kind of function is running:

```typescript
import { createDoc, updateDoc, deleteDoc } from 'adv-firestore-functions';
```

and for advanced checking:

```typescript
import { writeDoc, shiftDoc, popDoc } from 'adv-firestore-functions';
```

- writeDoc = createDoc || updateDoc  
- shiftDoc = createDoc || deleteDoc   
- popDoc = updateDoc || deleteDoc  

Also, remeber to pass in the change variable:

```typescript
import { createDoc } from 'adv-firestore-functions';

if (createDoc(change)) {
    // a document is being created, so do something...
}
```

These are automatically used in the source code, so you don't need them for any of these functions out-of-the-box.

**valueChange** to see if a field has changed:

```typescript
if (valueChange(change, 'category')) {
// do something
}
```

**getValue** to get the latest value of a field:

```typescript
const category = getValue(change, 'category');
```

Last, but not least I have these specific functions for categories. I will explain these in a front-end module eventually, but until then don't worry about them. I am adding the usage case just for completeness.

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

I will try and update the documention as these functions progress. There is plenty of logging, so check your logs for problems!

There is more to come as I simplify my firebase functions!
See [Fireblog.io][1] for more examples (whenever I finally update it)!

[1]: http://fireblog.io "Fireblog.io"
