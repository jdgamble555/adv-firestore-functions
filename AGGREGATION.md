# Advanced Firestore Functions: Aggregation

[HOME](README.md)

**Array Index**

I created an array index function.  Since arrays are limited in size by the size of the document, I created a way to automatically grow in scale if your arrays get bigger.  It defaults to the sub-collection and saves the id, but you can use any collection and any value in the documents.

This would be called on a *comments* **onWrite** call.

```typescript
import { arrayIndex } from 'adv-firestore-functions';

functions.firestore
  .document("users/{userId}/following/{followingId}")
  .onWrite(async (change: any, context: any) => {

    await arrayIndex(change, context);

  });
```

  By default, this will create a ```following_index``` collection indexing the follower ids in an array called following containing upto 10,000 documents and the user doc. 
  It will automatically create new documents after 10,000 (set this number with max), to allow scalable arrays for searching.

  The index doc will look like:

```
users/{userId}/following_index/{following_index_id} --> {

following: [
    12ksk3s,
    h2kskeks,
    5232212,
    ...
],
user: {
    displayName: 'John Doe',
    email: 't@test.com',
    ...
},
createdAt: 'date here',
updatedAt: 'date here'

}
```

These documents will be searchable. If you delete a doc, it will delete it in an array. Everything gets auto-updated. 

You can also do a map:

```typescript
await arrayIndex(change, context, {
    type: 'map'
});
```

Which will produce:
```
following: {
    12k32k: true,
    zekles: true,
    ...
}
```
Or for special indexing for map sorting:
```typescript
await arrayIndex(change, context, {
    type: 'map',
    docSortField: 'createdAt',
    docSortType: 'value'
});
```
While will produce:
```
following: {
    11sk3sl: 2/5/2021 (date timestamp),
    72dkels: 2/5/2021 (date timestamp)
    ...
},
users: {
    displayName: 'John Doe',
    createdAt: 2/5/2021 (date timestamp)
}
```
The date will be whatever date is on the user doc.  This allows you to sort by user createdAt using:
```typescript
db.collectionGroup('following_index')
.orderBy(`following.${followingID}`)
```
Or for multiple where clauses:
```typescript
await arrayIndex(change, context, {
    type: 'map',
    docSortField: 'createdAt',
    docSortType: 'id',
    indexPath: '/'
});
```
Would create:
```
following_index/(createdAt date string here)__{following_index_id} --> {
    following: {
      11sk3sl: true,
      72dkels: true
    ...
    },
    users: {
      displayName: 'John Doe',
      createdAt: 2/5/2021 (date timestamp)
    }
}
```
So you could search by:
```typescript
db.collection('following_index').where(`following.${followingID}`, '==', true)
```
This will automatically sort by the createdAt date, since id fields are auto indexed.

There are many options for every scenario.  If I missed something, let me know.

```typescript
/**
 * @param change - change functions snapshot
 * @param context - event context
 * @param _opts : {
 *   fieldToIndex - field to save in array or map, default id
 *   max - maximum number of items in array / map, default 10,000
 *   type - array or map, default array
 *   indexFieldName - name of field to store array, defaults to collection name
 *   indexColName - name of new index collection, default collection_name__index
 *   indexPath - path to store new collection, defaults to parent doc
 *   docToIndex - doc to index with array, defaults to to parent doc
 *   docFieldsToIndex - fields from parent doc to index, default *
 *   docFieldName - name of field to store parent doc in, defaults to col name
 *   docSortField - name of field to sort documents by, default createdAt
 *   docSortType - sort by id or value (add id sort, or map value sort), default null
 * }
 */
```

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

```typescript
/**
 * Aggregate data
 * @param change - change functions snapshot
 * @param context - event context
 * @param targetRef - document reference to edit
 * @param queryRef - query reference to aggregate on doc
 * @param fieldExceptions - the fields not to include
 * @param aggregateField - the name of the aggregated field
 * @param n - the number of documents to aggregate, default 3
 * @param data - if adding any other data to the document
 * @param alwaysAggregate - skip redundant aggregation, useful if not date sort
 */
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

```typescript
/**
 * Create data to join on document
 * @param change - change event
 * @param targetRef - the target document
 * @param fields - the fields to get from the target document
 * @param field - the field to store the target document fields
 * @param data - data object to update
 * @param alwaysCreate - create even if not necessary
 */
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

```typescript
/**
 * Update foreign key join data
 * @param change - change event
 * @param queryRef - query for fk docs
 * @param fields - fields to update, default *
 * @param field - field to store updated fields
 * @param isMap - see if field dot notation equals map, default true
 */
```

**IMPORTANT!** - If this is **trigger** function, you need to check for it at the top of your function with this code.  This should be ran before any functions.  A trigger function is a Firebase Function that triggers itself. Example, triggering the user doc to update the user doc with the latest date, or aggregated posts, etc...

```typescript
// don't run if repeated function
if (isTriggerFunction(change, context)) {
    return null;
}
```

**getJoinData**

If you plan on updating the same document that was triggered with different types of information, you may want to just get the join data to prevent multiple writes, and write to the trigger function later. This is actually the internal function for **createJoinData**.

```typescript
const data = await getJoinData(change, queryRef, joinFields, 'user');

// run trigger
await triggerFunction(change, data);
```

By default, **updateJoinData** and **getJoinData** do not delete the data.  For example, the user's posts will not automatically be deleted if a user is deleted. You can change this default behavior by adding **true** as the last paramenter of the function.

```typescript
/**
 * Get data to join on document
 * @param change - change event
 * @param targetRef - the target document
 * @param fields - the fields to get from the target document
 * @param field - the field to store the target document fields
 * @param data - data object to update
 * @param alwaysCreate - create even if not necessary
 */
```

[HOME](README.md)